//! Admin account-merge: consolidate a duplicate account onto a keeper, then
//! hand the merged-away device off to the keeper on its next load.
//!
//! See documentation in the approved plan. This module currently holds the
//! Phase-1 dry-run verifier; the merge endpoint + handoff endpoints follow.

use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::obs_crypto::{decrypt_observation, encrypt_observation};
use crate::routes::board_status::{recompute_assignment_boards, recompute_board_history};
use crate::routes::recovery::decrypt_for_recovery;
use crate::student_summary::recompute_student_summary;
use crate::AppState;

fn validate_api_key(headers: &HeaderMap, expected_key: &str) -> bool {
    headers
        .get("x-api-key")
        .and_then(|v| v.to_str().ok())
        .map(|k| k == expected_key)
        .unwrap_or(false)
}

/// Recover a user's raw base64 AES key from their recovery_encrypted_key.
async fn recover_user_key(state: &AppState, user_id: &str) -> Result<String, String> {
    let recovery_secret = state
        .config
        .recovery_secret
        .as_ref()
        .ok_or_else(|| "Recovery not configured (no RECOVERY_SECRET)".to_string())?;

    let encrypted: Option<String> =
        sqlx::query_scalar("SELECT recovery_encrypted_key FROM users WHERE id = ?")
            .bind(user_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| format!("DB error: {}", e))?
            .flatten();

    let encrypted = encrypted.ok_or_else(|| {
        format!("User {} has no recovery_encrypted_key — cannot recover their key", user_id)
    })?;

    decrypt_for_recovery(&encrypted, recovery_secret)
}

// ---------------------------------------------------------------------------
// Phase 1 dry-run: prove our obs_crypto matches the frontend on REAL data.
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct MergeDryRunQuery {
    pub user_id: String,
}

#[derive(Debug, Serialize)]
pub struct MergeDryRunResponse {
    pub success: bool,
    pub total: i64,
    pub decrypted_ok: i64,
    pub json_valid: i64,
    pub roundtrip_ok: i64,
    pub sample: Option<String>,
    pub error: Option<String>,
}

#[derive(sqlx::FromRow)]
struct ObsCipher {
    encrypted_data: String,
    iv: String,
}

/// GET /api/admin/merge-dryrun?user_id=X
/// Recovers X's key, decrypts every observation with obs_crypto, checks the
/// plaintext parses as JSON, and round-trips it under a throwaway key. Proves
/// the server can read frontend-encrypted data and re-encode it readably,
/// WITHOUT mutating anything.
pub async fn merge_dry_run(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<MergeDryRunQuery>,
) -> Result<Json<MergeDryRunResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let key = match recover_user_key(&state, &q.user_id).await {
        Ok(k) => k,
        Err(e) => {
            return Ok(Json(MergeDryRunResponse {
                success: false,
                total: 0,
                decrypted_ok: 0,
                json_valid: 0,
                roundtrip_ok: 0,
                sample: None,
                error: Some(e),
            }))
        }
    };

    // A throwaway key for the round-trip leg (simulates the keeper's key).
    let throwaway = {
        use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
        use ring::rand::{SecureRandom, SystemRandom};
        let mut k = [0u8; 32];
        SystemRandom::new().fill(&mut k).ok();
        BASE64.encode(k)
    };

    let rows: Vec<ObsCipher> =
        sqlx::query_as("SELECT encrypted_data, iv FROM observations WHERE user_id = ?")
            .bind(&q.user_id)
            .fetch_all(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let total = rows.len() as i64;
    let mut decrypted_ok = 0i64;
    let mut json_valid = 0i64;
    let mut roundtrip_ok = 0i64;
    let mut sample: Option<String> = None;

    for r in &rows {
        let plaintext = match decrypt_observation(&r.encrypted_data, &r.iv, &key) {
            Ok(p) => p,
            Err(_) => continue,
        };
        decrypted_ok += 1;

        if serde_json::from_slice::<serde_json::Value>(&plaintext).is_ok() {
            json_valid += 1;
            if sample.is_none() {
                let s = String::from_utf8_lossy(&plaintext);
                sample = Some(s.chars().take(160).collect());
            }
        }

        // Round-trip under the throwaway key, then read it back.
        if let Ok((enc2, iv2)) = encrypt_observation(&plaintext, &throwaway) {
            if let Ok(back) = decrypt_observation(&enc2, &iv2, &throwaway) {
                if back == plaintext {
                    roundtrip_ok += 1;
                }
            }
        }
    }

    Ok(Json(MergeDryRunResponse {
        success: total > 0 && decrypted_ok == total && roundtrip_ok == total,
        total,
        decrypted_ok,
        json_valid,
        roundtrip_ok,
        sample,
        error: None,
    }))
}

// ---------------------------------------------------------------------------
// Merge: consolidate `merge_user_id` (away) onto `keeper_user_id`.
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct MergeRequest {
    pub merge_user_id: String,  // the account to dissolve (away)
    pub keeper_user_id: String, // the surviving account
}

#[derive(Debug, Serialize)]
pub struct MergeResponse {
    pub success: bool,
    pub observations_moved: i64,
    pub keeper_email: Option<String>,
    pub error: Option<String>,
}

/// The identity wrapped (under the away key) into the handoff row. snake_case
/// to match the recovery payload the frontend already knows how to consume.
#[derive(Debug, Serialize)]
struct HandoffIdentity {
    id: String,
    first_name: String,
    last_name: String,
    email: String,
    role: String,
    classroom: Option<String>,
    secret_key: String, // the KEEPER's AES key
    viewer_private_key: Option<String>,
}

fn err500<E: std::fmt::Display>(ctx: &str) -> impl Fn(E) -> (StatusCode, String) + '_ {
    move |e| (StatusCode::INTERNAL_SERVER_ERROR, format!("{}: {}", ctx, e))
}

/// POST /api/admin/merge-accounts  { merge_user_id, keeper_user_id }
pub async fn merge_accounts(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<MergeRequest>,
) -> Result<Json<MergeResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let away = req.merge_user_id;
    let keeper = req.keeper_user_id;

    let bail = |msg: String| {
        Ok(Json(MergeResponse {
            success: false,
            observations_moved: 0,
            keeper_email: None,
            error: Some(msg),
        }))
    };

    if away == keeper {
        return bail("merge and keeper accounts are the same".into());
    }

    let recovery_secret = match state.config.recovery_secret.clone() {
        Some(s) => s,
        None => return bail("Recovery not configured (no RECOVERY_SECRET)".into()),
    };

    // Recover both AES keys server-side.
    let k_away = match recover_user_key(&state, &away).await {
        Ok(k) => k,
        Err(e) => return bail(e),
    };
    let k_keeper = match recover_user_key(&state, &keeper).await {
        Ok(k) => k,
        Err(e) => return bail(e),
    };

    // Keeper identity for the handoff payload.
    let keeper_row: Option<(String, String, String, String, Option<String>, String)> =
        sqlx::query_as("SELECT id, first_name, last_name, email, classroom, role FROM users WHERE id = ?")
            .bind(&keeper)
            .fetch_optional(&state.db)
            .await
            .map_err(err500("keeper lookup"))?;
    let (kid, kfirst, klast, kemail, kclassroom, krole) = match keeper_row {
        Some(r) => r,
        None => return bail(format!("keeper account {} not found", keeper)),
    };

    // Recover the keeper's viewer private key too, if they're a teacher/admin.
    let viewer_private_key = if krole == "teacher" || krole == "admin" {
        let row: Option<(Option<String>,)> =
            sqlx::query_as("SELECT recovery_encrypted_private_key FROM viewers WHERE email = ?")
                .bind(&kemail)
                .fetch_optional(&state.db)
                .await
                .ok()
                .flatten();
        match row {
            Some((Some(enc),)) => decrypt_for_recovery(&enc, &recovery_secret).ok(),
            _ => None,
        }
    } else {
        None
    };

    // Build + wrap the handoff payload under the AWAY key (only that device unwraps).
    let identity = HandoffIdentity {
        id: kid.clone(),
        first_name: kfirst,
        last_name: klast,
        email: kemail.clone(),
        role: krole,
        classroom: kclassroom,
        secret_key: k_keeper.clone(),
        viewer_private_key,
    };
    let payload_json = serde_json::to_vec(&identity).map_err(err500("serialize identity"))?;
    let (handoff_payload, handoff_iv) =
        encrypt_observation(&payload_json, &k_away).map_err(err500("wrap handoff"))?;

    // Which keeper boards/assignments to recompute after the move (from away's obs).
    let affected_boards: Vec<(String, i32)> = sqlx::query_as(
        "SELECT DISTINCT deal_subfolder, deal_number FROM observations \
         WHERE user_id = ? AND deal_subfolder IS NOT NULL AND deal_number IS NOT NULL",
    )
    .bind(&away)
    .fetch_all(&state.db)
    .await
    .map_err(err500("affected boards"))?;
    let affected_assignments: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT assignment_id FROM observations \
         WHERE user_id = ? AND assignment_id IS NOT NULL",
    )
    .bind(&away)
    .fetch_all(&state.db)
    .await
    .map_err(err500("affected assignments"))?;

    // Away's observations to re-encode.
    let obs: Vec<(String, String, String)> =
        sqlx::query_as("SELECT id, encrypted_data, iv FROM observations WHERE user_id = ?")
            .bind(&away)
            .fetch_all(&state.db)
            .await
            .map_err(err500("fetch observations"))?;
    let observations_moved = obs.len() as i64;

    // ---- One atomic transaction: re-encode (self-verify), move, hand off, delete ----
    let mut tx = state.db.begin().await.map_err(err500("begin tx"))?;

    for (id, enc, iv) in &obs {
        let plaintext = decrypt_observation(enc, iv, &k_away)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("decrypt obs {}: {}", id, e)))?;
        let (new_enc, new_iv) = encrypt_observation(&plaintext, &k_keeper)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("re-encrypt obs {}: {}", id, e)))?;
        // Self-verify: the keeper's browser must be able to read what we wrote.
        let check = decrypt_observation(&new_enc, &new_iv, &k_keeper)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("verify obs {}: {}", id, e)))?;
        if check != plaintext {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("self-verify mismatch on obs {} — merge aborted, no changes made", id),
            ));
        }
        sqlx::query("UPDATE observations SET encrypted_data = ?, iv = ?, user_id = ? WHERE id = ?")
            .bind(&new_enc)
            .bind(&new_iv)
            .bind(&keeper)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(err500("update obs"))?;
    }

    // Move/clean the remaining user-keyed rows.
    for stmt in [
        "DELETE FROM observations_decrypted WHERE user_id = ?",
        "DELETE FROM board_status WHERE user_id = ?",
        "DELETE FROM assignment_board_status WHERE user_id = ?",
        "DELETE FROM student_summary WHERE user_id = ?",
        "DELETE FROM recovery_tokens WHERE user_id = ?",
        "DELETE FROM user_convention_cards WHERE user_id = ?",
    ] {
        sqlx::query(stmt).bind(&away).execute(&mut *tx).await.map_err(err500("cleanup"))?;
    }
    // Grants where away is either side are now meaningless (its data is the keeper's).
    sqlx::query("DELETE FROM sharing_grants WHERE grantor_id = ? OR grantee_id = ?")
        .bind(&away)
        .bind(&away)
        .execute(&mut *tx)
        .await
        .map_err(err500("cleanup grants"))?;
    // Classroom memberships: fold into keeper (dedupe), then drop away's.
    sqlx::query(
        "INSERT OR IGNORE INTO classroom_members (classroom_id, student_id, joined_at) \
         SELECT classroom_id, ?, joined_at FROM classroom_members WHERE student_id = ?",
    )
    .bind(&keeper)
    .bind(&away)
    .execute(&mut *tx)
    .await
    .map_err(err500("move memberships"))?;
    sqlx::query("DELETE FROM classroom_members WHERE student_id = ?")
        .bind(&away)
        .execute(&mut *tx)
        .await
        .map_err(err500("drop memberships"))?;
    // Individual (student) assignments move to the keeper.
    sqlx::query("UPDATE assignments SET student_id = ? WHERE student_id = ?")
        .bind(&keeper)
        .bind(&away)
        .execute(&mut *tx)
        .await
        .map_err(err500("move assignments"))?;

    // Stage the handoff row (30-day window; safe at rest, wrapped under K_away).
    let now = chrono::Utc::now();
    let expires_at = now + chrono::Duration::days(30);
    sqlx::query(
        "INSERT INTO account_handoff (from_user_id, encrypted_payload, iv, created_at, expires_at, used) \
         VALUES (?, ?, ?, ?, ?, 0) \
         ON CONFLICT(from_user_id) DO UPDATE SET \
           encrypted_payload = excluded.encrypted_payload, iv = excluded.iv, \
           created_at = excluded.created_at, expires_at = excluded.expires_at, used = 0",
    )
    .bind(&away)
    .bind(&handoff_payload)
    .bind(&handoff_iv)
    .bind(now.to_rfc3339())
    .bind(expires_at.to_rfc3339())
    .execute(&mut *tx)
    .await
    .map_err(err500("insert handoff"))?;

    // Finally, remove the merged-away user row (its FK rows are moved/cleared).
    sqlx::query("DELETE FROM users WHERE id = ?")
        .bind(&away)
        .execute(&mut *tx)
        .await
        .map_err(err500("delete away user"))?;

    tx.commit().await.map_err(err500("commit"))?;

    // Post-commit, idempotent: rebuild the keeper's rollups over its now-larger data.
    for (subfolder, deal_number) in &affected_boards {
        if let Err(e) = recompute_board_history(&state.db, &keeper, subfolder, *deal_number).await {
            tracing::error!("merge recompute board {}/{} for {}: {}", subfolder, deal_number, keeper, e);
        }
    }
    for assignment_id in &affected_assignments {
        if let Err(e) = recompute_assignment_boards(&state.db, &keeper, assignment_id).await {
            tracing::error!("merge recompute assignment {} for {}: {}", assignment_id, keeper, e);
        }
    }
    if let Err(e) = recompute_student_summary(&state.db, &keeper).await {
        tracing::error!("merge recompute summary for {}: {}", keeper, e);
    }

    tracing::info!(
        "Merged account {} into {} ({} observations moved)",
        away, keeper, observations_moved
    );

    Ok(Json(MergeResponse {
        success: true,
        observations_moved,
        keeper_email: Some(kemail),
        error: None,
    }))
}

// ---------------------------------------------------------------------------
// Handoff serve + consume (called by the merged-away device on next load).
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct HandoffQuery {
    pub from_user_id: String,
}

#[derive(Debug, Serialize)]
pub struct HandoffResponse {
    pub encrypted_payload: String,
    pub iv: String,
}

/// GET /api/account-handoff?from_user_id=X — returns the wrapped keeper identity
/// for a pending (unused, unexpired) handoff, else 404. No special auth: the
/// payload is wrapped under the requesting device's own key.
pub async fn get_account_handoff(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<HandoffQuery>,
) -> Result<Json<HandoffResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }
    let now = chrono::Utc::now().to_rfc3339();
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT encrypted_payload, iv FROM account_handoff \
         WHERE from_user_id = ? AND used = 0 AND expires_at > ?",
    )
    .bind(&q.from_user_id)
    .bind(&now)
    .fetch_optional(&state.db)
    .await
    .map_err(err500("handoff lookup"))?;

    match row {
        Some((encrypted_payload, iv)) => {
            tracing::info!("account-handoff served to device for {}", q.from_user_id);
            Ok(Json(HandoffResponse { encrypted_payload, iv }))
        }
        None => Err((StatusCode::NOT_FOUND, "No handoff".to_string())),
    }
}

#[derive(Debug, Deserialize)]
pub struct HandoffConsumeRequest {
    pub from_user_id: String,
}

/// POST /api/account-handoff/consume { from_user_id } — single-use marker.
pub async fn consume_account_handoff(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<HandoffConsumeRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }
    let result = sqlx::query("UPDATE account_handoff SET used = 1 WHERE from_user_id = ? AND used = 0")
        .bind(&req.from_user_id)
        .execute(&state.db)
        .await
        .map_err(err500("consume handoff"))?;
    if result.rows_affected() > 0 {
        tracing::info!(
            "account-handoff CONSUMED for {} — device switched to the keeper",
            req.from_user_id
        );
    }
    Ok(Json(serde_json::json!({ "success": true })))
}

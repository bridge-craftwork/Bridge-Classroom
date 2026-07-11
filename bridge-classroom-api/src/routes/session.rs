//! Durable per-user sessions (ADR-0004).
//!
//! A first-party, host-only, `HttpOnly` cookie carries an opaque random token;
//! only its SHA-256 hash is stored (in the `sessions` table), so a DB read can't
//! reconstruct a usable session. The cookie is minted at proven-identity moments
//! (today: recovery-claim — see `recovery.rs`) and restores *identity only* —
//! never key material (that stays behind the recovery flow; see §S5 / ADR-0004).
//!
//! This is the "missing middle tier" between the shared `x-api-key` (casual
//! filter) and ADR-0003 signed requests (privileged ops): a cheap, server-
//! verified `user_id` on every request, which is what the §S7 ownership checks
//! will authorize against in Phase 4.
//!
//! NOTE: this cookie is set but does not round-trip cross-origin in prod until
//! Phase 2 pins CORS with `allow_credentials(true)` AND Phase 3 has the frontend
//! send `credentials: 'include'`. (Phase 2 is backward-compatible and ships
//! backend-first; the two phases need not be coordinated — only frontend-first
//! is unsafe.) The machinery is inert-but-correct until both land.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Instant;

use axum::{
    extract::State,
    http::{header, HeaderMap, StatusCode},
    Json,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;

use crate::routes::recovery::decrypt_for_recovery;
use crate::AppState;

/// Durable session lifetime. ADR-0004 open item — 180 days is the near-term
/// "long" target; revisit alongside a rotation policy.
pub const SESSION_MAX_AGE_SECS: i64 = 60 * 60 * 24 * 180;

/// Cookie name. With `Secure` we use the browser-enforced `__Host-` prefix
/// (implies Secure + host-only + `Path=/`). Plain-http local dev
/// (`cookie_secure = false`) drops the prefix so the cookie is still storable.
fn cookie_name(secure: bool) -> &'static str {
    if secure {
        "__Host-bc_session"
    } else {
        "bc_session"
    }
}

fn generate_session_token() -> String {
    let rng = SystemRandom::new();
    let mut bytes = [0u8; 32];
    rng.fill(&mut bytes).expect("Failed to generate session token");
    BASE64
        .encode(bytes)
        .replace('+', "-")
        .replace('/', "_")
        .replace('=', "")
}

/// SHA-256 of the raw token — this is what's stored/looked-up, never the token.
pub fn hash_session_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

fn header_str(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

/// Coarse device class from the User-Agent, for distinct-device metrics.
/// Deliberately rough — this is a signal, not fingerprinting.
fn coarse_platform(ua: &str) -> String {
    let ua = ua.to_lowercase();
    if ua.contains("ipad") {
        "ipad"
    } else if ua.contains("iphone") {
        "iphone"
    } else if ua.contains("android") {
        "android"
    } else if ua.contains("macintosh") || ua.contains("mac os") {
        "mac"
    } else if ua.contains("windows") {
        "windows"
    } else {
        "other"
    }
    .to_string()
}

/// Create a new **device session** with `user_id` as its first roster member and
/// active user (ADR-0004 §3a). Captures coarse device info (`CF-Connecting-IP` is
/// the real client behind the CF tunnel). Returns the RAW token for the cookie;
/// only its hash is persisted.
pub async fn create_session(
    db: &SqlitePool,
    user_id: &str,
    headers: &HeaderMap,
) -> Result<String, sqlx::Error> {
    let token = generate_session_token();
    let id = hash_session_token(&token);
    let now = chrono::Utc::now();
    let now_s = now.to_rfc3339();
    let expires = now + chrono::Duration::seconds(SESSION_MAX_AGE_SECS);

    let ip = header_str(headers, "cf-connecting-ip");
    let user_agent = header_str(headers, "user-agent");
    let platform = user_agent.as_deref().map(coarse_platform);

    sqlx::query(
        r#"
        INSERT INTO sessions (id, user_id, active_user_id, created_at, expires_at, revoked_at, ip, user_agent, platform)
        VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(user_id)
    .bind(user_id)
    .bind(&now_s)
    .bind(expires.to_rfc3339())
    .bind(ip)
    .bind(user_agent)
    .bind(platform)
    .execute(db)
    .await?;

    // First roster member (the admission gate — proven via recovery/registration).
    sqlx::query(
        "INSERT OR IGNORE INTO session_users (session_id, user_id, added_at, last_active) VALUES (?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(user_id)
    .bind(&now_s)
    .bind(&now_s)
    .execute(db)
    .await?;

    Ok(token)
}

/// The session id (== `sha256(token)`) if the cookie names an **active** session
/// (unrevoked, unexpired); else `None`.
pub async fn active_session_id(db: &SqlitePool, token: &str) -> Option<String> {
    let id = hash_session_token(token);
    let now = chrono::Utc::now().to_rfc3339();
    let ok = sqlx::query_scalar::<_, i64>(
        "SELECT 1 FROM sessions WHERE id = ? AND revoked_at IS NULL AND expires_at > ?",
    )
    .bind(&id)
    .bind(&now)
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
    .is_some();
    if ok {
        Some(id)
    } else {
        None
    }
}

/// The session's `active_user_id` resume hint (a bookmark — never an authz input).
async fn session_active_user(db: &SqlitePool, session_id: &str) -> Option<String> {
    sqlx::query_scalar::<_, Option<String>>("SELECT active_user_id FROM sessions WHERE id = ?")
        .bind(session_id)
        .fetch_optional(db)
        .await
        .ok()
        .flatten()
        .flatten()
}

/// The roster `user_id`s of a session, newest-active first (for resume fallback).
async fn session_member_ids(db: &SqlitePool, session_id: &str) -> Vec<String> {
    sqlx::query_scalar::<_, String>(
        "SELECT user_id FROM session_users WHERE session_id = ? ORDER BY last_active DESC",
    )
    .bind(session_id)
    .fetch_all(db)
    .await
    .unwrap_or_default()
}

/// Admit `user_id` to the device session (ADR-0004 §3a admission gate — callers
/// MUST have proven identity via registration or recovery). If the request already
/// carries a valid device-session cookie, the user JOINS that roster and it becomes
/// active — no new cookie. Otherwise a new device session is created. Returns the
/// raw token IFF a new session was created (so the caller sets a cookie).
pub async fn join_or_create_session(
    state: &AppState,
    headers: &HeaderMap,
    user_id: &str,
) -> Option<String> {
    let now = chrono::Utc::now().to_rfc3339();
    if let Some(token) = parse_session_cookie(headers, state.config.cookie_secure) {
        if let Some(session_id) = active_session_id(&state.db, &token).await {
            // Join the existing device session's roster; make this user active.
            let _ = sqlx::query(
                "INSERT OR IGNORE INTO session_users (session_id, user_id, added_at, last_active) VALUES (?, ?, ?, ?)",
            )
            .bind(&session_id)
            .bind(user_id)
            .bind(&now)
            .bind(&now)
            .execute(&state.db)
            .await;
            let _ = sqlx::query("UPDATE session_users SET last_active = ? WHERE session_id = ? AND user_id = ?")
                .bind(&now)
                .bind(&session_id)
                .bind(user_id)
                .execute(&state.db)
                .await;
            let _ = sqlx::query("UPDATE sessions SET active_user_id = ? WHERE id = ?")
                .bind(user_id)
                .bind(&session_id)
                .execute(&state.db)
                .await;
            bump_last_visit(&state.db, user_id).await;
            return None; // reuse the existing device cookie
        }
    }
    // New device session.
    match create_session(&state.db, user_id, headers).await {
        Ok(token) => {
            bump_last_visit(&state.db, user_id).await;
            Some(token)
        }
        Err(e) => {
            tracing::warn!("Failed to create device session for {}: {}", user_id, e);
            None
        }
    }
}

/// Bump `users.last_visit` (independent analytics metric). Best-effort.
async fn bump_last_visit(db: &SqlitePool, user_id: &str) {
    let now = chrono::Utc::now().to_rfc3339();
    let _ = sqlx::query("UPDATE users SET last_visit = ? WHERE id = ?")
        .bind(&now)
        .bind(user_id)
        .execute(db)
        .await;
}

/// Revoke (sign out) the session identified by a raw token. Idempotent.
pub async fn revoke_session(db: &SqlitePool, token: &str) -> Result<(), sqlx::Error> {
    let id = hash_session_token(token);
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
        .bind(&now)
        .bind(&id)
        .execute(db)
        .await?;
    Ok(())
}

/// The `Set-Cookie` value that installs the session.
pub fn build_session_cookie(token: &str, secure: bool) -> String {
    let mut c = format!(
        "{}={}; HttpOnly; SameSite=Lax; Path=/; Max-Age={}",
        cookie_name(secure),
        token,
        SESSION_MAX_AGE_SECS
    );
    if secure {
        c.push_str("; Secure");
    }
    c
}

/// The `Set-Cookie` value that clears the session (sign-out).
pub fn clear_session_cookie(secure: bool) -> String {
    let mut c = format!(
        "{}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
        cookie_name(secure)
    );
    if secure {
        c.push_str("; Secure");
    }
    c
}

/// Extract the raw session token from the request's `Cookie` header, if present.
pub fn parse_session_cookie(headers: &HeaderMap, secure: bool) -> Option<String> {
    let name = cookie_name(secure);
    let raw = headers.get(header::COOKIE)?.to_str().ok()?;
    for part in raw.split(';') {
        let part = part.trim();
        if let Some((k, v)) = part.split_once('=') {
            if k == name {
                return Some(v.to_string());
            }
        }
    }
    None
}

/// Resolve the active **device-session id** from the cookie, or 401. Phase 4 §S7
/// ownership checks authorize against **roster membership** of this session — never
/// `active_user_id` (a bookmark). Returns the session id (`sha256(token)`).
pub async fn require_session(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<String, (StatusCode, String)> {
    let token = parse_session_cookie(headers, state.config.cookie_secure)
        .ok_or((StatusCode::UNAUTHORIZED, "No session".to_string()))?;
    active_session_id(&state.db, &token)
        .await
        .ok_or((StatusCode::UNAUTHORIZED, "Invalid or expired session".to_string()))
}

/// Admit `user_id` to the device session on a proven-identity flow (recovery /
/// registration) and return a `Set-Cookie` header — but only when a NEW device
/// session was created. Joining an existing device roster reuses its cookie (empty
/// header map). Used by the recovery-claim and registration wrappers.
pub async fn mint_cookie_header(state: &AppState, headers: &HeaderMap, user_id: &str) -> HeaderMap {
    let mut out = HeaderMap::new();
    if let Some(token) = join_or_create_session(state, headers, user_id).await {
        let cookie = build_session_cookie(&token, state.config.cookie_secure);
        if let Ok(value) = cookie.parse() {
            out.insert(header::SET_COOKIE, value);
        }
    }
    out
}

/// A roster member in the `GET /api/session` restore packet (identity only).
#[derive(Debug, Serialize)]
pub struct RosterMember {
    pub user_id: String,
    pub first_name: String,
    pub last_name: String,
    pub email: String,
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub classroom: Option<String>,
}

/// Response for `GET /api/session` — the device roster + active-user hint, NO key
/// material (that's the separate `GET /api/session/key` batch). ADR-0004 §3a.
#[derive(Debug, Serialize)]
pub struct SessionResponse {
    pub authenticated: bool,
    pub roster: Vec<RosterMember>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_user_id: Option<String>,
}

fn unauthenticated() -> SessionResponse {
    SessionResponse {
        authenticated: false,
        roster: Vec::new(),
        active_user_id: None,
    }
}

/// GET /api/session — restore the device roster + resume-as hint from the cookie.
pub async fn get_session(State(state): State<AppState>, headers: HeaderMap) -> Json<SessionResponse> {
    let session_id = match require_session(&state, &headers).await {
        Ok(sid) => sid,
        Err(_) => return Json(unauthenticated()),
    };

    let member_ids = session_member_ids(&state.db, &session_id).await;
    let mut roster = Vec::new();
    for uid in &member_ids {
        if let Ok(Some((id, first_name, last_name, email, classroom, role))) =
            sqlx::query_as::<_, (String, String, String, Option<String>, Option<String>, String)>(
                "SELECT id, first_name, last_name, email, classroom, role FROM users WHERE id = ?",
            )
            .bind(uid)
            .fetch_optional(&state.db)
            .await
        {
            roster.push(RosterMember {
                user_id: id,
                first_name,
                last_name,
                email: email.unwrap_or_default(),
                role,
                classroom,
            });
        }
    }

    if roster.is_empty() {
        return Json(unauthenticated());
    }

    let active_user_id = session_active_user(&state.db, &session_id).await;
    if let Some(ref a) = active_user_id {
        bump_last_visit(&state.db, a).await; // restore = authenticated activity
    }

    Json(SessionResponse {
        authenticated: true,
        roster,
        active_user_id,
    })
}

/// DELETE /api/session — revoke the current session and clear the cookie.
pub async fn delete_session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> (HeaderMap, Json<SessionResponse>) {
    if let Some(token) = parse_session_cookie(&headers, state.config.cookie_secure) {
        let _ = revoke_session(&state.db, &token).await;
    }
    let mut out = HeaderMap::new();
    if let Ok(value) = clear_session_cookie(state.config.cookie_secure).parse() {
        out.insert(header::SET_COOKIE, value);
    }
    (out, Json(unauthenticated()))
}

// --- Key redelivery (ADR-0004 §3) -----------------------------------------

/// Per-user rate limit for key redelivery. Conservative to start (ADR-0004 open
/// item — tune to the observed silent-restore cadence). In-memory; resets on
/// restart; single instance — acceptable, same posture as the §S4 limiter.
const KEY_REDELIVERY_MAX: u32 = 20;
const KEY_REDELIVERY_WINDOW_SECS: u64 = 3600;

static KEY_REDELIVERY_LIMITER: LazyLock<Mutex<HashMap<String, (Instant, u32)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Returns false once a user exceeds `KEY_REDELIVERY_MAX` in the window.
fn allow_key_redelivery(user_id: &str) -> bool {
    // Poison-tolerant (a panic elsewhere shouldn't wedge redelivery) — cf. §C12.
    let mut limiter = KEY_REDELIVERY_LIMITER
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let now = Instant::now();
    limiter.retain(|_, (start, _)| now.duration_since(*start).as_secs() < KEY_REDELIVERY_WINDOW_SECS);
    let entry = limiter.entry(user_id.to_string()).or_insert((now, 0));
    if now.duration_since(entry.0).as_secs() >= KEY_REDELIVERY_WINDOW_SECS {
        *entry = (now, 0);
    }
    entry.1 += 1;
    entry.1 <= KEY_REDELIVERY_MAX
}

/// One roster member's redelivered key material.
#[derive(Debug, Serialize)]
pub struct MemberKey {
    pub user_id: String,
    pub secret_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub viewer_private_key: Option<String>,
}

/// Batch key-redelivery response — keys for EVERY roster member of the device
/// session (ADR-0004 §3a).
#[derive(Debug, Serialize)]
pub struct SessionKeyResponse {
    pub keys: Vec<MemberKey>,
}

/// GET /api/session/key — **batch** redelivery of the escrowed AES key (and, for
/// teachers/admins, the viewer private key) for **every member of the device
/// session's roster**, over the authenticated TLS channel (ADR-0004 §3/§3a).
///
/// Accepts **no user identifiers** — the set is the session's roster, determined
/// server-side. Batch-vs-per-switch adds no security (a cookie holder could loop
/// switch-and-fetch anyway, and roster admission already required email proof on
/// this device). Reuses `decrypt_for_recovery` — one escrow impl, shared with the
/// email-recovery flow. Rate-limited per device session; one audit line per restore
/// listing the members delivered.
pub async fn get_session_key(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<SessionKeyResponse>, (StatusCode, String)> {
    let token = parse_session_cookie(&headers, state.config.cookie_secure)
        .ok_or((StatusCode::UNAUTHORIZED, "No session".to_string()))?;
    let session_id = active_session_id(&state.db, &token)
        .await
        .ok_or((StatusCode::UNAUTHORIZED, "Invalid or expired session".to_string()))?;

    let recovery_secret = state.config.recovery_secret.as_ref().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        "Key recovery is not configured".to_string(),
    ))?;

    // Rate-limit per device session (not per user — the roster is fetched together).
    if !allow_key_redelivery(&session_id) {
        tracing::warn!(
            "Key redelivery rate-limited for session {}…",
            &session_id[..16.min(session_id.len())]
        );
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            "Too many key requests. Please wait and try again.".to_string(),
        ));
    }

    let member_ids = session_member_ids(&state.db, &session_id).await;
    let mut keys = Vec::new();
    let mut delivered = Vec::new();

    for uid in &member_ids {
        let row = sqlx::query_as::<_, (Option<String>, String, Option<String>)>(
            "SELECT recovery_encrypted_key, role, email FROM users WHERE id = ?",
        )
        .bind(uid)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        let Some((encrypted_key, role, email)) = row else { continue };
        let Some(encrypted_key) = encrypted_key else { continue };
        let Ok(secret_key) = decrypt_for_recovery(&encrypted_key, recovery_secret) else {
            tracing::error!("Key redelivery: failed to unwrap AES key for {}", uid);
            continue;
        };

        // Teachers/admins also get their viewer private key (the owner-gated channel
        // that replaced the get_user leak — §S5, restated).
        let viewer_private_key = if role == "teacher" || role == "admin" {
            let email = email.unwrap_or_default();
            sqlx::query_scalar::<_, Option<String>>(
                "SELECT recovery_encrypted_private_key FROM viewers WHERE email = ?",
            )
            .bind(&email)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten()
            .flatten()
            .and_then(|enc| decrypt_for_recovery(&enc, recovery_secret).ok())
        } else {
            None
        };

        keys.push(MemberKey {
            user_id: uid.clone(),
            secret_key,
            viewer_private_key,
        });
        delivered.push(uid.clone());
    }

    // One audit line per restore listing session + delivered members.
    tracing::info!(
        "Key redelivery: session={}… members=[{}] at={}",
        &session_id[..16.min(session_id.len())],
        delivered.join(","),
        chrono::Utc::now().to_rfc3339()
    );

    Ok(Json(SessionKeyResponse { keys }))
}

/// POST /api/session/active-user — fire-and-forget bookmark of the active member.
/// A resume-as convenience, **never** an authorization input (ADR-0004 §3a). Only a
/// current roster member of THIS device session may become active.
#[derive(Debug, Deserialize)]
pub struct SetActiveUserRequest {
    pub user_id: String,
}

pub async fn set_active_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<SetActiveUserRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let session_id = require_session(&state, &headers).await?;
    let now = chrono::Utc::now().to_rfc3339();

    let updated = sqlx::query(
        r#"UPDATE sessions SET active_user_id = ?
           WHERE id = ? AND EXISTS (
               SELECT 1 FROM session_users WHERE session_id = ? AND user_id = ?
           )"#,
    )
    .bind(&req.user_id)
    .bind(&session_id)
    .bind(&session_id)
    .bind(&req.user_id)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if updated.rows_affected() == 0 {
        return Err((
            StatusCode::BAD_REQUEST,
            "Not a roster member of this session".to_string(),
        ));
    }

    let _ = sqlx::query(
        "UPDATE session_users SET last_active = ? WHERE session_id = ? AND user_id = ?",
    )
    .bind(&now)
    .bind(&session_id)
    .bind(&req.user_id)
    .execute(&state.db)
    .await;
    bump_last_visit(&state.db, &req.user_id).await;

    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_hash_is_stable_and_not_the_token() {
        let h1 = hash_session_token("abc");
        let h2 = hash_session_token("abc");
        assert_eq!(h1, h2);
        assert_ne!(h1, "abc");
        assert_eq!(h1.len(), 64); // sha256 hex
    }

    #[test]
    fn secure_cookie_uses_host_prefix_and_secure() {
        let c = build_session_cookie("tok", true);
        assert!(c.starts_with("__Host-bc_session=tok"));
        assert!(c.contains("; Secure"));
        assert!(c.contains("; HttpOnly"));
        assert!(c.contains("; SameSite=Lax"));
        assert!(c.contains("; Path=/"));
    }

    #[test]
    fn insecure_cookie_drops_prefix_and_secure() {
        let c = build_session_cookie("tok", false);
        assert!(c.starts_with("bc_session=tok"));
        assert!(!c.contains("Secure"));
    }

    #[test]
    fn clear_cookie_expires_immediately() {
        assert!(clear_session_cookie(true).contains("Max-Age=0"));
    }

    #[test]
    fn parse_reads_the_named_cookie_among_others() {
        let mut h = HeaderMap::new();
        h.insert(
            header::COOKIE,
            "foo=1; __Host-bc_session=xyz; bar=2".parse().unwrap(),
        );
        assert_eq!(parse_session_cookie(&h, true).as_deref(), Some("xyz"));
        // Wrong name for the secure flag → not found.
        assert_eq!(parse_session_cookie(&h, false), None);
    }
}

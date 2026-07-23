//! Multiplayer table sessions (plan: multiplayer bridge tables, phases 2-3).
//!
//! The Mac API is the system of record for session *metadata*
//! (`table_sessions` table); live table state — boards, seats, auctions,
//! play — lives in bridge-table-service memory. Session creation streams
//! the raw PBN straight to the service's `POST /admin/sessions` endpoint
//! (auth: `X-Service-Secret` = the shared `TABLE_TICKET_SECRET`); nothing
//! here parses boards. The Mac↔droplet seam stays thin on purpose: ticket
//! mint (table_tickets.rs) + session create/close (here).
//!
//! # Persistent join codes (kind-scoped)
//!
//! Two evergreen per-user codes back the join URLs, and each addresses exactly
//! ONE kind of session so they never cross-resolve:
//! - `host_code`  → `/play/:hostCode`   — the CLASS link (teachers only) →
//!   the owner's open `teacher_set` multi-table classroom (the console).
//! - `invite_code`→ `/table/:inviteCode` — the TABLE link (any signed-in user) →
//!   the owner's open casual `adhoc` table.
//!
//! Format: `<slug>-<XXXX>` — the user's first name lowercased to `[a-z0-9]`
//! (max 12 chars, fallback `"table"`) plus 4 random chars from an
//! unambiguous alphabet (no 0/O/1/I/L), e.g. `rick-4X7Q`. Unlike the
//! BRG-XXXX classroom codes these are *permanent* — generated once,
//! idempotently returned thereafter — so bookmarks stay valid; the
//! session-specific part of a teacher URL travels in the `#fragment`.
//!
//! # One open session per owner, PER KIND
//!
//! Opening a new session closes the owner's previous open one OF THE SAME KIND
//! (DB status + best-effort service-side delete), so each code is unambiguous —
//! and a teacher can run a `teacher_set` classroom and an `adhoc` casual table
//! at the same time without one superseding the other.

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::AppState;

/// Budget for admin calls to the table service. Session creation is a
/// user-facing action; fail fast rather than hang the join screen.
const SERVICE_CALL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

fn validate_api_key(headers: &HeaderMap, expected_key: &str) -> bool {
    headers
        .get("x-api-key")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|k| k == expected_key)
}

// ---- Persistent code generation ----

/// Unambiguous code alphabet: uppercase alphanumerics minus 0/O, 1/I/L —
/// these codes get read aloud in classrooms.
const CODE_ALPHABET: &[u8] = b"23456789ABCDEFGHJKMNPQRSTUVWXYZ";

fn code_suffix() -> String {
    use ring::rand::{SecureRandom, SystemRandom};
    let rng = SystemRandom::new();
    let mut buf = [0u8; 4];
    rng.fill(&mut buf).expect("Failed to generate random bytes");
    buf.iter()
        .map(|b| CODE_ALPHABET[*b as usize % CODE_ALPHABET.len()] as char)
        .collect()
}

/// Lowercased `[a-z0-9]` slug of a first name, max 12 chars, fallback
/// "table" (e.g. for names entirely outside ASCII).
fn slugify(first_name: &str) -> String {
    let slug: String = first_name
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(12)
        .collect();
    if slug.is_empty() {
        "table".to_string()
    } else {
        slug
    }
}

fn generate_persistent_code(first_name: &str) -> String {
    format!("{}-{}", slugify(first_name), code_suffix())
}

// ---- Table service admin client (the thin seam) ----

/// Body for the table service's `POST /admin/sessions`.
fn service_create_payload(
    id: &str,
    kind: &str,
    boards_pbn: &str,
    table_count: i64,
    seat_policy: &Value,
    owner_sub: &str,
) -> Value {
    json!({
        "id": id,
        "kind": kind,
        "boards_pbn": boards_pbn,
        "table_count": table_count,
        "seat_policy": seat_policy,
        "owner_sub": owner_sub,
    })
}

async fn service_create_session(
    base_url: &str,
    secret: &str,
    payload: &Value,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(SERVICE_CALL_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(format!("{}/admin/sessions", base_url.trim_end_matches('/')))
        .header("X-Service-Secret", secret)
        .json(payload)
        .send()
        .await
        .map_err(|e| format!("table service unreachable: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("table service rejected session: {status} {body}"));
    }
    Ok(())
}

/// Best-effort session delete on the service. Failures are logged, not
/// surfaced: the DB row is the record; a stale in-memory session on the
/// service is harmless (tickets for it expire) and dies with its process.
async fn service_close_session(base_url: &str, secret: &str, session_id: &str) {
    let client = match reqwest::Client::builder()
        .timeout(SERVICE_CALL_TIMEOUT)
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("table service client build failed: {e}");
            return;
        }
    };
    let url = format!(
        "{}/admin/sessions/{}",
        base_url.trim_end_matches('/'),
        session_id
    );
    match client
        .delete(&url)
        .header("X-Service-Secret", secret)
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {}
        Ok(resp) => tracing::warn!(
            "table service close for {session_id} returned {}",
            resp.status()
        ),
        Err(e) => tracing::warn!("table service close for {session_id} failed: {e}"),
    }
}

// ---- Row / response shapes ----

#[derive(sqlx::FromRow)]
struct SessionRow {
    id: String,
    kind: String,
    owner_user_id: String,
    classroom_id: Option<String>,
    exercise_id: Option<String>,
    status: String,
    seat_policy: String,
    table_count: i64,
    created_at: String,
    closed_at: Option<String>,
}

#[derive(Serialize)]
pub struct SessionInfo {
    pub id: String,
    pub kind: String,
    pub owner_user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub classroom_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exercise_id: Option<String>,
    pub status: String,
    /// Parsed seat-policy JSON (stored as TEXT, surfaced structured).
    pub seat_policy: Value,
    pub table_count: i64,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub closed_at: Option<String>,
}

impl From<SessionRow> for SessionInfo {
    fn from(r: SessionRow) -> Self {
        let seat_policy =
            serde_json::from_str(&r.seat_policy).unwrap_or(Value::String(r.seat_policy.clone()));
        SessionInfo {
            id: r.id,
            kind: r.kind,
            owner_user_id: r.owner_user_id,
            classroom_id: r.classroom_id,
            exercise_id: r.exercise_id,
            status: r.status,
            seat_policy,
            table_count: r.table_count,
            created_at: r.created_at,
            closed_at: r.closed_at,
        }
    }
}

// ---- POST /api/table-sessions ----

#[derive(Deserialize)]
pub struct CreateSessionRequest {
    pub owner_user_id: String,
    /// "teacher_set" (requires teacher/admin role) or "adhoc".
    pub kind: String,
    pub classroom_id: Option<String>,
    pub exercise_id: Option<String>,
    /// Raw PBN text; forwarded verbatim to the table service, which parses
    /// it (bridge-encodings) and owns board validity. **Optional/empty** →
    /// the session starts idle (no deal loaded) and the teacher sends a
    /// source later via the console (`load_boards`, roadmap §Phase 3.1).
    #[serde(default)]
    pub boards_pbn: String,
    pub table_count: Option<i64>,
    /// Seat-policy JSON, e.g. {"mode":"manual"} or
    /// {"mode":"auto","pattern":"one_per_seat","seats":["S"]}.
    /// Defaults to first-free auto-seating.
    pub seat_policy: Option<Value>,
}

#[derive(Serialize)]
pub struct CreateSessionResponse {
    pub success: bool,
    pub session: SessionInfo,
    /// The owner's persistent join codes, if generated — lets the UI show
    /// the /play/:hostCode / /table/:inviteCode URL without a second call.
    pub owner_host_code: Option<String>,
    pub owner_invite_code: Option<String>,
}

pub async fn create_table_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateSessionRequest>,
) -> Result<Json<CreateSessionResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }
    let Some(secret) = state.config.table_ticket_secret.as_deref() else {
        // Same graceful degradation as ticket minting: frontend can show
        // "multiplayer tables aren't set up yet".
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "table sessions are not configured".to_string(),
        ));
    };

    if req.kind != "teacher_set" && req.kind != "adhoc" {
        return Err((
            StatusCode::BAD_REQUEST,
            "kind must be 'teacher_set' or 'adhoc'".to_string(),
        ));
    }
    // boards_pbn may be empty: an idle session (no deal loaded). The teacher
    // sends a source later from the console (roadmap §Phase 3.1). The table
    // service accepts an empty board set and starts the rooms idle.
    // 0 is allowed: a session can start with no tables (student-fill / the
    // console's Add tables create them later — roadmap §Phase 3.2).
    let table_count = req.table_count.unwrap_or(1);
    if !(0..=20).contains(&table_count) {
        return Err((
            StatusCode::BAD_REQUEST,
            "table_count must be between 0 and 20".to_string(),
        ));
    }
    let seat_policy = match req.seat_policy {
        Some(v) if v.is_object() => v,
        Some(_) => {
            return Err((
                StatusCode::BAD_REQUEST,
                "seat_policy must be a JSON object".to_string(),
            ));
        }
        None => json!({ "mode": "auto", "pattern": "first_free" }),
    };

    // Owner must exist; teacher_set requires teacher/admin.
    let row: Option<(String, String, Option<String>, Option<String>)> =
        sqlx::query_as("SELECT role, first_name, host_code, invite_code FROM users WHERE id = ?")
            .bind(&req.owner_user_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let Some((role, _first_name, host_code, invite_code)) = row else {
        return Err((StatusCode::NOT_FOUND, "owner not found".to_string()));
    };
    if req.kind == "teacher_set" && role != "teacher" && role != "admin" {
        return Err((
            StatusCode::FORBIDDEN,
            "only teachers can create teacher_set sessions".to_string(),
        ));
    }

    let now = chrono::Utc::now().to_rfc3339();

    // One open session per owner: opening a new one closes the old (plan).
    // One open session per owner PER KIND: opening a new casual table supersedes
    // the owner's previous casual table but leaves a live classroom (teacher_set)
    // alone, and vice versa. This is what lets the class link (host_code →
    // teacher_set) and the table link (invite_code → adhoc) stay stable and
    // unambiguous at the same time — see resolve_code.
    let stale: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM table_sessions WHERE owner_user_id = ? AND status = 'open' AND kind = ?",
    )
    .bind(&req.owner_user_id)
    .bind(&req.kind)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if !stale.is_empty() {
        sqlx::query(
            "UPDATE table_sessions SET status = 'closed', closed_at = ?
             WHERE owner_user_id = ? AND status = 'open' AND kind = ?",
        )
        .bind(&now)
        .bind(&req.owner_user_id)
        .bind(&req.kind)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        for old_id in &stale {
            tracing::info!("closing superseded {} session {old_id}", req.kind);
            service_close_session(&state.config.table_service_url, secret, old_id).await;
        }
    }

    let id = uuid::Uuid::new_v4().to_string();

    // Service first, then the row: a session the service doesn't know about
    // is unjoinable, so don't record one.
    let payload = service_create_payload(
        &id,
        &req.kind,
        &req.boards_pbn,
        table_count,
        &seat_policy,
        &req.owner_user_id,
    );
    if let Err(e) = service_create_session(&state.config.table_service_url, secret, &payload).await
    {
        tracing::error!("table session create failed at service: {e}");
        return Err((StatusCode::BAD_GATEWAY, e));
    }

    let insert = sqlx::query(
        r#"
        INSERT INTO table_sessions
            (id, kind, owner_user_id, classroom_id, exercise_id, status,
             seat_policy, table_count, created_at)
        VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(&req.kind)
    .bind(&req.owner_user_id)
    .bind(&req.classroom_id)
    .bind(&req.exercise_id)
    .bind(seat_policy.to_string())
    .bind(table_count)
    .bind(&now)
    .execute(&state.db)
    .await;
    if let Err(e) = insert {
        // Don't leave an orphan session live on the service.
        service_close_session(&state.config.table_service_url, secret, &id).await;
        tracing::error!("table session insert failed: {e}");
        return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string()));
    }

    tracing::info!(
        "Created table session {id} ({}, {} tables) for {}",
        req.kind,
        table_count,
        req.owner_user_id
    );

    Ok(Json(CreateSessionResponse {
        success: true,
        session: SessionInfo {
            id,
            kind: req.kind,
            owner_user_id: req.owner_user_id,
            classroom_id: req.classroom_id,
            exercise_id: req.exercise_id,
            status: "open".to_string(),
            seat_policy,
            table_count,
            created_at: now,
            closed_at: None,
        },
        owner_host_code: host_code,
        owner_invite_code: invite_code,
    }))
}

// ---- GET /api/table-sessions/:id (public join info) ----

#[derive(Serialize)]
pub struct SessionJoinInfo {
    pub success: bool,
    pub session: SessionInfo,
    /// Display name for the join screen ("Rick's table session").
    pub owner_name: String,
}

pub async fn get_table_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<Json<SessionJoinInfo>, (StatusCode, String)> {
    // Public endpoint (like GET /api/join/:code): the join page must load
    // before any login. Exposes only session metadata + owner display name.
    let row: Option<SessionRow> = sqlx::query_as(
        "SELECT id, kind, owner_user_id, classroom_id, exercise_id, status,
                seat_policy, table_count, created_at, closed_at
         FROM table_sessions WHERE id = ?",
    )
    .bind(&session_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let Some(row) = row else {
        return Err((StatusCode::NOT_FOUND, "session not found".to_string()));
    };

    let owner_name: Option<(String, String)> =
        sqlx::query_as("SELECT first_name, last_name FROM users WHERE id = ?")
            .bind(&row.owner_user_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let owner_name = owner_name
        .map(|(f, l)| format!("{f} {l}").trim().to_string())
        .unwrap_or_default();

    Ok(Json(SessionJoinInfo {
        success: true,
        session: row.into(),
        owner_name,
    }))
}

// ---- DELETE /api/table-sessions/:id (close) ----

#[derive(Deserialize)]
pub struct CloseSessionQuery {
    /// Must match the session owner (shared-API-key world has no caller
    /// identity; this at least stops cross-user closes by URL guessing).
    pub owner_user_id: String,
}

pub async fn close_table_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
    Query(q): Query<CloseSessionQuery>,
) -> Result<Json<Value>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let row: Option<(String, String)> =
        sqlx::query_as("SELECT owner_user_id, status FROM table_sessions WHERE id = ?")
            .bind(&session_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let Some((owner_user_id, status)) = row else {
        return Err((StatusCode::NOT_FOUND, "session not found".to_string()));
    };
    if owner_user_id != q.owner_user_id {
        // Allow admins to close anyone's session.
        let role: Option<String> = sqlx::query_scalar("SELECT role FROM users WHERE id = ?")
            .bind(&q.owner_user_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        if role.as_deref() != Some("admin") {
            return Err((
                StatusCode::FORBIDDEN,
                "only the session owner can close it".to_string(),
            ));
        }
    }

    if status == "open" {
        let now = chrono::Utc::now().to_rfc3339();
        sqlx::query("UPDATE table_sessions SET status = 'closed', closed_at = ? WHERE id = ?")
            .bind(&now)
            .bind(&session_id)
            .execute(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        if let Some(secret) = state.config.table_ticket_secret.as_deref() {
            service_close_session(&state.config.table_service_url, secret, &session_id).await;
        }
        tracing::info!("Closed table session {session_id}");
    }

    Ok(Json(json!({ "success": true })))
}

// ---- GET /api/play/:host_code & GET /api/table/:invite_code ----

#[derive(Serialize)]
pub struct CodeResolution {
    pub success: bool,
    /// Display name of the code's owner ("Rick Wilson"), for the join page
    /// header even when no session is live.
    pub host_name: String,
    /// The owner's currently open session, or null (page shows "no active
    /// session — check back at class time").
    pub session: Option<SessionInfo>,
}

/// The owner's currently-open session **of a given kind**, or `None`.
///
/// Kind-scoping is a security boundary, not a nicety: a student's table link
/// (`invite_code` → `adhoc`) must never resolve to a teacher's classroom
/// (`teacher_set`), and the two evergreen links a teacher owns must not
/// cross-resolve. Split out so the `AND kind = ?` filter is guarded by a test.
async fn open_session_of_kind(
    db: &sqlx::SqlitePool,
    owner_id: &str,
    kind: &str,
) -> Result<Option<SessionRow>, sqlx::Error> {
    sqlx::query_as(
        "SELECT id, kind, owner_user_id, classroom_id, exercise_id, status,
                seat_policy, table_count, created_at, closed_at
         FROM table_sessions
         WHERE owner_user_id = ? AND status = 'open' AND kind = ?
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind(owner_id)
    .bind(kind)
    .fetch_optional(db)
    .await
}

async fn resolve_code(
    state: &AppState,
    column: &str, // "host_code" | "invite_code" — internal constants only
    kind: &str,   // "teacher_set" | "adhoc" — the session KIND this code addresses
    code: &str,
) -> Result<Json<CodeResolution>, (StatusCode, String)> {
    let user: Option<(String, String, String)> = sqlx::query_as(&format!(
        "SELECT id, first_name, last_name FROM users WHERE {column} = ?"
    ))
    .bind(code)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let Some((user_id, first, last)) = user else {
        return Err((StatusCode::NOT_FOUND, "unknown code".to_string()));
    };

    // `host_code` is the CLASS link → the teacher's multi-table `teacher_set`
    // classroom (the console). `invite_code` is the TABLE link → the owner's
    // casual `adhoc` table. If the matching kind isn't open, `session` is null
    // and the join page shows "no active class/table" — it does NOT fall through
    // to the other kind. Paired with the per-kind open invariant
    // (create_table_session), a teacher can run a class and a casual table at
    // once, each link stable.
    let session = open_session_of_kind(&state.db, &user_id, kind)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(CodeResolution {
        success: true,
        host_name: format!("{first} {last}").trim().to_string(),
        session: session.map(Into::into),
    }))
}

/// GET /api/play/:host_code — public: teacher's evergreen URL → open session.
pub async fn resolve_host_code(
    State(state): State<AppState>,
    Path(code): Path<String>,
) -> Result<Json<CodeResolution>, (StatusCode, String)> {
    // Class link → the teacher's multi-table classroom.
    resolve_code(&state, "host_code", "teacher_set", &code).await
}

/// GET /api/table/:invite_code — public: player's social URL → open casual table.
pub async fn resolve_invite_code(
    State(state): State<AppState>,
    Path(code): Path<String>,
) -> Result<Json<CodeResolution>, (StatusCode, String)> {
    // Table link → the owner's casual adhoc table.
    resolve_code(&state, "invite_code", "adhoc", &code).await
}

// ---- POST /api/users/:id/host-code & /api/users/:id/invite-code ----

#[derive(Serialize)]
pub struct CodeResponse {
    pub success: bool,
    pub code: String,
}

/// Generate (once) and return a persistent code for the user. Idempotent:
/// an existing code is returned unchanged so join URLs never break.
async fn ensure_code(
    state: &AppState,
    user_id: &str,
    column: &str, // "host_code" | "invite_code" — internal constants only
    teacher_only: bool,
) -> Result<Json<CodeResponse>, (StatusCode, String)> {
    let row: Option<(String, String, Option<String>)> = sqlx::query_as(&format!(
        "SELECT role, first_name, {column} FROM users WHERE id = ?"
    ))
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let Some((role, first_name, existing)) = row else {
        return Err((StatusCode::NOT_FOUND, "user not found".to_string()));
    };
    if teacher_only && role != "teacher" && role != "admin" {
        return Err((
            StatusCode::FORBIDDEN,
            "host codes are for teachers".to_string(),
        ));
    }
    if let Some(code) = existing {
        return Ok(Json(CodeResponse {
            success: true,
            code,
        }));
    }

    // Retry on the (unlikely) suffix collision — the partial unique index
    // rejects duplicates.
    for _ in 0..5 {
        let code = generate_persistent_code(&first_name);
        let result = sqlx::query(&format!(
            "UPDATE users SET {column} = ? WHERE id = ? AND {column} IS NULL"
        ))
        .bind(&code)
        .bind(user_id)
        .execute(&state.db)
        .await;
        match result {
            Ok(r) if r.rows_affected() == 1 => {
                tracing::info!("Generated {column} '{code}' for {user_id}");
                return Ok(Json(CodeResponse {
                    success: true,
                    code,
                }));
            }
            Ok(_) => {
                // Raced with another request that set it; return theirs.
                let code: Option<String> =
                    sqlx::query_scalar(&format!("SELECT {column} FROM users WHERE id = ?"))
                        .bind(user_id)
                        .fetch_optional(&state.db)
                        .await
                        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
                        .flatten();
                if let Some(code) = code {
                    return Ok(Json(CodeResponse {
                        success: true,
                        code,
                    }));
                }
            }
            Err(e) if e.to_string().contains("UNIQUE") => continue,
            Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
        }
    }
    Err((
        StatusCode::INTERNAL_SERVER_ERROR,
        "failed to generate a unique code".to_string(),
    ))
}

/// POST /api/users/:id/host-code — teachers/admins only.
pub async fn generate_host_code(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
) -> Result<Json<CodeResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }
    ensure_code(&state, &user_id, "host_code", true).await
}

/// POST /api/users/:id/invite-code — any user.
pub async fn generate_invite_code(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
) -> Result<Json<CodeResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }
    ensure_code(&state, &user_id, "invite_code", false).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::SqlitePool;

    /// Minimal table_sessions schema for the kind-scoping test (no service, no FKs).
    async fn sessions_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query(
            r#"CREATE TABLE table_sessions (
                   id TEXT PRIMARY KEY,
                   kind TEXT NOT NULL,
                   owner_user_id TEXT NOT NULL,
                   classroom_id TEXT,
                   exercise_id TEXT,
                   status TEXT NOT NULL DEFAULT 'open',
                   seat_policy TEXT NOT NULL,
                   table_count INTEGER NOT NULL DEFAULT 1,
                   created_at TEXT NOT NULL,
                   closed_at TEXT
               )"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    async fn add_session(pool: &SqlitePool, id: &str, kind: &str, owner: &str, status: &str) {
        sqlx::query(
            "INSERT INTO table_sessions
               (id, kind, owner_user_id, status, seat_policy, table_count, created_at)
             VALUES (?, ?, ?, ?, '{}', 1, ?)",
        )
        .bind(id)
        .bind(kind)
        .bind(owner)
        .bind(status)
        .bind(format!("2026-01-01T00:00:{id:0>2}Z")) // distinct created_at for ORDER BY
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn code_resolution_is_kind_scoped_and_never_crosses() {
        // The security boundary: a table link (adhoc) must never resolve to a
        // classroom (teacher_set), and vice versa — even when the same owner has
        // BOTH open at once.
        let pool = sessions_db().await;
        add_session(&pool, "1", "teacher_set", "u-teach", "open").await;
        add_session(&pool, "2", "adhoc", "u-teach", "open").await;

        let class = open_session_of_kind(&pool, "u-teach", "teacher_set")
            .await
            .unwrap();
        let table = open_session_of_kind(&pool, "u-teach", "adhoc")
            .await
            .unwrap();
        assert_eq!(
            class.unwrap().id,
            "1",
            "class link → the teacher_set session"
        );
        assert_eq!(table.unwrap().id, "2", "table link → the adhoc session");
    }

    #[tokio::test]
    async fn a_closed_kind_does_not_fall_through_to_the_other() {
        // Class closed but a casual table still open: the class link resolves to
        // nothing, NOT to the adhoc table.
        let pool = sessions_db().await;
        add_session(&pool, "1", "teacher_set", "u-teach", "closed").await;
        add_session(&pool, "2", "adhoc", "u-teach", "open").await;

        let class = open_session_of_kind(&pool, "u-teach", "teacher_set")
            .await
            .unwrap();
        assert!(class.is_none(), "no open class → null, not the adhoc table");
    }

    #[test]
    fn slugify_handles_normal_and_edge_names() {
        assert_eq!(slugify("Rick"), "rick");
        assert_eq!(slugify("Mary-Jo"), "maryjo");
        assert_eq!(slugify("  D'Arcy 3rd  "), "darcy3rd");
        assert_eq!(slugify("北京"), "table"); // non-ASCII → fallback
        assert_eq!(slugify(""), "table");
        assert_eq!(slugify("Bartholomewlongname"), "bartholomewl"); // 12-char cap
    }

    #[test]
    fn code_format_is_slug_dash_4_unambiguous_chars() {
        let code = generate_persistent_code("Rick");
        let (slug, suffix) = code.split_once('-').unwrap();
        assert_eq!(slug, "rick");
        assert_eq!(suffix.len(), 4);
        for c in suffix.chars() {
            assert!(
                CODE_ALPHABET.contains(&(c as u8)),
                "suffix char {c} not in alphabet"
            );
        }
    }

    #[test]
    fn service_payload_matches_admin_contract() {
        // Shape consumed by bridge-table-service POST /admin/sessions.
        let policy = json!({ "mode": "auto", "pattern": "one_per_seat", "seats": ["S"] });
        let p = service_create_payload("s-1", "teacher_set", "[Deal ...]", 2, &policy, "u-owner");
        assert_eq!(p["id"], "s-1");
        assert_eq!(p["kind"], "teacher_set");
        assert_eq!(p["boards_pbn"], "[Deal ...]");
        assert_eq!(p["table_count"], 2);
        assert_eq!(p["seat_policy"]["pattern"], "one_per_seat");
        assert_eq!(p["owner_sub"], "u-owner");
    }
}

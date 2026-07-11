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
//! NOTE: until Phase 2 flips CORS to `allow_credentials(true)` with pinned
//! origins and the frontend sends `credentials: 'include'`, this cookie is set
//! but does not round-trip cross-origin in prod. The machinery is inert-but-
//! correct until then.

use axum::{
    extract::State,
    http::{header, HeaderMap, StatusCode},
    Json,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use ring::rand::{SecureRandom, SystemRandom};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;

use crate::models::{User, UserInfo};
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

/// Insert a new active session for `user_id`, capturing coarse device info from
/// request headers (`CF-Connecting-IP` is the real client behind the CF tunnel).
/// Returns the RAW token to place in the cookie; only its hash is persisted.
pub async fn create_session(
    db: &SqlitePool,
    user_id: &str,
    headers: &HeaderMap,
) -> Result<String, sqlx::Error> {
    let token = generate_session_token();
    let id = hash_session_token(&token);
    let now = chrono::Utc::now();
    let expires = now + chrono::Duration::seconds(SESSION_MAX_AGE_SECS);

    let ip = header_str(headers, "cf-connecting-ip");
    let user_agent = header_str(headers, "user-agent");
    let platform = user_agent.as_deref().map(coarse_platform);

    sqlx::query(
        r#"
        INSERT INTO sessions (id, user_id, created_at, expires_at, revoked_at, ip, user_agent, platform)
        VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(user_id)
    .bind(now.to_rfc3339())
    .bind(expires.to_rfc3339())
    .bind(ip)
    .bind(user_agent)
    .bind(platform)
    .execute(db)
    .await?;

    Ok(token)
}

/// Look up the active (unrevoked, unexpired) session for a raw token.
/// Returns the `user_id`, or `None` for missing/expired/revoked/invalid.
pub async fn lookup_active_session(db: &SqlitePool, token: &str) -> Option<String> {
    let id = hash_session_token(token);
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query_scalar::<_, String>(
        "SELECT user_id FROM sessions WHERE id = ? AND revoked_at IS NULL AND expires_at > ?",
    )
    .bind(&id)
    .bind(&now)
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
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

/// Resolve the authenticated user from the session cookie, or 401. This is the
/// per-user identity the Phase 4 ownership checks (§S7) will authorize against —
/// a *proven* `user_id`, unlike today's client-supplied ids.
pub async fn require_session(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<String, (StatusCode, String)> {
    let token = parse_session_cookie(headers, state.config.cookie_secure)
        .ok_or((StatusCode::UNAUTHORIZED, "No session".to_string()))?;
    lookup_active_session(&state.db, &token)
        .await
        .ok_or((StatusCode::UNAUTHORIZED, "Invalid or expired session".to_string()))
}

/// Attach a freshly-minted session cookie to `extra` when a proven-identity flow
/// succeeds. Callers pass the recovered `user_id`; failures mint nothing. Used by
/// the recovery-claim wrappers in `recovery.rs`.
pub async fn mint_cookie_header(state: &AppState, headers: &HeaderMap, user_id: &str) -> HeaderMap {
    let mut out = HeaderMap::new();
    match create_session(&state.db, user_id, headers).await {
        Ok(token) => {
            let cookie = build_session_cookie(&token, state.config.cookie_secure);
            if let Ok(value) = cookie.parse() {
                out.insert(header::SET_COOKIE, value);
            }
        }
        Err(e) => tracing::warn!("Failed to mint session for {}: {}", user_id, e),
    }
    out
}

/// Response for `GET /api/session` — identity only. The multi-identity roster
/// (`Switch User`) is reconciled client-side from localStorage; the cookie names
/// the *active* user (ADR-0004 caveat 1). Deliberately omits any key material.
#[derive(Debug, Serialize)]
pub struct SessionResponse {
    pub authenticated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<UserInfo>,
}

fn unauthenticated() -> SessionResponse {
    SessionResponse {
        authenticated: false,
        user: None,
    }
}

/// GET /api/session — "who am I" from the session cookie.
pub async fn get_session(State(state): State<AppState>, headers: HeaderMap) -> Json<SessionResponse> {
    let user_id = match require_session(&state, &headers).await {
        Ok(uid) => uid,
        Err(_) => return Json(unauthenticated()),
    };

    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = ?")
        .bind(&user_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();

    match user {
        Some(u) => Json(SessionResponse {
            authenticated: true,
            user: Some(UserInfo::from(u)),
        }),
        None => Json(unauthenticated()),
    }
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

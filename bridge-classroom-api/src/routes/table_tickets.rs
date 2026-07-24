//! Join tickets for the bridge-table-service (multiplayer tables).
//!
//! The table service (droplet) verifies these offline with the shared
//! `TABLE_TICKET_SECRET` — no callback. Wire format matches the reference
//! implementation in bridge-table-service `src/auth.rs`:
//! `base64url(payload_json) + "." + base64url(hmac_sha256(payload_b64))`.
//!
//! Two mint paths:
//! - Registered users: `{ user_id, session_id }` — role comes from the DB
//!   (so a caller can't self-assign "teacher" in the request body).
//! - Guests (Shark-style type-a-name entry): `{ guest_name, session_id }` —
//!   gets a fresh `guest-<uuid>` subject and role "guest", persisted as a
//!   `guest_users` row (display name + session) so the identity outlives
//!   the ticket and can be linked to a real account later
//!   (`linked_user_id`, via the merge machinery).

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ring::hmac;
use serde::{Deserialize, Serialize};

use crate::AppState;

/// Ticket lifetime. Long enough for a full class evening; short enough that
/// a leaked ticket goes stale the same day.
const TICKET_TTL_SECONDS: i64 = 6 * 60 * 60;

#[derive(Deserialize)]
pub struct TicketRequest {
    /// Registered-user path. Mutually exclusive with `guest_name`.
    pub user_id: Option<String>,
    /// Guest path: display name typed at the join screen.
    pub guest_name: Option<String>,
    /// Table session the ticket admits to.
    pub session_id: String,
}

#[derive(Serialize)]
struct TicketPayload {
    sub: String,
    name: String,
    session_id: String,
    role: String,
    exp: i64,
}

#[derive(Serialize)]
pub struct TicketResponse {
    pub ticket: String,
    pub name: String,
    pub role: String,
    pub expires_at: i64,
}

fn validate_api_key(headers: &HeaderMap, expected_key: &str) -> bool {
    headers
        .get("x-api-key")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|k| k == expected_key)
}

/// POST /api/table-tickets
pub async fn mint_table_ticket(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<TicketRequest>,
) -> Result<Json<TicketResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let Some(secret) = state.config.table_ticket_secret.as_deref() else {
        // Same graceful-degradation pattern as the report endpoint: the
        // frontend can show "multiplayer tables aren't set up yet".
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "table tickets are not configured".to_string(),
        ));
    };

    if req.session_id.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "session_id is required".to_string(),
        ));
    }

    let (sub, name, role) = match (&req.user_id, &req.guest_name) {
        (Some(user_id), None) => {
            let row: Option<(String, String, String)> =
                sqlx::query_as("SELECT first_name, last_name, role FROM users WHERE id = ?")
                    .bind(user_id)
                    .fetch_optional(&state.db)
                    .await
                    .map_err(|e| {
                        tracing::error!("table-ticket user lookup failed: {e}");
                        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
                    })?;
            let Some((first, last, db_role)) = row else {
                return Err((StatusCode::NOT_FOUND, "user not found".to_string()));
            };
            // Ticket role is derived from the DB, never from the request.
            let role = match db_role.as_str() {
                "teacher" | "admin" => "teacher",
                _ => "student",
            };
            let name = format!("{first} {last}").trim().to_string();
            (user_id.clone(), name, role.to_string())
        }
        (None, Some(guest_name)) => {
            let name = guest_name.trim();
            if name.is_empty() || name.len() > 60 {
                return Err((StatusCode::BAD_REQUEST, "invalid guest name".to_string()));
            }
            let sub = format!("guest-{}", uuid::Uuid::new_v4());
            // Persist the guest identity (display name + session) so it
            // outlives the ticket and can be linked to a real account later
            // (guest_users.linked_user_id, via the merge machinery).
            sqlx::query(
                "INSERT INTO guest_users (id, display_name, session_id, created_at)
                 VALUES (?, ?, ?, ?)",
            )
            .bind(&sub)
            .bind(name)
            .bind(&req.session_id)
            .bind(chrono::Utc::now().to_rfc3339())
            .execute(&state.db)
            .await
            .map_err(|e| {
                tracing::error!("guest_users insert failed: {e}");
                (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
            })?;
            (sub, name.to_string(), "guest".to_string())
        }
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                "provide exactly one of user_id or guest_name".to_string(),
            ));
        }
    };

    let exp = chrono::Utc::now().timestamp() + TICKET_TTL_SECONDS;
    let payload = TicketPayload {
        sub,
        name: name.clone(),
        session_id: req.session_id.clone(),
        role: role.clone(),
        exp,
    };
    let ticket = mint(&payload, secret);

    tracing::info!(
        "Minted table ticket for {} (role {role}, session {})",
        payload.sub,
        req.session_id
    );

    Ok(Json(TicketResponse {
        ticket,
        name,
        role,
        expires_at: exp,
    }))
}

fn mint(payload: &TicketPayload, secret: &str) -> String {
    let payload_b64 = URL_SAFE_NO_PAD.encode(serde_json::to_vec(payload).unwrap());
    let key = hmac::Key::new(hmac::HMAC_SHA256, secret.as_bytes());
    let sig = hmac::sign(&key, payload_b64.as_bytes());
    let sig_b64 = URL_SAFE_NO_PAD.encode(sig.as_ref());
    format!("{payload_b64}.{sig_b64}")
}

/// Mint a table ticket for an already-known identity — reused by the invitation
/// accept flow, which has already resolved the user + role. Returns
/// `(ticket, exp)`. Same wire format / TTL as the `mint_table_ticket` endpoint.
pub(crate) fn mint_ticket(
    secret: &str,
    sub: &str,
    name: &str,
    session_id: &str,
    role: &str,
) -> (String, i64) {
    let exp = chrono::Utc::now().timestamp() + TICKET_TTL_SECONDS;
    let payload = TicketPayload {
        sub: sub.to_string(),
        name: name.to_string(),
        session_id: session_id.to_string(),
        role: role.to_string(),
        exp,
    };
    (mint(&payload, secret), exp)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mint_format_matches_table_service_reference() {
        // Same shape as bridge-table-service src/auth.rs::mint_ticket —
        // payload b64, dot, HMAC-SHA256 over the b64 payload string.
        let payload = TicketPayload {
            sub: "user-123".into(),
            name: "Alice".into(),
            session_id: "sess-1".into(),
            role: "student".into(),
            exp: 2_000_000_000,
        };
        let token = mint(&payload, "secret");
        let (p, s) = token.split_once('.').unwrap();

        // Deterministic: same payload+secret → same signature.
        assert_eq!(token, mint(&payload, "secret"));

        // Verifiable with ring the way the table service verifies with hmac.
        let key = hmac::Key::new(hmac::HMAC_SHA256, b"secret");
        let sig = URL_SAFE_NO_PAD.decode(s).unwrap();
        hmac::verify(&key, p.as_bytes(), &sig).unwrap();

        // Payload round-trips.
        let decoded = URL_SAFE_NO_PAD.decode(p).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&decoded).unwrap();
        assert_eq!(v["sub"], "user-123");
        assert_eq!(v["role"], "student");
        assert_eq!(v["exp"], 2_000_000_000);
    }
}

//! Table invitations (friendship Phase 4).
//!
//! The headline flow: a host invites an online friend onto a seat at their
//! served table. This API is the trust boundary — it verifies the friendship
//! (the table service has no friend graph), asks the service to hold the seat
//! (a `Reservation`), persists a pending invitation, and pushes an `invitation`
//! event down the invitee's presence stream. **The join token is never sent**
//! (ADR-0006 §2): the invitee is seated through their OWN authenticated session
//! — on accept we mint them a table ticket whose `sub` matches the reservation,
//! and the service seats them directly on connect.
//!
//! - `POST /api/tables/:session_id/invitations` — host invites a friend.
//! - `POST /api/invitations/:id/accept`  — invitee accepts → gets a ticket.
//! - `POST /api/invitations/:id/decline` — invitee declines → seat released.

use std::time::Duration;

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::routes::friends::are_friends;
use crate::routes::session::require_roster_member;
use crate::AppState;

/// Seat-hold lifetime, kept in step with the table service's reservation TTL.
/// A few minutes: enough to cover a host setting up the table while friends sign
/// on (the BBO/Zoom pattern), short enough that an unclaimed hold frees itself.
const RESERVATION_TTL_SECS: i64 = 300;
const SERVICE_CALL_TIMEOUT: Duration = Duration::from_secs(5);
const SEATS: [&str; 4] = ["N", "E", "S", "W"];

#[derive(Deserialize)]
pub struct CreateInvitationBody {
    /// The host (proven against the session cookie).
    pub acting_user_id: String,
    pub friend_user_id: String,
    /// Seat to hold: "N" | "E" | "S" | "W".
    pub seat: String,
}

#[derive(Deserialize)]
pub struct ActingBody {
    pub acting_user_id: String,
}

fn db_err<E: std::fmt::Display>(e: E) -> (StatusCode, String) {
    tracing::error!("invitations query failed: {e}");
    (StatusCode::INTERNAL_SERVER_ERROR, "database error".into())
}

/// The ticket role for someone joining a table to PLAY. The table service reads
/// `teacher` as "session controller, no chair", so anyone accepting a social
/// invitation must carry this instead of their account role.
const PLAYER_TICKET_ROLE: &str = "student";

/// `(display name, ticket role)` for a user, or None if there's no such user.
/// Role is derived from the DB (never trusted from a request), mirroring
/// `mint_table_ticket`. Note the ACCEPT path deliberately ignores the role it
/// returns — see `PLAYER_TICKET_ROLE`.
async fn user_name_role(
    state: &AppState,
    id: &str,
) -> Result<Option<(String, String)>, sqlx::Error> {
    let row: Option<(String, String, String)> =
        sqlx::query_as("SELECT first_name, last_name, role FROM users WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.db)
            .await?;
    Ok(row.map(|(f, l, role)| {
        let name = format!("{f} {l}").trim().to_string();
        let ticket_role = match role.as_str() {
            "teacher" | "admin" => "teacher",
            _ => "student",
        };
        (name, ticket_role.to_string())
    }))
}

fn table_secret(state: &AppState) -> Result<&str, (StatusCode, String)> {
    state.config.table_ticket_secret.as_deref().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        "table invitations are not configured".into(),
    ))
}

/// Ask the table service to hold `seat` for `sub` (the friend's future ticket
/// subject). Admin channel, `X-Service-Secret`.
async fn service_reserve(
    state: &AppState,
    secret: &str,
    session_id: &str,
    seat: &str,
    sub: &str,
    name: &str,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(SERVICE_CALL_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!(
        "{}/admin/sessions/{}/reservations",
        state.config.table_service_url.trim_end_matches('/'),
        session_id
    );
    let resp = client
        .post(url)
        .header("X-Service-Secret", secret)
        .json(&json!({ "seat": seat, "sub": sub, "name": name, "ttl_secs": RESERVATION_TTL_SECS }))
        .send()
        .await
        .map_err(|e| format!("table service unreachable: {e}"))?;
    if resp.status().is_success() {
        Ok(())
    } else {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        Err(format!("reserve rejected: {status} {body}"))
    }
}

/// Best-effort release of a held seat (decline / cleanup). Failures are logged,
/// not surfaced — the reservation also expires on its own.
async fn service_cancel(state: &AppState, secret: &str, session_id: &str, seat: &str) {
    let Ok(client) = reqwest::Client::builder()
        .timeout(SERVICE_CALL_TIMEOUT)
        .build()
    else {
        return;
    };
    let url = format!(
        "{}/admin/sessions/{}/reservations",
        state.config.table_service_url.trim_end_matches('/'),
        session_id
    );
    if let Err(e) = client
        .delete(url)
        .header("X-Service-Secret", secret)
        .json(&json!({ "seat": seat }))
        .send()
        .await
    {
        tracing::warn!("reservation cancel failed: {e}");
    }
}

/// Push any pending, unexpired invitations for `user_id` down their presence
/// stream. Called when they CONNECT — so a friend who signs on during a
/// reservation window sees the invitation without the host re-inviting (the
/// point of reservations in the BBO/Zoom setup: the host doesn't watch for
/// sign-ins). Idempotent on the client (toasts dedupe by invitation id).
pub async fn deliver_pending(state: &AppState, user_id: &str) {
    let now = chrono::Utc::now().to_rfc3339();
    let rows: Vec<(String, String, String, String, String)> = match sqlx::query_as(
        r#"
        SELECT i.id, i.session_id, i.seat, u.first_name, u.last_name
        FROM table_invitations i
        JOIN users u ON u.id = i.from_user_id
        WHERE i.to_user_id = ?1 AND i.status = 'pending' AND i.expires_at > ?2
        "#,
    )
    .bind(user_id)
    .bind(&now)
    .fetch_all(&state.db)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("pending-invitation delivery query failed: {e}");
            return;
        }
    };
    if rows.is_empty() {
        return;
    }
    tracing::info!(
        event = "invitations_redelivered", to = %user_id, count = rows.len(),
        "re-pushing pending invitations on connect"
    );
    for (id, session_id, seat, first, last) in rows {
        let from_name = format!("{first} {last}").trim().to_string();
        tracing::info!(
            event = "invitation_delivered",
            invitation = %id, session = %session_id, seat = %seat, to = %user_id,
            "invitation pushed to presence stream"
        );
        crate::routes::presence::notify(
            user_id,
            &json!({
                "invitation": { "id": id, "session_id": session_id, "seat": seat, "from_name": from_name }
            }),
        );
    }
}

// ---- POST /api/tables/:session_id/invitations ----

pub async fn create_invitation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
    Json(body): Json<CreateInvitationBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    require_roster_member(&state, &headers, &body.acting_user_id).await?;
    let host = body.acting_user_id;
    let friend = body.friend_user_id;
    if host == friend {
        return Err((StatusCode::BAD_REQUEST, "cannot invite yourself".into()));
    }
    let seat = body.seat.trim().to_uppercase();
    if !SEATS.contains(&seat.as_str()) {
        return Err((StatusCode::BAD_REQUEST, "bad seat".into()));
    }

    // The host must own this open session.
    let owner: Option<(String,)> =
        sqlx::query_as("SELECT owner_user_id FROM table_sessions WHERE id = ? AND status = 'open'")
            .bind(&session_id)
            .fetch_optional(&state.db)
            .await
            .map_err(db_err)?;
    let Some((owner_id,)) = owner else {
        return Err((StatusCode::NOT_FOUND, "no such open table".into()));
    };
    if owner_id != host {
        return Err((StatusCode::FORBIDDEN, "not your table".into()));
    }

    // Only a friend may be invited (the trust boundary — ADR-0005/§Phase 4).
    if !are_friends(&state, &host, &friend).await.map_err(db_err)? {
        return Err((StatusCode::FORBIDDEN, "not friends".into()));
    }

    let Some((friend_name, _)) = user_name_role(&state, &friend).await.map_err(db_err)? else {
        return Err((StatusCode::NOT_FOUND, "friend not found".into()));
    };
    let host_name = user_name_role(&state, &host)
        .await
        .map_err(db_err)?
        .map(|(n, _)| n)
        .unwrap_or_default();

    let secret = table_secret(&state)?;
    // Hold the seat first — if the service rejects (seat taken, unreachable),
    // don't persist a dangling invitation.
    service_reserve(&state, secret, &session_id, &seat, &friend, &friend_name)
        .await
        .map_err(|e| {
            tracing::warn!(
                event = "invitation_reserve_failed",
                session = %session_id, seat = %seat, to = %friend,
                "{e}"
            );
            (StatusCode::CONFLICT, "could not hold that seat".into())
        })?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now();
    let created = now.to_rfc3339();
    let expires = (now + chrono::Duration::seconds(RESERVATION_TTL_SECS)).to_rfc3339();
    sqlx::query(
        "INSERT INTO table_invitations
           (id, session_id, seat, from_user_id, to_user_id, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)",
    )
    .bind(&id)
    .bind(&session_id)
    .bind(&seat)
    .bind(&host)
    .bind(&friend)
    .bind(&created)
    .bind(&expires)
    .execute(&state.db)
    .await
    .map_err(db_err)?;

    // Live-notify the friend down their presence stream. NO join token (§2) —
    // acceptance mints them their own ticket.
    crate::routes::presence::notify(
        &friend,
        &json!({
            "invitation": {
                "id": id,
                "session_id": session_id,
                "seat": seat,
                "from_name": host_name,
                "expires_at": expires,
            }
        }),
    );

    tracing::info!(
        event = "invitation_created",
        invitation = %id, session = %session_id, seat = %seat,
        from = %host, to = %friend, expires_at = %expires,
        "invitation created"
    );

    Ok(Json(json!({ "success": true, "id": id })))
}

// ---- POST /api/invitations/:id/accept ----

pub async fn accept_invitation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<ActingBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    require_roster_member(&state, &headers, &body.acting_user_id).await?;
    let me = body.acting_user_id;

    let row: Option<(String, String, String, String)> = sqlx::query_as(
        "SELECT session_id, to_user_id, status, expires_at FROM table_invitations WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await
    .map_err(db_err)?;
    let Some((session_id, to_user, status, expires_at)) = row else {
        tracing::info!(
            event = "invitation_accept_rejected", reason = "not_found",
            invitation = %id, by = %me, "accept rejected"
        );
        return Err((StatusCode::NOT_FOUND, "invitation not found".into()));
    };
    if to_user != me {
        tracing::warn!(
            event = "invitation_accept_rejected", reason = "not_yours",
            invitation = %id, by = %me, "accept rejected"
        );
        return Err((StatusCode::FORBIDDEN, "not your invitation".into()));
    }
    if status != "pending" {
        tracing::info!(
            event = "invitation_accept_rejected", reason = "not_pending",
            invitation = %id, session = %session_id, by = %me, status = %status,
            "accept rejected"
        );
        return Err((
            StatusCode::CONFLICT,
            "invitation is no longer pending".into(),
        ));
    }
    // The seat hold has its own TTL on the service; a late accept can't seat, so
    // reject it clearly rather than minting a ticket that lands in the lobby.
    let expired = chrono::DateTime::parse_from_rfc3339(&expires_at)
        .map(|t| chrono::Utc::now() >= t.with_timezone(&chrono::Utc))
        .unwrap_or(false);
    if expired {
        sqlx::query("UPDATE table_invitations SET status = 'expired' WHERE id = ?")
            .bind(&id)
            .execute(&state.db)
            .await
            .map_err(db_err)?;
        tracing::info!(
            event = "invitation_accept_rejected", reason = "expired",
            invitation = %id, session = %session_id, by = %me, expires_at = %expires_at,
            "accept rejected"
        );
        return Err((StatusCode::GONE, "invitation expired".into()));
    }

    let secret = table_secret(&state)?;
    let Some((name, _account_role)) = user_name_role(&state, &me).await.map_err(db_err)? else {
        return Err((StatusCode::NOT_FOUND, "user not found".into()));
    };
    // A social invitation is an invitation to PLAY — always a seated player, never the
    // session controller, whatever the invitee's account role happens to be.
    //
    // Minting from the account role gave a teacher/admin a `teacher` ticket, and the
    // table service attaches a teacher ticket as the see-all session controller:
    // session-level, NOT a room participant. The invitee then landed in kibitz beside a
    // seat reserved in their own name, saw an empty table (no room → no deal, four
    // bots), and the host's drag had no live connection to move. Confirmed in the
    // table-service log (bug-artifacts #44, 2026-07-30): the working join logged
    // `seat=W`, the re-invite 4 minutes later logged `role="teacher"` with no room.
    //
    // `/api/table-tickets` has always had this exception — `as_player` downgrades a
    // teacher/admin for exactly this case — and TableLobbyView's social-invite path uses
    // it. This path simply never did.
    let role = PLAYER_TICKET_ROLE;
    let (ticket, exp) =
        crate::routes::table_tickets::mint_ticket(secret, &me, &name, &session_id, role);

    sqlx::query("UPDATE table_invitations SET status = 'accepted' WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await
        .map_err(db_err)?;

    // The ACCEPT is the transition that mattered most on 2026-07-30: establishing
    // that one had succeeded meant reading the SQLite row by hand, because this
    // module logged nothing at info. NEVER log `ticket` — it is a bearer for the
    // seat. The session id is the join key into the table-service log, and is
    // exactly what makes a bundle correlatable (roadmap §3.1/§3.2).
    tracing::info!(
        event = "invitation_accepted",
        invitation = %id, session = %session_id, by = %me, role = %role,
        "invitation accepted — ticket minted"
    );

    Ok(Json(json!({
        "success": true,
        "session_id": session_id,
        "ticket": ticket,
        "name": name,
        "role": role,
        "expires_at": exp,
    })))
}

// ---- POST /api/invitations/:id/decline ----

pub async fn decline_invitation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<ActingBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    require_roster_member(&state, &headers, &body.acting_user_id).await?;
    let me = body.acting_user_id;

    let row: Option<(String, String, String, String, String)> = sqlx::query_as(
        "SELECT session_id, seat, from_user_id, to_user_id, status FROM table_invitations WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await
    .map_err(db_err)?;
    let Some((session_id, seat, from_user, to_user, status)) = row else {
        return Err((StatusCode::NOT_FOUND, "invitation not found".into()));
    };
    if to_user != me {
        return Err((StatusCode::FORBIDDEN, "not your invitation".into()));
    }
    if status == "pending" {
        sqlx::query("UPDATE table_invitations SET status = 'declined' WHERE id = ?")
            .bind(&id)
            .execute(&state.db)
            .await
            .map_err(db_err)?;
        if let Some(secret) = state.config.table_ticket_secret.as_deref() {
            service_cancel(&state, secret, &session_id, &seat).await;
        }
        // Softened host notice (ADR §4). The seat un-reserves via the service's
        // own seats broadcast; this just lets the host's UI note the decline.
        let me_name = user_name_role(&state, &me)
            .await
            .map_err(db_err)?
            .map(|(n, _)| n)
            .unwrap_or_default();
        crate::routes::presence::notify(
            &from_user,
            &json!({ "invitation_declined": { "from_name": me_name, "seat": seat } }),
        );
        tracing::info!(
            event = "invitation_declined",
            invitation = %id, session = %session_id, seat = %seat,
            from = %from_user, by = %me, "invitation declined"
        );
    } else {
        tracing::info!(
            event = "invitation_decline_noop",
            invitation = %id, session = %session_id, by = %me, status = %status,
            "decline on a non-pending invitation"
        );
    }
    Ok(Json(json!({ "success": true })))
}

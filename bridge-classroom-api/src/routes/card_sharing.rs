//! Shared convention cards (#436): invitation links and members.
//!
//! A card's members are its `user_convention_cards` rows, each with a role
//! (owner, editor, viewer; see convention_cards.rs for what each may do). An
//! owner invites a partner with a link carrying a one-off token and a role;
//! whoever opens it while signed in joins with that role. Links expire after
//! 30 days and the owner can revoke them. Every link is on bridge-classroom.org
//! (the shared-cards plan, decision 5).

use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use crate::{
    routes::convention_cards::{can_read, fetch_card, is_admin, require_acting, standing},
    AppState,
};

/// Where a print link points: the .org Worker renders the PDF there.
const PRINT_URL_BASE: &str = "https://bridge-classroom.org/card/print/";

/// How long an invitation link works.
const INVITATION_DAYS: i64 = 30;
/// Where a link sends its recipient: the SPA's join route, on .org.
const JOIN_URL_BASE: &str = "https://bridge-classroom.org/solo-practice-app/#/cards/join/";

type ApiError = (StatusCode, String);

fn db_err(e: sqlx::Error) -> ApiError {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

fn forbidden(msg: &str) -> ApiError {
    (StatusCode::FORBIDDEN, msg.to_string())
}

fn new_token() -> String {
    let mut bytes = [0u8; 32];
    SystemRandom::new()
        .fill(&mut bytes)
        .expect("Failed to generate invitation token");
    URL_SAFE_NO_PAD.encode(bytes)
}

fn valid_invite_role(role: &str) -> bool {
    matches!(role, "editor" | "viewer")
}

/// The caller must own the card (or be an admin).
async fn require_owner(
    state: &AppState,
    headers: &HeaderMap,
    card_id: &str,
    acting_user_id: &str,
) -> Result<crate::models::ConventionCard, ApiError> {
    require_acting(state, headers, acting_user_id).await?;
    let card = fetch_card(&state.db, card_id).await?;
    let who = standing(&state.db, &card, Some(acting_user_id)).await?;
    if !(is_admin(&who.site_role) || who.member_role.as_deref() == Some("owner")) {
        return Err(forbidden("Only the card's owner can do that"));
    }
    if card.visibility == "public" {
        return Err(forbidden("Public cards aren't shared by invitation"));
    }
    Ok(card)
}

// ─────────────────────────────────────────────────────────────────
// Invitations
// ─────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateInvitationRequest {
    pub acting_user_id: String,
    /// "editor" or "viewer".
    pub role: String,
}

#[derive(Debug, Serialize, FromRow)]
pub struct InvitationInfo {
    pub token: String,
    pub role: String,
    pub created_by: String,
    pub created_at: String,
    pub expires_at: String,
}

#[derive(Debug, Serialize)]
pub struct CreateInvitationResponse {
    pub token: String,
    pub url: String,
    pub role: String,
    pub expires_at: String,
}

/// POST /api/cards/:card_id/invitations — owner makes a link.
pub async fn create_card_invitation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(card_id): Path<String>,
    Json(req): Json<CreateInvitationRequest>,
) -> Result<Json<CreateInvitationResponse>, ApiError> {
    if !valid_invite_role(&req.role) {
        return Err((
            StatusCode::BAD_REQUEST,
            "role must be editor or viewer".to_string(),
        ));
    }
    require_owner(&state, &headers, &card_id, &req.acting_user_id).await?;

    let token = new_token();
    let now = chrono::Utc::now();
    let expires_at = (now + chrono::Duration::days(INVITATION_DAYS)).to_rfc3339();
    sqlx::query(
        "INSERT INTO card_invitations (token, card_id, role, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&token)
    .bind(&card_id)
    .bind(&req.role)
    .bind(&req.acting_user_id)
    .bind(now.to_rfc3339())
    .bind(&expires_at)
    .execute(&state.db)
    .await
    .map_err(db_err)?;
    tracing::info!(
        "Card {} invitation ({}) by {}",
        card_id,
        req.role,
        req.acting_user_id
    );

    Ok(Json(CreateInvitationResponse {
        url: format!("{JOIN_URL_BASE}{token}"),
        token,
        role: req.role,
        expires_at,
    }))
}

#[derive(Debug, Deserialize)]
pub struct ActingQuery {
    pub acting_user_id: String,
}

/// GET /api/cards/:card_id/invitations?acting_user_id= — the owner's live links.
pub async fn list_card_invitations(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(card_id): Path<String>,
    Query(q): Query<ActingQuery>,
) -> Result<Json<Vec<InvitationInfo>>, ApiError> {
    require_owner(&state, &headers, &card_id, &q.acting_user_id).await?;
    let now = chrono::Utc::now().to_rfc3339();
    let rows = sqlx::query_as::<_, InvitationInfo>(
        r#"
        SELECT token, role, created_by, created_at, expires_at FROM card_invitations
        WHERE card_id = ? AND revoked_at IS NULL AND expires_at > ?
        ORDER BY created_at DESC
        "#,
    )
    .bind(&card_id)
    .bind(&now)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

/// DELETE /api/cards/:card_id/invitations/:token?acting_user_id= — revoke.
pub async fn revoke_card_invitation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((card_id, token)): Path<(String, String)>,
    Query(q): Query<ActingQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_owner(&state, &headers, &card_id, &q.acting_user_id).await?;
    let done = sqlx::query(
        "UPDATE card_invitations SET revoked_at = ? WHERE token = ? AND card_id = ? AND revoked_at IS NULL",
    )
    .bind(chrono::Utc::now().to_rfc3339())
    .bind(&token)
    .bind(&card_id)
    .execute(&state.db)
    .await
    .map_err(db_err)?;
    if done.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "No such invitation".to_string()));
    }
    Ok(Json(serde_json::json!({ "success": true })))
}

/// A live invitation and its card, or why not: 404 unknown, 410 expired or
/// revoked (or the card is gone).
async fn live_invitation(
    state: &AppState,
    token: &str,
) -> Result<(String, String, String, String), ApiError> {
    let row: Option<(String, String, String, String, Option<String>)> = sqlx::query_as(
        "SELECT card_id, role, created_by, expires_at, revoked_at FROM card_invitations WHERE token = ?",
    )
    .bind(token)
    .fetch_optional(&state.db)
    .await
    .map_err(db_err)?;
    let (card_id, role, created_by, expires_at, revoked_at) = row.ok_or((
        StatusCode::NOT_FOUND,
        "This invitation link isn't valid".to_string(),
    ))?;
    if revoked_at.is_some() || expires_at <= chrono::Utc::now().to_rfc3339() {
        return Err((
            StatusCode::GONE,
            "This invitation has expired or was withdrawn. Ask your partner for a new link."
                .to_string(),
        ));
    }
    Ok((card_id, role, created_by, expires_at))
}

#[derive(Debug, Serialize)]
pub struct InvitationPreview {
    pub card_id: String,
    pub card_name: String,
    pub role: String,
    pub invited_by: String,
    pub expires_at: String,
}

async fn user_name(state: &AppState, user_id: &str) -> String {
    sqlx::query_scalar::<_, String>(
        "SELECT TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) FROM users WHERE id = ?",
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .filter(|n| !n.is_empty())
    .unwrap_or_else(|| "Your partner".to_string())
}

/// GET /api/cards/join/:token — what a link is for, before signing in. The
/// token is the secret; holding it shows the card's name and who sent it.
pub async fn preview_card_invitation(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<Json<InvitationPreview>, ApiError> {
    let (card_id, role, created_by, expires_at) = live_invitation(&state, &token).await?;
    let card = fetch_card(&state.db, &card_id)
        .await
        .map_err(|_| (StatusCode::GONE, "This card no longer exists.".to_string()))?;
    Ok(Json(InvitationPreview {
        card_id,
        card_name: card.name,
        role,
        invited_by: user_name(&state, &created_by).await,
        expires_at,
    }))
}

#[derive(Debug, Deserialize)]
pub struct JoinRequest {
    pub acting_user_id: String,
}

#[derive(Debug, Serialize)]
pub struct JoinResponse {
    pub card_id: String,
    pub card_name: String,
    /// The caller's role on the card after joining.
    pub role: String,
    /// False when they were already a member (nothing changed).
    pub joined: bool,
}

fn role_rank(role: &str) -> u8 {
    match role {
        "owner" => 3,
        "editor" => 2,
        _ => 1,
    }
}

/// POST /api/cards/join/:token — the signed-in caller joins the card with the
/// link's role. Accepting again is harmless, and never lowers a role.
pub async fn join_card(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(token): Path<String>,
    Json(req): Json<JoinRequest>,
) -> Result<Json<JoinResponse>, ApiError> {
    require_acting(&state, &headers, &req.acting_user_id).await?;
    let (card_id, role, _, _) = live_invitation(&state, &token).await?;
    let card = fetch_card(&state.db, &card_id)
        .await
        .map_err(|_| (StatusCode::GONE, "This card no longer exists.".to_string()))?;
    let current = standing(&state.db, &card, Some(&req.acting_user_id))
        .await?
        .member_role;

    let (role, joined) = match current {
        Some(have) if role_rank(&have) >= role_rank(&role) => (have, false),
        Some(_) => {
            sqlx::query(
                "UPDATE user_convention_cards SET role = ? WHERE card_id = ? AND user_id = ?",
            )
            .bind(&role)
            .bind(&card_id)
            .bind(&req.acting_user_id)
            .execute(&state.db)
            .await
            .map_err(db_err)?;
            (role, false)
        }
        None => {
            sqlx::query(
                "INSERT INTO user_convention_cards (id, user_id, card_id, is_primary, label, linked_at, role) VALUES (?, ?, ?, 0, NULL, ?, ?)",
            )
            .bind(uuid::Uuid::new_v4().to_string())
            .bind(&req.acting_user_id)
            .bind(&card_id)
            .bind(chrono::Utc::now().to_rfc3339())
            .bind(&role)
            .execute(&state.db)
            .await
            .map_err(db_err)?;
            (role, true)
        }
    };
    tracing::info!(
        "User {} joined card {} as {}",
        req.acting_user_id,
        card_id,
        role
    );
    Ok(Json(JoinResponse {
        card_id,
        card_name: card.name,
        role,
        joined,
    }))
}

// ─────────────────────────────────────────────────────────────────
// Members
// ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, FromRow)]
pub struct CardMember {
    pub user_id: String,
    pub name: String,
    pub role: String,
}

#[derive(Debug, Deserialize)]
pub struct ViewerQuery {
    pub viewer_id: String,
}

/// GET /api/cards/:card_id/members?viewer_id= — any member sees who shares it.
pub async fn list_card_members(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(card_id): Path<String>,
    Query(q): Query<ViewerQuery>,
) -> Result<Json<Vec<CardMember>>, ApiError> {
    require_acting(&state, &headers, &q.viewer_id).await?;
    let card = fetch_card(&state.db, &card_id).await?;
    let who = standing(&state.db, &card, Some(&q.viewer_id)).await?;
    if who.member_role.is_none() && !is_admin(&who.site_role) {
        return Err(forbidden("Not a member of this card"));
    }
    if card.visibility == "public" {
        return Err(forbidden("Public cards have no member list"));
    }
    let members = sqlx::query_as::<_, CardMember>(
        r#"
        SELECT user_id, name, role FROM (
            SELECT m.user_id,
                   COALESCE(NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), 'Unknown') AS name,
                   CASE WHEN m.user_id = c.owner_id THEN 'owner' ELSE m.role END AS role
            FROM user_convention_cards m
            JOIN convention_cards c ON c.id = m.card_id
            LEFT JOIN users u ON u.id = m.user_id
            WHERE m.card_id = ?
        )
        ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, name
        "#,
    )
    .bind(&card_id)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    Ok(Json(members))
}

#[derive(Debug, Deserialize)]
pub struct ChangeRoleRequest {
    pub acting_user_id: String,
    /// "owner", "editor" or "viewer".
    pub role: String,
}

/// PATCH /api/cards/:card_id/members/:user_id — owner changes a member's role.
/// The card's creator stays an owner.
pub async fn change_card_member_role(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((card_id, user_id)): Path<(String, String)>,
    Json(req): Json<ChangeRoleRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !matches!(req.role.as_str(), "owner" | "editor" | "viewer") {
        return Err((
            StatusCode::BAD_REQUEST,
            "role must be owner, editor or viewer".to_string(),
        ));
    }
    let card = require_owner(&state, &headers, &card_id, &req.acting_user_id).await?;
    if card.owner_id.as_deref() == Some(user_id.as_str()) {
        return Err(forbidden("The card's creator stays its owner"));
    }
    let done =
        sqlx::query("UPDATE user_convention_cards SET role = ? WHERE card_id = ? AND user_id = ?")
            .bind(&req.role)
            .bind(&card_id)
            .bind(&user_id)
            .execute(&state.db)
            .await
            .map_err(db_err)?;
    if done.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            "Not a member of this card".to_string(),
        ));
    }
    Ok(Json(serde_json::json!({ "success": true })))
}

#[derive(Debug, Deserialize)]
pub struct RemoveMemberQuery {
    pub acting_user_id: String,
}

/// DELETE /api/cards/:card_id/members/:user_id?acting_user_id= — an owner
/// removes a member, or a member leaves. The creator can't be removed (they
/// delete the card instead).
pub async fn remove_card_member(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((card_id, user_id)): Path<(String, String)>,
    Query(q): Query<RemoveMemberQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let card = if q.acting_user_id == user_id {
        require_acting(&state, &headers, &q.acting_user_id).await?;
        fetch_card(&state.db, &card_id).await?
    } else {
        require_owner(&state, &headers, &card_id, &q.acting_user_id).await?
    };
    if card.owner_id.as_deref() == Some(user_id.as_str()) {
        return Err(forbidden(
            "The card's creator can't be removed; delete the card instead",
        ));
    }
    let done = sqlx::query("DELETE FROM user_convention_cards WHERE card_id = ? AND user_id = ?")
        .bind(&card_id)
        .bind(&user_id)
        .execute(&state.db)
        .await
        .map_err(db_err)?;
    if done.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            "Not a member of this card".to_string(),
        ));
    }
    tracing::info!(
        "User {} left card {} (by {})",
        user_id,
        card_id,
        q.acting_user_id
    );
    Ok(Json(serde_json::json!({ "success": true })))
}

// ─────────────────────────────────────────────────────────────────
// Print links (#482)
// ─────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct PrintLinkRequest {
    pub acting_user_id: String,
    /// "classic" or "new": change the layout the link prints (owners and
    /// editors). Omitted: keep it.
    #[serde(default)]
    pub template: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PrintLinkResponse {
    pub url: String,
    pub template: String,
}

/// POST /api/cards/:card_id/print-link — the card's read-only PDF link, for
/// anyone who can read the card. The token is minted on first ask and never
/// changes or expires; the PDF always shows the card as it is now.
pub async fn card_print_link(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(card_id): Path<String>,
    Json(req): Json<PrintLinkRequest>,
) -> Result<Json<PrintLinkResponse>, ApiError> {
    require_acting(&state, &headers, &req.acting_user_id).await?;
    let card = fetch_card(&state.db, &card_id).await?;
    let who = standing(&state.db, &card, Some(&req.acting_user_id)).await?;
    if !can_read(&card, &who) {
        return Err(forbidden("Not allowed to read this card"));
    }
    if let Some(t) = req
        .template
        .as_deref()
        .filter(|t| *t != card.print_template)
    {
        if !matches!(t, "classic" | "new") {
            return Err((
                StatusCode::BAD_REQUEST,
                "template must be classic or new".to_string(),
            ));
        }
        let writer = is_admin(&who.site_role)
            || (card.visibility != "public"
                && matches!(who.member_role.as_deref(), Some("owner" | "editor")));
        if !writer {
            return Err(forbidden(
                "Only the card's owners and editors can change its layout",
            ));
        }
        sqlx::query("UPDATE convention_cards SET print_template = ? WHERE id = ?")
            .bind(t)
            .bind(&card_id)
            .execute(&state.db)
            .await
            .map_err(db_err)?;
    }
    if card.print_token.is_none() {
        // Guarded, so two first asks at once settle on one token.
        sqlx::query(
            "UPDATE convention_cards SET print_token = ? WHERE id = ? AND print_token IS NULL",
        )
        .bind(new_token())
        .bind(&card_id)
        .execute(&state.db)
        .await
        .map_err(db_err)?;
    }
    let card = fetch_card(&state.db, &card_id).await?;
    let token = card.print_token.unwrap_or_default();
    Ok(Json(PrintLinkResponse {
        url: format!("{PRINT_URL_BASE}{token}.pdf"),
        template: card.print_template,
    }))
}

#[derive(Debug, Serialize)]
pub struct PrintCard {
    pub name: String,
    pub template: String,
    pub card_data: serde_json::Value,
    pub updated_at: String,
}

/// How long the renderer may take: a render is a third of a second, so this
/// only bounds a renderer that is down or queued up.
const CARD_PDF_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

/// GET /api/cards/print/:token — the card behind a print link. No sign-in:
/// the token is the permission. Without `.pdf`, the card as JSON, only what
/// the PDF needs (no ids, no owner). With it (`:token.pdf`), the card's ACBL
/// PDF, made by card-pdf-service: this is what bridge-classroom.org's Worker
/// forwards a print link (`/card/print/<token>.pdf`) to.
pub async fn print_card(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<Response, ApiError> {
    let pdf = token.ends_with(".pdf");
    let token = token.trim_end_matches(".pdf");
    let card = sqlx::query_as::<_, crate::models::ConventionCard>(
        "SELECT * FROM convention_cards WHERE print_token = ?",
    )
    .bind(token)
    .fetch_optional(&state.db)
    .await
    .map_err(db_err)?
    .ok_or((StatusCode::NOT_FOUND, "No card for this link".to_string()))?;
    let card_data = serde_json::from_str(&card.card_data).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to parse card data: {}", e),
        )
    })?;
    let card = PrintCard {
        name: card.name,
        template: card.print_template,
        card_data,
        updated_at: card.updated_at,
    };
    if !pdf {
        return Ok(Json(card).into_response());
    }
    render_pdf(&state, &card).await
}

/// The card's PDF from card-pdf-service: POST /pdf?template= with the
/// card as `{ name, card_data }`.
async fn render_pdf(state: &AppState, card: &PrintCard) -> Result<Response, ApiError> {
    let unavailable = |why: String| {
        tracing::warn!("card print: {why}");
        (
            StatusCode::BAD_GATEWAY,
            "The convention card couldn't be printed right now. Please try again shortly."
                .to_string(),
        )
    };
    let client = reqwest::Client::builder()
        .timeout(CARD_PDF_TIMEOUT)
        .build()
        .map_err(|e| unavailable(e.to_string()))?;
    let mut req = client
        .post(format!(
            "{}/pdf",
            state.config.card_pdf_url.trim_end_matches('/')
        ))
        .query(&[("template", card.template.as_str())])
        .json(&serde_json::json!({ "name": card.name, "card_data": card.card_data }));
    if let Some(key) = &state.config.card_pdf_key {
        req = req.header("X-Render-Key", key);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| unavailable(format!("renderer unreachable: {e}")))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(unavailable(format!("renderer refused: {status} {body}")));
    }
    let bytes = resp.bytes().await.map_err(|e| unavailable(e.to_string()))?;
    Ok((
        [
            (header::CONTENT_TYPE, "application/pdf".to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("inline; filename=\"{}\"", pdf_filename(card)),
            ),
            (header::CACHE_CONTROL, "public, max-age=300".to_string()),
            (
                header::HeaderName::from_static("x-robots-tag"),
                "noindex".to_string(),
            ),
        ],
        bytes,
    )
        .into_response())
}

/// "Rick-and-Dan.pdf": the partners' names, else the card's, made safe for a
/// header and a file name.
fn pdf_filename(card: &PrintCard) -> String {
    let names = card
        .card_data
        .pointer("/metadata/partner_names")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(&card.name);
    let base: String = names
        .trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '.' | '-' | '_'))
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-");
    format!(
        "{}.pdf",
        if base.is_empty() {
            "convention-card"
        } else {
            &base
        }
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pdf_is_named_for_the_partners() {
        let card = |name: &str, partners: Option<&str>| PrintCard {
            name: name.to_string(),
            template: "classic".to_string(),
            card_data: match partners {
                Some(p) => serde_json::json!({ "metadata": { "partner_names": p } }),
                None => serde_json::json!({}),
            },
            updated_at: String::new(),
        };
        assert_eq!(
            pdf_filename(&card("Our card", Some("Rick & Dan"))),
            "Rick-Dan.pdf"
        );
        assert_eq!(pdf_filename(&card("2/1 \"GF\"", None)), "21-GF.pdf");
        assert_eq!(pdf_filename(&card("♠♥", None)), "convention-card.pdf");
    }

    #[test]
    fn joining_never_lowers_a_role() {
        // join_card keeps the current role when it ranks at least the link's
        assert!(role_rank("owner") > role_rank("editor"));
        assert!(role_rank("editor") > role_rank("viewer"));
        assert_eq!(role_rank("viewer"), role_rank("anything else"));
    }

    #[test]
    fn links_invite_editors_or_viewers_only() {
        assert!(valid_invite_role("editor") && valid_invite_role("viewer"));
        assert!(!valid_invite_role("owner") && !valid_invite_role(""));
    }

    #[test]
    fn tokens_are_url_safe_and_distinct() {
        let (a, b) = (new_token(), new_token());
        assert_ne!(a, b);
        assert_eq!(a.len(), 43); // 32 bytes, base64url without padding
        assert!(a
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }
}

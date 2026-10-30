use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;
use sqlx::SqlitePool;

use crate::{
    models::{
        CardVersionData, CardVersionInfo, CardVersionsResponse, ConventionCard, ConventionCardFull,
        ConventionCardInfo, CreateConventionCardRequest, CreateConventionCardResponse,
        LinkCardRequest, LinkCardResponse, UpdateConventionCardRequest,
        UpdateConventionCardResponse, UserCardInfo, UserCardsResponse,
    },
    routes::session::require_roster_member,
    AppState,
};

/// Query parameters for card listing
#[derive(Debug, Deserialize)]
pub struct CardQuery {
    pub visibility: Option<String>,
    pub owner_id: Option<String>,
}

/// Query parameters for single-card read (optional viewer for authz)
#[derive(Debug, Deserialize)]
pub struct CardReadQuery {
    /// Caller's user id. Omit for an anonymous read (then only public
    /// cards are visible).
    pub viewer_id: Option<String>,
}

/// Query parameters for delete + unlink (the body would have been
/// cleaner, but DELETE bodies are awkward in HTTP).
#[derive(Debug, Deserialize)]
pub struct ActingUserQuery {
    pub acting_user_id: Option<String>,
}

// ─────────────────────────────────────────────────────────────────
// Authorization helpers
// ─────────────────────────────────────────────────────────────────

/// Fetch the role for a user id. Returns None when the user doesn't
/// exist (treat as anonymous).
async fn fetch_caller_role(db: &SqlitePool, user_id: &str) -> Option<String> {
    sqlx::query_scalar::<_, String>("SELECT role FROM users WHERE id = ?")
        .bind(user_id)
        .fetch_optional(db)
        .await
        .ok()
        .flatten()
}

/// The caller really is `user_id`: the session cookie's device roster holds
/// them (ADR-0004 §S7). The ids these routes take are self-asserted, so every
/// id that grants access goes through here first; 401 without a session, 403
/// when the session isn't theirs.
pub(crate) async fn require_acting(
    state: &AppState,
    headers: &HeaderMap,
    user_id: &str,
) -> Result<(), (StatusCode, String)> {
    require_roster_member(state, headers, user_id)
        .await
        .map(|_| ())
}

pub(crate) fn is_admin(role: &Option<String>) -> bool {
    role.as_deref() == Some("admin")
}

/// The caller's standing on a card: their site role (admin?) and their
/// membership role on it ("owner" | "editor" | "viewer", from
/// `user_convention_cards`). The card's `owner_id` (its creator) is always an
/// owner.
pub(crate) struct Standing {
    pub(crate) site_role: Option<String>,
    pub(crate) member_role: Option<String>,
}

pub(crate) async fn standing(
    db: &SqlitePool,
    card: &ConventionCard,
    user_id: Option<&str>,
) -> Result<Standing, (StatusCode, String)> {
    let Some(user_id) = user_id else {
        return Ok(Standing {
            site_role: None,
            member_role: None,
        });
    };
    let site_role = fetch_caller_role(db, user_id).await;
    let member_role = if card.owner_id.as_deref() == Some(user_id) {
        Some("owner".to_string())
    } else {
        sqlx::query_scalar::<_, String>(
            "SELECT role FROM user_convention_cards WHERE card_id = ? AND user_id = ?",
        )
        .bind(&card.id)
        .bind(user_id)
        .fetch_optional(db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    };
    Ok(Standing {
        site_role,
        member_role,
    })
}

/// Read-side check: public cards, admins, and any member.
pub(crate) fn can_read(card: &ConventionCard, who: &Standing) -> bool {
    card.visibility == "public" || is_admin(&who.site_role) || who.member_role.is_some()
}

/// Write-side check: admins, and a private card's owners and editors.
fn can_write(card: &ConventionCard, who: &Standing) -> bool {
    if is_admin(&who.site_role) {
        return true;
    }
    if card.visibility == "public" {
        return false; // only admin can change public cards
    }
    matches!(who.member_role.as_deref(), Some("owner" | "editor"))
}

/// Delete check: admins, and a private card's owners (editors can't).
fn can_delete(card: &ConventionCard, who: &Standing) -> bool {
    is_admin(&who.site_role)
        || (card.visibility != "public" && who.member_role.as_deref() == Some("owner"))
}

/// GET /api/cards
/// List convention cards (public cards or filtered by owner_id)
pub async fn list_cards(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<CardQuery>,
) -> Result<Json<Vec<ConventionCardInfo>>, (StatusCode, String)> {
    if let Some(owner_id) = &query.owner_id {
        require_acting(&state, &headers, owner_id).await?;
    }
    let cards: Vec<ConventionCard> = if let Some(owner_id) = query.owner_id {
        // Get cards owned by specific user OR public cards
        sqlx::query_as::<_, ConventionCard>(
            "SELECT * FROM convention_cards WHERE owner_id = ? OR visibility = 'public' ORDER BY name",
        )
        .bind(&owner_id)
        .fetch_all(&state.db)
        .await
    } else if query.visibility == Some("public".to_string()) {
        // Get only public cards
        sqlx::query_as::<_, ConventionCard>(
            "SELECT * FROM convention_cards WHERE visibility = 'public' ORDER BY name",
        )
        .fetch_all(&state.db)
        .await
    } else {
        // Default: get all public cards
        sqlx::query_as::<_, ConventionCard>(
            "SELECT * FROM convention_cards WHERE visibility = 'public' ORDER BY name",
        )
        .fetch_all(&state.db)
        .await
    }
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let infos: Vec<ConventionCardInfo> = cards.into_iter().map(ConventionCardInfo::from).collect();
    Ok(Json(infos))
}

/// GET /api/cards/:card_id?viewer_id=...
/// Get a specific convention card with full data. Anonymous callers
/// (no viewer_id) can read public cards; private cards require the
/// owner or an admin.
pub async fn get_card(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(card_id): Path<String>,
    Query(query): Query<CardReadQuery>,
) -> Result<Json<ConventionCardFull>, (StatusCode, String)> {
    if let Some(viewer_id) = &query.viewer_id {
        require_acting(&state, &headers, viewer_id).await?;
    }
    let card: Option<ConventionCard> =
        sqlx::query_as::<_, ConventionCard>("SELECT * FROM convention_cards WHERE id = ?")
            .bind(&card_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let card = card.ok_or((StatusCode::NOT_FOUND, "Card not found".to_string()))?;

    let who = standing(&state.db, &card, query.viewer_id.as_deref()).await?;
    if !can_read(&card, &who) {
        return Err((
            StatusCode::FORBIDDEN,
            "Not allowed to read this card".to_string(),
        ));
    }

    let mut full = c_to_full(&card).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to parse card data: {}", e),
        )
    })?;
    full.role = who.member_role;
    Ok(Json(full))
}

// Small wrapper so this module compiles even if the model's `to_full`
// method ever moves; keeps the call site stable.
fn c_to_full(card: &ConventionCard) -> Result<ConventionCardFull, String> {
    card.to_full().map_err(|e| e.to_string())
}

/// POST /api/cards
/// Create a new convention card. Body must include `acting_user_id`;
/// the new card is owned by that user. Public-visibility cards
/// further require the caller to be an admin.
pub async fn create_card(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateConventionCardRequest>,
) -> Result<Json<CreateConventionCardResponse>, (StatusCode, String)> {
    if req.name.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "name is required".to_string()));
    }
    if req.acting_user_id.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "acting_user_id is required".to_string(),
        ));
    }
    require_acting(&state, &headers, &req.acting_user_id).await?;

    let role = fetch_caller_role(&state.db, &req.acting_user_id).await;
    if role.is_none() {
        return Err((
            StatusCode::FORBIDDEN,
            "acting_user_id does not match a known user".to_string(),
        ));
    }

    let visibility = req
        .visibility
        .clone()
        .unwrap_or_else(|| "private".to_string());
    if visibility == "public" && !is_admin(&role) {
        return Err((
            StatusCode::FORBIDDEN,
            "Only admins can create public cards".to_string(),
        ));
    }

    let card = ConventionCard::from_request(&req, Some(req.acting_user_id.clone()));

    sqlx::query(
        r#"
        INSERT INTO convention_cards (id, name, description, format, owner_id, card_data, visibility, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&card.id)
    .bind(&card.name)
    .bind(&card.description)
    .bind(&card.format)
    .bind(&card.owner_id)
    .bind(&card.card_data)
    .bind(&card.visibility)
    .bind(&card.created_at)
    .bind(&card.updated_at)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    record_version(
        &state.db,
        &card.id,
        1,
        &card.card_data,
        &req.acting_user_id,
        &card.created_at,
    )
    .await?;

    tracing::info!(
        "Created convention card: {} ({}) owner={} visibility={}",
        card.name,
        card.id,
        req.acting_user_id,
        card.visibility
    );

    Ok(Json(CreateConventionCardResponse {
        success: true,
        card_id: card.id,
    }))
}

/// PUT /api/cards/:card_id
/// Update an existing convention card. Body must include
/// `acting_user_id`. Admins can update any card; non-admins can only
/// update private cards they own or edit.
pub async fn update_card(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(card_id): Path<String>,
    Json(req): Json<UpdateConventionCardRequest>,
) -> Result<Json<UpdateConventionCardResponse>, (StatusCode, String)> {
    if req.acting_user_id.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "acting_user_id is required".to_string(),
        ));
    }
    require_acting(&state, &headers, &req.acting_user_id).await?;

    let card: Option<ConventionCard> =
        sqlx::query_as::<_, ConventionCard>("SELECT * FROM convention_cards WHERE id = ?")
            .bind(&card_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let card = card.ok_or((StatusCode::NOT_FOUND, "Card not found".to_string()))?;

    let who = standing(&state.db, &card, Some(&req.acting_user_id)).await?;
    if !can_write(&card, &who) {
        return Err((
            StatusCode::FORBIDDEN,
            "Not allowed to edit this card".to_string(),
        ));
    }

    // Visibility changes (public ↔ private) require admin.
    if let Some(new_vis) = &req.visibility {
        if new_vis != &card.visibility && !is_admin(&who.site_role) {
            return Err((
                StatusCode::FORBIDDEN,
                "Only admins can change card visibility".to_string(),
            ));
        }
    }

    // Started from an older version: refuse, and hand back the card as it is
    // now so the editor can merge (base = that older version, from history).
    if let Some(base) = req.base_version {
        if base != card.version {
            return Err(version_conflict(&card));
        }
    }

    let now = chrono::Utc::now().to_rfc3339();
    let new_name = req.name.unwrap_or_else(|| card.name.clone());
    let new_desc = req.description.or(card.description.clone());
    let new_visibility = req.visibility.unwrap_or_else(|| card.visibility.clone());
    let new_card_data = match req.card_data {
        Some(v) => v.to_string(),
        None => card.card_data.clone(),
    };
    let new_version = card.version + 1;

    // Guarded on the version read above, so two saves racing from the same
    // version can't both land: the loser gets the 409.
    let written = sqlx::query(
        r#"
        UPDATE convention_cards
        SET name = ?, description = ?, card_data = ?, visibility = ?, updated_at = ?, version = ?
        WHERE id = ? AND version = ?
        "#,
    )
    .bind(&new_name)
    .bind(&new_desc)
    .bind(&new_card_data)
    .bind(&new_visibility)
    .bind(&now)
    .bind(new_version)
    .bind(&card_id)
    .bind(card.version)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if written.rows_affected() == 0 {
        let current = fetch_card(&state.db, &card_id).await?;
        return Err(version_conflict(&current));
    }
    record_version(
        &state.db,
        &card_id,
        new_version,
        &new_card_data,
        &req.acting_user_id,
        &now,
    )
    .await?;

    tracing::info!(
        "Updated convention card {} to version {} by user {}",
        card_id,
        new_version,
        req.acting_user_id
    );

    Ok(Json(UpdateConventionCardResponse {
        success: true,
        version: new_version,
    }))
}

/// DELETE /api/cards/:card_id?acting_user_id=...
/// Delete a convention card. Admin: any card. Non-admin: private cards
/// they own (not ones they only edit). Cascade-deletes
/// user_convention_cards rows.
pub async fn delete_card(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(card_id): Path<String>,
    Query(query): Query<ActingUserQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let acting_user_id = query.acting_user_id.unwrap_or_default();
    if acting_user_id.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "acting_user_id is required".to_string(),
        ));
    }
    require_acting(&state, &headers, &acting_user_id).await?;

    let card: Option<ConventionCard> =
        sqlx::query_as::<_, ConventionCard>("SELECT * FROM convention_cards WHERE id = ?")
            .bind(&card_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let card = card.ok_or((StatusCode::NOT_FOUND, "Card not found".to_string()))?;

    let who = standing(&state.db, &card, Some(&acting_user_id)).await?;
    if !can_delete(&card, &who) {
        return Err((
            StatusCode::FORBIDDEN,
            "Not allowed to delete this card".to_string(),
        ));
    }

    // Cascade: remove the card's history, invitations and user-card links,
    // then the card.
    sqlx::query("DELETE FROM card_invitations WHERE card_id = ?")
        .bind(&card_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    sqlx::query("DELETE FROM card_versions WHERE card_id = ?")
        .bind(&card_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    sqlx::query("DELETE FROM user_convention_cards WHERE card_id = ?")
        .bind(&card_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    sqlx::query("DELETE FROM convention_cards WHERE id = ?")
        .bind(&card_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tracing::info!(
        "Deleted convention card {} by user {}",
        card_id,
        acting_user_id
    );

    Ok(Json(serde_json::json!({ "success": true })))
}

pub(crate) async fn fetch_card(
    db: &SqlitePool,
    card_id: &str,
) -> Result<ConventionCard, (StatusCode, String)> {
    sqlx::query_as::<_, ConventionCard>("SELECT * FROM convention_cards WHERE id = ?")
        .bind(card_id)
        .fetch_optional(db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Card not found".to_string()))
}

/// The 409 for a save that started from an older version. The body is JSON:
/// `{ "error": "version_conflict", "current": <the card as it is now> }`.
fn version_conflict(card: &ConventionCard) -> (StatusCode, String) {
    let current = card
        .to_full()
        .ok()
        .map(|c| serde_json::to_value(c).unwrap_or_default());
    (
        StatusCode::CONFLICT,
        serde_json::json!({ "error": "version_conflict", "current": current }).to_string(),
    )
}

async fn record_version(
    db: &SqlitePool,
    card_id: &str,
    version: i64,
    card_data: &str,
    saved_by: &str,
    saved_at: &str,
) -> Result<(), (StatusCode, String)> {
    sqlx::query(
        "INSERT OR REPLACE INTO card_versions (card_id, version, card_data, saved_by, saved_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(card_id)
    .bind(version)
    .bind(card_data)
    .bind(saved_by)
    .bind(saved_at)
    .execute(db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(())
}

/// A card a session's user may read, or the error to return.
async fn readable_card(
    state: &AppState,
    headers: &HeaderMap,
    card_id: &str,
    viewer_id: Option<&str>,
) -> Result<ConventionCard, (StatusCode, String)> {
    if let Some(v) = viewer_id {
        require_acting(state, headers, v).await?;
    }
    let card = fetch_card(&state.db, card_id).await?;
    let who = standing(&state.db, &card, viewer_id).await?;
    if !can_read(&card, &who) {
        return Err((
            StatusCode::FORBIDDEN,
            "Not allowed to read this card".to_string(),
        ));
    }
    Ok(card)
}

/// GET /api/cards/:card_id/versions?viewer_id=...
/// The card's saved versions, newest first: who saved each and when.
pub async fn list_card_versions(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(card_id): Path<String>,
    Query(query): Query<CardReadQuery>,
) -> Result<Json<CardVersionsResponse>, (StatusCode, String)> {
    readable_card(&state, &headers, &card_id, query.viewer_id.as_deref()).await?;
    let versions = sqlx::query_as::<_, CardVersionInfo>(
        r#"
        SELECT v.version, v.saved_by,
               NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS saved_by_name,
               v.saved_at
        FROM card_versions v LEFT JOIN users u ON u.id = v.saved_by
        WHERE v.card_id = ?
        ORDER BY v.version DESC
        "#,
    )
    .bind(&card_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(CardVersionsResponse { versions }))
}

/// GET /api/cards/:card_id/versions/:version?viewer_id=...
/// One saved version's card_data: the common base for merging two edits.
pub async fn get_card_version(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((card_id, version)): Path<(String, i64)>,
    Query(query): Query<CardReadQuery>,
) -> Result<Json<CardVersionData>, (StatusCode, String)> {
    readable_card(&state, &headers, &card_id, query.viewer_id.as_deref()).await?;
    let row: Option<(String, Option<String>, String)> = sqlx::query_as(
        "SELECT card_data, saved_by, saved_at FROM card_versions WHERE card_id = ? AND version = ?",
    )
    .bind(&card_id)
    .bind(version)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let (data, saved_by, saved_at) =
        row.ok_or((StatusCode::NOT_FOUND, "No such version".to_string()))?;
    let card_data = serde_json::from_str(&data).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to parse card data: {}", e),
        )
    })?;
    Ok(Json(CardVersionData {
        version,
        card_data,
        saved_by,
        saved_at,
    }))
}

/// GET /api/users/:user_id/cards
/// Get cards linked to a user. Only that user's own session may list them.
pub async fn get_user_cards(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
) -> Result<Json<UserCardsResponse>, (StatusCode, String)> {
    require_acting(&state, &headers, &user_id).await?;

    // Query user_convention_cards joined with convention_cards
    #[allow(clippy::type_complexity)]
    let rows: Vec<(
        String,
        String,
        String,
        bool,
        Option<String>,
        String,
        String,
        i64,
    )> = sqlx::query_as(
        r#"
        SELECT ucc.id, ucc.card_id, cc.name, ucc.is_primary, ucc.label, ucc.linked_at,
               CASE WHEN cc.owner_id = ucc.user_id THEN 'owner' ELSE ucc.role END,
               (SELECT COUNT(*) FROM user_convention_cards m WHERE m.card_id = ucc.card_id)
        FROM user_convention_cards ucc
        JOIN convention_cards cc ON ucc.card_id = cc.id
        WHERE ucc.user_id = ?
        ORDER BY ucc.is_primary DESC, cc.name
        "#,
    )
    .bind(&user_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let cards: Vec<UserCardInfo> = rows
        .into_iter()
        .map(
            |(link_id, card_id, card_name, is_primary, label, linked_at, role, member_count)| {
                UserCardInfo {
                    link_id,
                    card_id,
                    card_name,
                    is_primary,
                    label,
                    linked_at,
                    role,
                    member_count,
                }
            },
        )
        .collect();

    Ok(Json(UserCardsResponse { cards }))
}

/// POST /api/users/:user_id/cards
/// Link a card to a user. `acting_user_id` is required and must be the
/// user themselves or an admin; a private card must also be readable by
/// them (its owner, or an admin).
pub async fn link_card_to_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
    Json(req): Json<LinkCardRequest>,
) -> Result<Json<LinkCardResponse>, (StatusCode, String)> {
    let acting = req
        .acting_user_id
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or((
            StatusCode::BAD_REQUEST,
            "acting_user_id is required".to_string(),
        ))?;
    require_acting(&state, &headers, acting).await?;
    if acting != user_id && !is_admin(&fetch_caller_role(&state.db, acting).await) {
        return Err((
            StatusCode::FORBIDDEN,
            "Only the user themselves or an admin can link a card".to_string(),
        ));
    }

    let card: Option<ConventionCard> =
        sqlx::query_as::<_, ConventionCard>("SELECT * FROM convention_cards WHERE id = ?")
            .bind(&req.card_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let card = card.ok_or((StatusCode::NOT_FOUND, "Card not found".to_string()))?;

    // Private cards: the acting user must be able to read it
    if card.visibility != "public" {
        let who = standing(&state.db, &card, Some(acting)).await?;
        if !can_read(&card, &who) {
            return Err((
                StatusCode::FORBIDDEN,
                "Not allowed to link this card".to_string(),
            ));
        }
    }

    let link_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let is_primary = req.is_primary.unwrap_or(false);

    // If this is marked as primary, unset other primary cards for this user
    if is_primary {
        sqlx::query("UPDATE user_convention_cards SET is_primary = 0 WHERE user_id = ?")
            .bind(&user_id)
            .execute(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    sqlx::query(
        r#"
        INSERT INTO user_convention_cards (id, user_id, card_id, is_primary, label, linked_at, role)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, card_id) DO UPDATE SET
            is_primary = excluded.is_primary,
            label = excluded.label
        "#,
    )
    .bind(&link_id)
    .bind(&user_id)
    .bind(&req.card_id)
    .bind(is_primary)
    .bind(&req.label)
    .bind(&now)
    // A new link is a membership: the card's owner links as owner; anyone else
    // (a public card on their list, or an admin's link) as viewer. An existing
    // link keeps its role.
    .bind(if card.owner_id.as_deref() == Some(user_id.as_str()) {
        "owner"
    } else {
        "viewer"
    })
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tracing::info!("Linked card {} to user {}", req.card_id, user_id);

    Ok(Json(LinkCardResponse {
        success: true,
        link_id,
    }))
}

/// DELETE /api/users/:user_id/cards/:card_id?acting_user_id=...
/// Unlink a card from a user. Allowed when the caller is the same
/// user OR an admin.
pub async fn unlink_card_from_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((user_id, card_id)): Path<(String, String)>,
    Query(query): Query<ActingUserQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let acting_user_id = query.acting_user_id.unwrap_or_default();
    if acting_user_id.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "acting_user_id is required".to_string(),
        ));
    }
    require_acting(&state, &headers, &acting_user_id).await?;
    if acting_user_id != user_id {
        let role = fetch_caller_role(&state.db, &acting_user_id).await;
        if !is_admin(&role) {
            return Err((
                StatusCode::FORBIDDEN,
                "Only the user themselves or an admin can unlink a card".to_string(),
            ));
        }
    }

    sqlx::query("DELETE FROM user_convention_cards WHERE user_id = ? AND card_id = ?")
        .bind(&user_id)
        .bind(&card_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tracing::info!("Unlinked card {} from user {}", card_id, user_id);

    Ok(Json(serde_json::json!({ "success": true })))
}

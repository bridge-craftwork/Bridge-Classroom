use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use sqlx::SqlitePool;

use crate::{
    models::{
        ConventionCard, ConventionCardFull, ConventionCardInfo, CreateConventionCardRequest,
        CreateConventionCardResponse, LinkCardRequest, LinkCardResponse,
        UpdateConventionCardRequest, UpdateConventionCardResponse, UserCardInfo,
        UserCardsResponse,
    },
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

fn is_admin(role: &Option<String>) -> bool {
    role.as_deref() == Some("admin")
}

/// Read-side check: who can see this card?
fn can_read(card: &ConventionCard, viewer_id: Option<&str>, viewer_role: &Option<String>) -> bool {
    if card.visibility == "public" {
        return true;
    }
    if is_admin(viewer_role) {
        return true;
    }
    match (viewer_id, &card.owner_id) {
        (Some(v), Some(o)) => v == o,
        _ => false,
    }
}

/// Write-side check: who can update / delete this card?
fn can_write(card: &ConventionCard, viewer_id: Option<&str>, viewer_role: &Option<String>) -> bool {
    if is_admin(viewer_role) {
        return true;
    }
    if card.visibility == "public" {
        return false; // only admin can change public cards
    }
    match (viewer_id, &card.owner_id) {
        (Some(v), Some(o)) => v == o,
        _ => false,
    }
}

/// GET /api/cards
/// List convention cards (public cards or filtered by owner_id)
pub async fn list_cards(
    State(state): State<AppState>,
    Query(query): Query<CardQuery>,
) -> Result<Json<Vec<ConventionCardInfo>>, (StatusCode, String)> {
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
    Path(card_id): Path<String>,
    Query(query): Query<CardReadQuery>,
) -> Result<Json<ConventionCardFull>, (StatusCode, String)> {
    let card: Option<ConventionCard> =
        sqlx::query_as::<_, ConventionCard>("SELECT * FROM convention_cards WHERE id = ?")
            .bind(&card_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let card = card.ok_or((StatusCode::NOT_FOUND, "Card not found".to_string()))?;

    let viewer_role = match &query.viewer_id {
        Some(id) => fetch_caller_role(&state.db, id).await,
        None => None,
    };
    if !can_read(&card, query.viewer_id.as_deref(), &viewer_role) {
        return Err((StatusCode::FORBIDDEN, "Not allowed to read this card".to_string()));
    }

    let full = c_to_full(&card).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to parse card data: {}", e),
        )
    })?;
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
/// update private cards they own.
pub async fn update_card(
    State(state): State<AppState>,
    Path(card_id): Path<String>,
    Json(req): Json<UpdateConventionCardRequest>,
) -> Result<Json<UpdateConventionCardResponse>, (StatusCode, String)> {
    if req.acting_user_id.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "acting_user_id is required".to_string(),
        ));
    }

    let card: Option<ConventionCard> =
        sqlx::query_as::<_, ConventionCard>("SELECT * FROM convention_cards WHERE id = ?")
            .bind(&card_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let card = card.ok_or((StatusCode::NOT_FOUND, "Card not found".to_string()))?;

    let role = fetch_caller_role(&state.db, &req.acting_user_id).await;
    if !can_write(&card, Some(&req.acting_user_id), &role) {
        return Err((StatusCode::FORBIDDEN, "Not allowed to edit this card".to_string()));
    }

    // Visibility changes (public ↔ private) require admin.
    if let Some(new_vis) = &req.visibility {
        if new_vis != &card.visibility && !is_admin(&role) {
            return Err((
                StatusCode::FORBIDDEN,
                "Only admins can change card visibility".to_string(),
            ));
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

    sqlx::query(
        r#"
        UPDATE convention_cards
        SET name = ?, description = ?, card_data = ?, visibility = ?, updated_at = ?
        WHERE id = ?
        "#,
    )
    .bind(&new_name)
    .bind(&new_desc)
    .bind(&new_card_data)
    .bind(&new_visibility)
    .bind(&now)
    .bind(&card_id)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tracing::info!(
        "Updated convention card {} by user {}",
        card_id,
        req.acting_user_id
    );

    Ok(Json(UpdateConventionCardResponse { success: true }))
}

/// DELETE /api/cards/:card_id?acting_user_id=...
/// Delete a convention card. Admin: any card. Non-admin: own private
/// cards only. Cascade-deletes user_convention_cards rows.
pub async fn delete_card(
    State(state): State<AppState>,
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

    let card: Option<ConventionCard> =
        sqlx::query_as::<_, ConventionCard>("SELECT * FROM convention_cards WHERE id = ?")
            .bind(&card_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let card = card.ok_or((StatusCode::NOT_FOUND, "Card not found".to_string()))?;

    let role = fetch_caller_role(&state.db, &acting_user_id).await;
    if !can_write(&card, Some(&acting_user_id), &role) {
        return Err((StatusCode::FORBIDDEN, "Not allowed to delete this card".to_string()));
    }

    // Cascade: remove user-card links first, then the card.
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

/// GET /api/users/:user_id/cards
/// Get cards linked to a user
pub async fn get_user_cards(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Result<Json<UserCardsResponse>, (StatusCode, String)> {
    // Query user_convention_cards joined with convention_cards
    let rows: Vec<(String, String, String, bool, Option<String>, String)> = sqlx::query_as(
        r#"
        SELECT ucc.id, ucc.card_id, cc.name, ucc.is_primary, ucc.label, ucc.linked_at
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
        .map(|(link_id, card_id, card_name, is_primary, label, linked_at)| UserCardInfo {
            link_id,
            card_id,
            card_name,
            is_primary,
            label,
            linked_at,
        })
        .collect();

    Ok(Json(UserCardsResponse { cards }))
}

/// POST /api/users/:user_id/cards
/// Link a card to a user. Linking a private card requires the
/// `acting_user_id` body field, which must be either the card's owner
/// or an admin. Linking a public card is open to anyone.
pub async fn link_card_to_user(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
    Json(req): Json<LinkCardRequest>,
) -> Result<Json<LinkCardResponse>, (StatusCode, String)> {
    let card: Option<ConventionCard> =
        sqlx::query_as::<_, ConventionCard>("SELECT * FROM convention_cards WHERE id = ?")
            .bind(&req.card_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let card = card.ok_or((StatusCode::NOT_FOUND, "Card not found".to_string()))?;

    // Private cards: require authz from acting_user_id
    if card.visibility != "public" {
        let acting = req
            .acting_user_id
            .as_deref()
            .filter(|s| !s.is_empty())
            .ok_or((
                StatusCode::FORBIDDEN,
                "acting_user_id is required to link a private card".to_string(),
            ))?;
        let role = fetch_caller_role(&state.db, acting).await;
        if !can_read(&card, Some(acting), &role) {
            return Err((StatusCode::FORBIDDEN, "Not allowed to link this card".to_string()));
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
        INSERT INTO user_convention_cards (id, user_id, card_id, is_primary, label, linked_at)
        VALUES (?, ?, ?, ?, ?, ?)
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

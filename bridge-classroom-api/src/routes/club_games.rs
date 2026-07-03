use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};

use crate::models::{
    ClubGameActionResponse, ClubGameDetail, ClubGameDetailResponse, ClubGameListResponse,
    ClubGameQuery, ClubGameSummary, DeleteClubGameQuery, SaveClubGameRequest, SaveClubGameResponse,
};
use crate::AppState;

/// Per-owner storage quota. Club games carry the full normalized JSON (tens of
/// KB each), so this is the real ceiling on what one account can archive. The
/// shared API key is bundled with the frontend (CLAUDE.md), so it can't keep an
/// attacker out — this count is the durable limit. Upserts (same event_key)
/// don't add rows, so the cap bounds distinct games, not re-loads.
const GAMES_LIFETIME: i64 = 5_000;

/// Validate API key from request headers.
fn validate_api_key(headers: &HeaderMap, expected_key: &str) -> bool {
    if let Some(header_key) = headers.get("x-api-key").and_then(|v| v.to_str().ok()) {
        return header_key == expected_key;
    }
    false
}

/// POST /api/club-games — save (upsert) a registered user's analyzed club game.
pub async fn save_club_game(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<SaveClubGameRequest>,
) -> Result<Json<SaveClubGameResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }
    if req.owner.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "owner is required".to_string()));
    }
    if req.payload.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "payload is required".to_string()));
    }

    let now = chrono::Utc::now().to_rfc3339();

    // Upsert by (owner, event_key): a re-loaded game refreshes the existing row
    // (payload + metadata + updated_at) rather than duplicating. Only when an
    // event_key is given — anonymous re-analysis without one always inserts.
    if let Some(ref key) = req.event_key {
        if !key.trim().is_empty() {
            let existing: Option<String> = sqlx::query_scalar(
                "SELECT id FROM club_games WHERE owner = ? AND event_key = ? AND deleted_at IS NULL",
            )
            .bind(&req.owner)
            .bind(key)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            if let Some(id) = existing {
                sqlx::query(
                    r#"
                    UPDATE club_games
                    SET event_name = ?, event_date = ?, location = ?, board_count = ?,
                        payload = ?, updated_at = ?
                    WHERE id = ?
                    "#,
                )
                .bind(&req.event_name)
                .bind(&req.event_date)
                .bind(&req.location)
                .bind(req.board_count)
                .bind(&req.payload)
                .bind(&now)
                .bind(&id)
                .execute(&state.db)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

                tracing::info!("Club game updated: {} for {}", id, req.owner);
                return Ok(Json(SaveClubGameResponse { success: true, id, updated: true }));
            }
        }
    }

    // Insert path — enforce the per-owner lifetime cap first.
    let lifetime: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM club_games WHERE owner = ? AND deleted_at IS NULL")
            .bind(&req.owner)
            .fetch_one(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if lifetime >= GAMES_LIFETIME {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            format!(
                "Club-game limit reached ({} per account). Delete some older games first.",
                GAMES_LIFETIME
            ),
        ));
    }

    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        r#"
        INSERT INTO club_games
            (id, owner, event_key, event_name, event_date, location, board_count, payload, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(&req.owner)
    .bind(&req.event_key)
    .bind(&req.event_name)
    .bind(&req.event_date)
    .bind(&req.location)
    .bind(req.board_count)
    .bind(&req.payload)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to insert club game: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    tracing::info!("Club game saved: {} for {}", id, req.owner);
    Ok(Json(SaveClubGameResponse { success: true, id, updated: false }))
}

/// GET /api/club-games?owner=X — list a user's games (metadata only, no payload).
pub async fn list_club_games(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ClubGameQuery>,
) -> Result<Json<ClubGameListResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }
    if query.owner.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "owner is required".to_string()));
    }

    let games = sqlx::query_as::<_, ClubGameSummary>(
        r#"
        SELECT
            id, owner, event_key, event_name, event_date, location, board_count,
            COALESCE(LENGTH(payload), 0) AS payload_bytes,
            created_at, updated_at
        FROM club_games
        WHERE owner = ? AND deleted_at IS NULL
        ORDER BY COALESCE(event_date, created_at) DESC, created_at DESC
        "#,
    )
    .bind(&query.owner)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to list club games: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    Ok(Json(ClubGameListResponse { success: true, games }))
}

/// GET /api/club-games/:id — fetch one game WITH its normalized JSON payload.
pub async fn get_club_game(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<ClubGameDetailResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let game = sqlx::query_as::<_, ClubGameDetail>(
        r#"
        SELECT id, owner, event_key, event_name, event_date, location, board_count,
               payload, created_at, updated_at
        FROM club_games
        WHERE id = ? AND deleted_at IS NULL
        "#,
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, "Club game not found".to_string()))?;

    Ok(Json(ClubGameDetailResponse { success: true, game }))
}

/// DELETE /api/club-games/:id — soft-delete a game (owner only).
pub async fn delete_club_game(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<DeleteClubGameQuery>,
) -> Result<Json<ClubGameActionResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let owner: Option<String> =
        sqlx::query_scalar("SELECT owner FROM club_games WHERE id = ? AND deleted_at IS NULL")
            .bind(&id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let owner = owner.ok_or_else(|| (StatusCode::NOT_FOUND, "Club game not found".to_string()))?;

    if owner != query.actor_user_id {
        return Err((
            StatusCode::FORBIDDEN,
            "Only the game's owner can delete it".to_string(),
        ));
    }

    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("UPDATE club_games SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL")
        .bind(&now)
        .bind(&id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tracing::info!("Club game soft-deleted: {}", id);
    Ok(Json(ClubGameActionResponse { success: true, error: None }))
}

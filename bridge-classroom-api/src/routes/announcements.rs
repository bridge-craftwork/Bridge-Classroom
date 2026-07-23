use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::AppState;

fn validate_api_key(headers: &HeaderMap, expected_key: &str) -> bool {
    if let Some(header_key) = headers.get("x-api-key").and_then(|v| v.to_str().ok()) {
        return header_key == expected_key;
    }
    false
}

// ---- Types ----

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct AnnouncementRow {
    pub id: String,
    pub message: String,
    #[sqlx(rename = "type")]
    #[serde(rename = "type")]
    pub announcement_type: String,
    pub created_by: String,
    pub created_at: String,
    pub expires_at: Option<String>,
    pub active: i64,
}

#[derive(Debug, Serialize)]
pub struct AnnouncementResponse {
    pub success: bool,
    pub announcement: Option<AnnouncementRow>,
}

#[derive(Debug, Deserialize)]
pub struct SetAnnouncementRequest {
    pub message: String,
    #[serde(rename = "type", default = "default_type")]
    pub announcement_type: String,
    pub expires_at: Option<String>,
}

fn default_type() -> String {
    "info".to_string()
}

// ---- Handlers ----

/// GET /api/announcements/active — public, no auth
pub async fn get_active_announcement(
    State(state): State<AppState>,
) -> Result<Json<AnnouncementResponse>, (StatusCode, String)> {
    let row: Option<AnnouncementRow> = sqlx::query_as(
        r#"
        SELECT id, message, type, created_by, created_at, expires_at, active
        FROM announcements
        WHERE active = 1 AND (expires_at IS NULL OR expires_at > datetime('now'))
        ORDER BY created_at DESC
        LIMIT 1
        "#,
    )
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(AnnouncementResponse {
        success: true,
        announcement: row,
    }))
}

/// POST /api/admin/announcement — requires API key
pub async fn set_announcement(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SetAnnouncementRequest>,
) -> Result<Json<AnnouncementResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    if body.message.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "Message cannot be empty".to_string(),
        ));
    }

    // Deactivate all existing announcements
    sqlx::query("UPDATE announcements SET active = 0")
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Insert new announcement
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    sqlx::query(
        r#"
        INSERT INTO announcements (id, message, type, created_by, created_at, expires_at, active)
        VALUES (?, ?, ?, 'admin', ?, ?, 1)
        "#,
    )
    .bind(&id)
    .bind(body.message.trim())
    .bind(&body.announcement_type)
    .bind(&now)
    .bind(&body.expires_at)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let row: AnnouncementRow = sqlx::query_as(
        "SELECT id, message, type, created_by, created_at, expires_at, active FROM announcements WHERE id = ?",
    )
    .bind(&id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(AnnouncementResponse {
        success: true,
        announcement: Some(row),
    }))
}

/// DELETE /api/admin/announcement — requires API key
pub async fn clear_announcement(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    sqlx::query("UPDATE announcements SET active = 0")
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(serde_json::json!({ "success": true })))
}

use axum::{extract::State, http::StatusCode, Json};
use serde::Serialize;

use crate::AppState;

/// Response containing a public key
#[derive(Debug, Serialize)]
pub struct PublicKeyResponse {
    pub viewer_id: String,
    pub public_key: String,
}

/// GET /api/keys/admin
/// Returns the admin's public key for creating the mandatory admin sharing grant
/// during user registration
pub async fn get_admin_key(
    State(state): State<AppState>,
) -> Result<Json<PublicKeyResponse>, (StatusCode, String)> {
    // Look up the admin viewer
    let admin: Option<(String, String)> =
        sqlx::query_as("SELECT id, public_key FROM viewers WHERE role = 'admin' LIMIT 1")
            .fetch_optional(&state.db)
            .await
            .map_err(|e| {
                tracing::error!("Failed to fetch admin key: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to fetch admin key: {}", e),
                )
            })?;

    match admin {
        Some((id, public_key)) => Ok(Json(PublicKeyResponse {
            viewer_id: id,
            public_key,
        })),
        None => {
            tracing::warn!("Admin viewer not configured");
            Err((StatusCode::NOT_FOUND, "Admin not configured".to_string()))
        }
    }
}

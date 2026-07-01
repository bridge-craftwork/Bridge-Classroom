use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;

use crate::models::{
    CreateViewerRequest, CreateViewerResponse, Viewer, ViewerInfo, ViewerPublicKeyResponse,
};
use crate::routes::recovery::encrypt_for_recovery;
use crate::AppState;

/// Validate API key from request headers
fn validate_api_key(headers: &HeaderMap, expected_key: &str) -> bool {
    headers
        .get("x-api-key")
        .and_then(|v| v.to_str().ok())
        .map(|k| k == expected_key)
        .unwrap_or(false)
}

/// Query parameters for viewer lookup
#[derive(Debug, Deserialize)]
pub struct ViewerQuery {
    pub email: Option<String>,
}

/// Create a new viewer (teacher, partner, admin)
pub async fn create_viewer(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateViewerRequest>,
) -> Result<Json<CreateViewerResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let viewer = Viewer::from_request(&req);

    // Encrypt private key with RECOVERY_SECRET if provided
    let encrypted_private_key = if let (Some(pk), Some(secret)) =
        (&req.private_key, state.config.recovery_secret.as_ref())
    {
        match encrypt_for_recovery(pk, secret) {
            Ok(encrypted) => Some(encrypted),
            Err(e) => {
                tracing::warn!("Failed to encrypt viewer private key: {}", e);
                None
            }
        }
    } else {
        None
    };

    let result = sqlx::query(
        r#"
        INSERT INTO viewers (id, name, email, public_key, role, created_at, recovery_encrypted_private_key)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET
            name = excluded.name,
            public_key = excluded.public_key,
            role = excluded.role,
            recovery_encrypted_private_key = COALESCE(excluded.recovery_encrypted_private_key, viewers.recovery_encrypted_private_key)
        "#,
    )
    .bind(&viewer.id)
    .bind(&viewer.name)
    .bind(&viewer.email)
    .bind(&viewer.public_key)
    .bind(&viewer.role)
    .bind(&viewer.created_at)
    .bind(&encrypted_private_key)
    .execute(&state.db)
    .await;

    match result {
        Ok(_) => Ok(Json(CreateViewerResponse {
            success: true,
            viewer_id: viewer.id,
        })),
        Err(e) => {
            tracing::error!("Failed to create viewer: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to create viewer: {}", e),
            ))
        }
    }
}

/// Get viewers, optionally filtered by email
pub async fn get_viewers(
    State(state): State<AppState>,
    Query(query): Query<ViewerQuery>,
) -> Result<Json<Vec<ViewerInfo>>, (StatusCode, String)> {
    let viewers: Vec<Viewer> = if let Some(email) = query.email {
        sqlx::query_as::<_, Viewer>("SELECT * FROM viewers WHERE email = ?")
            .bind(&email)
            .fetch_all(&state.db)
            .await
    } else {
        sqlx::query_as::<_, Viewer>("SELECT * FROM viewers ORDER BY name")
            .fetch_all(&state.db)
            .await
    }
    .map_err(|e| {
        tracing::error!("Failed to fetch viewers: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to fetch viewers: {}", e),
        )
    })?;

    let infos: Vec<ViewerInfo> = viewers.into_iter().map(ViewerInfo::from).collect();
    Ok(Json(infos))
}

/// Get a viewer's public key by ID
pub async fn get_viewer_public_key(
    State(state): State<AppState>,
    Path(viewer_id): Path<String>,
) -> Result<Json<ViewerPublicKeyResponse>, (StatusCode, String)> {
    let viewer: Option<Viewer> =
        sqlx::query_as::<_, Viewer>("SELECT * FROM viewers WHERE id = ?")
            .bind(&viewer_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| {
                tracing::error!("Failed to fetch viewer: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to fetch viewer: {}", e),
                )
            })?;

    match viewer {
        Some(v) => Ok(Json(ViewerPublicKeyResponse {
            viewer_id: v.id,
            public_key: v.public_key,
        })),
        None => Err((StatusCode::NOT_FOUND, "Viewer not found".to_string())),
    }
}

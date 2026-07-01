use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;

use crate::models::{
    CreateGrantRequest, CreateGrantResponse, GrantInfo, GrantsListResponse, RevokeGrantResponse,
    SharingGrant,
};
use crate::AppState;

/// Validate API key from request headers
fn validate_api_key(headers: &HeaderMap, expected_key: &str) -> bool {
    headers
        .get("x-api-key")
        .and_then(|v| v.to_str().ok())
        .map(|k| k == expected_key)
        .unwrap_or(false)
}

/// Query parameters for grant lookup
#[derive(Debug, Deserialize)]
pub struct GrantQuery {
    pub grantee_id: Option<String>,
    pub grantor_id: Option<String>,
}

/// Create a new sharing grant
pub async fn create_grant(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateGrantRequest>,
) -> Result<Json<CreateGrantResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let grant = SharingGrant::from_request(&req);

    // Use upsert to handle re-granting (update encrypted_payload if grant exists)
    let result = sqlx::query(
        r#"
        INSERT INTO sharing_grants (id, grantor_id, grantee_id, encrypted_payload, granted_at, expires_at, revoked, revoked_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, NULL)
        ON CONFLICT(grantor_id, grantee_id) DO UPDATE SET
            encrypted_payload = excluded.encrypted_payload,
            granted_at = excluded.granted_at,
            expires_at = excluded.expires_at,
            revoked = 0,
            revoked_at = NULL
        "#,
    )
    .bind(&grant.id)
    .bind(&grant.grantor_id)
    .bind(&grant.grantee_id)
    .bind(&grant.encrypted_payload)
    .bind(&grant.granted_at)
    .bind(&grant.expires_at)
    .execute(&state.db)
    .await;

    match result {
        Ok(_) => Ok(Json(CreateGrantResponse {
            success: true,
            grant_id: grant.id,
        })),
        Err(e) => {
            tracing::error!("Failed to create grant: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to create grant: {}", e),
            ))
        }
    }
}

/// Get grants - filtered by grantee_id or grantor_id
pub async fn get_grants(
    State(state): State<AppState>,
    Query(query): Query<GrantQuery>,
) -> Result<Json<GrantsListResponse>, (StatusCode, String)> {
    // Build query based on filters
    let grants: Vec<GrantInfo> = if let Some(grantee_id) = query.grantee_id {
        // Get grants for a viewer (includes grantor info)
        sqlx::query_as::<_, GrantWithGrantorInfo>(
            r#"
            SELECT
                g.id, g.grantor_id, g.grantee_id, g.encrypted_payload, g.granted_at, g.expires_at,
                u.first_name as grantor_first_name, u.last_name as grantor_last_name, u.email as grantor_email
            FROM sharing_grants g
            JOIN users u ON g.grantor_id = u.id
            WHERE g.grantee_id = ?
              AND g.revoked = 0
              AND (g.expires_at IS NULL OR g.expires_at > datetime('now'))
            ORDER BY g.granted_at DESC
            "#,
        )
        .bind(&grantee_id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch grants: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to fetch grants: {}", e),
            )
        })?
        .into_iter()
        .map(|g| GrantInfo {
            id: g.id,
            grantor_id: g.grantor_id,
            grantee_id: g.grantee_id,
            encrypted_payload: g.encrypted_payload,
            granted_at: g.granted_at,
            expires_at: g.expires_at,
            grantor_name: Some(format!("{} {}", g.grantor_first_name, g.grantor_last_name)),
            grantor_email: Some(g.grantor_email),
            grantee_name: None,
            grantee_email: None,
        })
        .collect()
    } else if let Some(grantor_id) = query.grantor_id {
        // Get grants issued by a user (includes grantee info)
        sqlx::query_as::<_, GrantWithGranteeInfo>(
            r#"
            SELECT
                g.id, g.grantor_id, g.grantee_id, g.encrypted_payload, g.granted_at, g.expires_at,
                v.name as grantee_name, v.email as grantee_email, v.role as grantee_role
            FROM sharing_grants g
            JOIN viewers v ON g.grantee_id = v.id
            WHERE g.grantor_id = ?
              AND g.revoked = 0
            ORDER BY g.granted_at DESC
            "#,
        )
        .bind(&grantor_id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch grants: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to fetch grants: {}", e),
            )
        })?
        .into_iter()
        .map(|g| GrantInfo {
            id: g.id,
            grantor_id: g.grantor_id,
            grantee_id: g.grantee_id,
            encrypted_payload: g.encrypted_payload,
            granted_at: g.granted_at,
            expires_at: g.expires_at,
            grantor_name: None,
            grantor_email: None,
            grantee_name: Some(g.grantee_name),
            grantee_email: Some(g.grantee_email),
        })
        .collect()
    } else {
        return Err((
            StatusCode::BAD_REQUEST,
            "Either grantee_id or grantor_id must be specified".to_string(),
        ));
    };

    Ok(Json(GrantsListResponse { grants }))
}

/// Revoke a sharing grant
pub async fn revoke_grant(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(grant_id): Path<String>,
) -> Result<Json<RevokeGrantResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let now = chrono::Utc::now().to_rfc3339();

    let result = sqlx::query(
        r#"
        UPDATE sharing_grants
        SET revoked = 1, revoked_at = ?
        WHERE id = ?
        "#,
    )
    .bind(&now)
    .bind(&grant_id)
    .execute(&state.db)
    .await;

    match result {
        Ok(r) => {
            if r.rows_affected() > 0 {
                Ok(Json(RevokeGrantResponse { success: true }))
            } else {
                Err((StatusCode::NOT_FOUND, "Grant not found".to_string()))
            }
        }
        Err(e) => {
            tracing::error!("Failed to revoke grant: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to revoke grant: {}", e),
            ))
        }
    }
}

// Helper structs for joined queries
#[derive(sqlx::FromRow)]
struct GrantWithGrantorInfo {
    id: String,
    grantor_id: String,
    grantee_id: String,
    encrypted_payload: String,
    granted_at: String,
    expires_at: Option<String>,
    grantor_first_name: String,
    grantor_last_name: String,
    grantor_email: String,
}

#[derive(sqlx::FromRow)]
struct GrantWithGranteeInfo {
    id: String,
    grantor_id: String,
    grantee_id: String,
    encrypted_payload: String,
    granted_at: String,
    expires_at: Option<String>,
    grantee_name: String,
    grantee_email: String,
    #[allow(dead_code)]
    grantee_role: String,
}

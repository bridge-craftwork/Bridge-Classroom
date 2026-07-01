use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;

use crate::{
    models::{CreateUserRequest, CreateUserResponse, SharingGrant, User, UserInfo, UsersListResponse},
    routes::recovery::{encrypt_for_recovery, decrypt_for_recovery},
    AppState,
};

/// Validate API key from request headers
fn validate_api_key(headers: &HeaderMap, expected_key: &str) -> bool {
    if let Some(header_key) = headers.get("x-api-key").and_then(|v| v.to_str().ok()) {
        return header_key == expected_key;
    }
    false
}

/// POST /api/users
/// Register a new user
pub async fn create_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: String,
) -> Result<Json<CreateUserResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    // Manually deserialize with logging for debugging
    let req: CreateUserRequest = match serde_json::from_str(&body) {
        Ok(r) => r,
        Err(e) => {
            let preview = if body.len() > 500 { &body[..500] } else { &body };
            tracing::error!("Failed to deserialize CreateUserRequest: {} | Body: {}", e, preview);
            return Err((
                StatusCode::UNPROCESSABLE_ENTITY,
                format!("Invalid request body: {}", e),
            ));
        }
    };

    // Validate request
    if req.user_id.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "user_id is required".to_string()));
    }
    if req.email.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "email is required".to_string()));
    }
    if req.first_name.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "first_name is required".to_string()));
    }
    if req.last_name.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "last_name is required".to_string()));
    }

    // Check if user already exists by ID
    let existing_by_id = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = ?")
        .bind(&req.user_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to query user by id {}: {}", req.user_id, e);
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        })?;

    // Also check if email exists with a different user_id (e.g., user cleared localStorage)
    let existing_by_email = sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = ? AND id != ?")
        .bind(&req.email)
        .bind(&req.user_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to query user by email {}: {}", req.email, e);
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        })?;

    // If email exists with different ID, tell client to use recovery flow
    if let Some(existing_user) = existing_by_email {
        tracing::info!(
            "Email {} already exists with user_id {}, client sent {} - needs recovery",
            req.email, existing_user.id, req.user_id
        );
        return Ok(Json(CreateUserResponse {
            success: false,
            user_id: existing_user.id,
            existing_user: Some(true),
        }));
    }

    // Encrypt secret key for recovery if provided and recovery is configured
    let recovery_encrypted_key = if let (Some(secret_key), Some(recovery_secret)) =
        (&req.secret_key, state.config.recovery_secret.as_ref())
    {
        match encrypt_for_recovery(secret_key, recovery_secret) {
            Ok(encrypted) => Some(encrypted),
            Err(e) => {
                tracing::warn!("Failed to encrypt recovery key: {}", e);
                None
            }
        }
    } else {
        None
    };

    if let Some(ref existing) = existing_by_id {
        // User already exists - update their info
        // If admin corrected the name, don't overwrite it from client sync
        let name_protected = existing.name_corrected_at.is_some();
        let now = chrono::Utc::now().to_rfc3339();

        // SECURITY (§S1): never let this endpoint repoint an existing account's
        // email. Doing so was a full account-takeover primitive — an attacker
        // who knew a victim's user_id could set the login email to their own
        // and then pull the victim's recovery key via the recovery flow. Legit
        // profile sync always sends the account's own email, so preserving the
        // stored value is transparent; a genuine email change must go through an
        // authenticated path, not this anonymous-by-design upsert.
        if !req.email.eq_ignore_ascii_case(&existing.email) {
            tracing::warn!(
                "create_user: ignoring email change for existing user {} ({} -> {})",
                req.user_id, existing.email, req.email
            );
        }

        if name_protected {
            // Skip first_name/last_name — admin correction takes precedence
            if let Some(ref encrypted_key) = recovery_encrypted_key {
                sqlx::query(
                    r#"
                    UPDATE users
                    SET classroom = ?, data_consent = ?, updated_at = ?, recovery_encrypted_key = ?
                    WHERE id = ?
                    "#,
                )
                .bind(&req.classroom)
                .bind(req.data_consent.unwrap_or(true))
                .bind(&now)
                .bind(encrypted_key)
                .bind(&req.user_id)
                .execute(&state.db)
                .await
                .map_err(|e| {
                    tracing::error!("Failed to update user {} (name-protected, with recovery key): {}", req.user_id, e);
                    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
                })?;
            } else {
                sqlx::query(
                    r#"
                    UPDATE users
                    SET classroom = ?, data_consent = ?, updated_at = ?
                    WHERE id = ?
                    "#,
                )
                .bind(&req.classroom)
                .bind(req.data_consent.unwrap_or(true))
                .bind(&now)
                .bind(&req.user_id)
                .execute(&state.db)
                .await
                .map_err(|e| {
                    tracing::error!("Failed to update user {} (name-protected): {}", req.user_id, e);
                    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
                })?;
            }
        } else {
            // Normal update — include first_name/last_name
            if let Some(ref encrypted_key) = recovery_encrypted_key {
                sqlx::query(
                    r#"
                    UPDATE users
                    SET first_name = ?, last_name = ?, classroom = ?,
                        data_consent = ?, updated_at = ?, recovery_encrypted_key = ?
                    WHERE id = ?
                    "#,
                )
                .bind(&req.first_name)
                .bind(&req.last_name)
                .bind(&req.classroom)
                .bind(req.data_consent.unwrap_or(true))
                .bind(&now)
                .bind(encrypted_key)
                .bind(&req.user_id)
                .execute(&state.db)
                .await
                .map_err(|e| {
                    tracing::error!("Failed to update user {} (with recovery key): {}", req.user_id, e);
                    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
                })?;
            } else {
                sqlx::query(
                    r#"
                    UPDATE users
                    SET first_name = ?, last_name = ?, classroom = ?,
                        data_consent = ?, updated_at = ?
                    WHERE id = ?
                    "#,
                )
                .bind(&req.first_name)
                .bind(&req.last_name)
                .bind(&req.classroom)
                .bind(req.data_consent.unwrap_or(true))
                .bind(&now)
                .bind(&req.user_id)
                .execute(&state.db)
                .await
                .map_err(|e| {
                    tracing::error!("Failed to update user {}: {}", req.user_id, e);
                    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
                })?;
            }
        }

        tracing::info!("Updated existing user: {} (name_protected: {})", req.user_id, name_protected);
    } else {
        // Create new user
        let user = User::from_request(&req);

        sqlx::query(
            r#"
            INSERT INTO users (id, first_name, last_name, email, classroom,
                               data_consent, created_at, updated_at, recovery_encrypted_key)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&user.id)
        .bind(&user.first_name)
        .bind(&user.last_name)
        .bind(&user.email)
        .bind(&user.classroom)
        .bind(user.data_consent)
        .bind(&user.created_at)
        .bind(&user.updated_at)
        .bind(&recovery_encrypted_key)
        .execute(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to insert new user {}: {}", user.id, e);
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        })?;

        tracing::info!("Created new user: {} (recovery: {})", user.id, recovery_encrypted_key.is_some());

        // If admin grant is provided, store it (non-fatal — user is already created)
        if let Some(admin_grant) = &req.admin_grant {
            let grant = SharingGrant {
                id: uuid::Uuid::new_v4().to_string(),
                grantor_id: user.id.clone(),
                grantee_id: admin_grant.grantee_id.clone(),
                encrypted_payload: admin_grant.encrypted_payload.clone(),
                granted_at: chrono::Utc::now().to_rfc3339(),
                expires_at: None,
                revoked: false,
                revoked_at: None,
            };

            match sqlx::query(
                r#"
                INSERT INTO sharing_grants (id, grantor_id, grantee_id, encrypted_payload,
                                           granted_at, expires_at, revoked, revoked_at)
                VALUES (?, ?, ?, ?, ?, ?, 0, NULL)
                ON CONFLICT(grantor_id, grantee_id) DO UPDATE SET
                    encrypted_payload = excluded.encrypted_payload,
                    granted_at = excluded.granted_at
                "#,
            )
            .bind(&grant.id)
            .bind(&grant.grantor_id)
            .bind(&grant.grantee_id)
            .bind(&grant.encrypted_payload)
            .bind(&grant.granted_at)
            .bind(&grant.expires_at)
            .execute(&state.db)
            .await
            {
                Ok(_) => tracing::info!("Created admin grant for user: {}", user.id),
                Err(e) => tracing::warn!("Failed to create admin grant for user {}: {} (user registration still succeeded)", user.id, e),
            }
        }
    }

    Ok(Json(CreateUserResponse {
        success: true,
        user_id: req.user_id,
        existing_user: None,
    }))
}

/// GET /api/users/:user_id
/// Get a single user's info (lightweight role sync)
pub async fn get_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = ?")
        .bind(&user_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch user {}: {}", user_id, e);
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        })?;

    match user {
        Some(u) => {
            let info = UserInfo::from(u);

            // Fetch classroom memberships from join table
            let classroom_ids: Vec<String> = sqlx::query_scalar(
                "SELECT classroom_id FROM classroom_members WHERE student_id = ?"
            )
            .bind(&user_id)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();

            // For teachers/admins, include decrypted viewer private key if available
            let viewer_private_key = if info.role == "teacher" || info.role == "admin" {
                if let Some(ref recovery_secret) = state.config.recovery_secret {
                    let viewer_row = sqlx::query_scalar::<_, Option<String>>(
                        "SELECT recovery_encrypted_private_key FROM viewers WHERE email = ?"
                    )
                    .bind(&info.email)
                    .fetch_optional(&state.db)
                    .await
                    .ok()
                    .flatten()
                    .flatten();

                    if let Some(encrypted_pk) = viewer_row {
                        decrypt_for_recovery(&encrypted_pk, recovery_secret).ok()
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            };

            Ok(Json(serde_json::json!({
                "success": true,
                "user": info,
                "classrooms": classroom_ids,
                "viewer_private_key": viewer_private_key
            })))
        }
        None => Err((StatusCode::NOT_FOUND, "User not found".to_string())),
    }
}

/// GET /api/users
/// Get all users (for teacher dashboard)
pub async fn get_users(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<UsersListResponse>, (StatusCode, String)> {
    // Validate API key
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let users = sqlx::query_as::<_, User>("SELECT * FROM users ORDER BY created_at DESC")
        .fetch_all(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch users: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        })?;

    let user_infos: Vec<UserInfo> = users.into_iter().map(UserInfo::from).collect();

    Ok(Json(UsersListResponse { users: user_infos }))
}

// ---- Admin user management ----

#[derive(Debug, Deserialize)]
pub struct AdminUserSearchQuery {
    pub q: String,
}

#[derive(Debug, Deserialize)]
pub struct AdminCorrectNameRequest {
    pub first_name: String,
    pub last_name: String,
}

/// GET /api/admin/users/search?q=X
/// Searches by email, first_name, or last_name (partial, case-insensitive)
pub async fn admin_search_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<AdminUserSearchQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let pattern = format!("%{}%", query.q);
    let users = sqlx::query_as::<_, User>(
        r#"SELECT * FROM users
           WHERE email LIKE ?1 COLLATE NOCASE
              OR first_name LIKE ?1 COLLATE NOCASE
              OR last_name LIKE ?1 COLLATE NOCASE
           ORDER BY email LIMIT 20"#,
    )
    .bind(&pattern)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let user_infos: Vec<UserInfo> = users.into_iter().map(UserInfo::from).collect();

    Ok(Json(serde_json::json!({
        "success": true,
        "users": user_infos
    })))
}

/// PATCH /api/admin/users/:id
pub async fn admin_correct_name(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
    Json(body): Json<AdminCorrectNameRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let now = chrono::Utc::now().to_rfc3339();

    let result = sqlx::query(
        r#"
        UPDATE users
        SET first_name = ?, last_name = ?, name_corrected_at = ?, updated_at = ?
        WHERE id = ?
        "#,
    )
    .bind(body.first_name.trim())
    .bind(body.last_name.trim())
    .bind(&now)
    .bind(&now)
    .bind(&user_id)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "User not found".to_string()));
    }

    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = ?")
        .bind(&user_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let info = UserInfo::from(user);

    tracing::info!("Admin corrected name for user {}: {} {}", user_id, info.first_name, info.last_name);

    Ok(Json(serde_json::json!({
        "success": true,
        "user": info
    })))
}

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;

use crate::models::{
    generate_join_code, ClassroomActionResponse, ClassroomDetail, ClassroomDetailResponse,
    ClassroomInfo, ClassroomListResponse, CreateClassroomRequest, CreateClassroomResponse,
    JoinClassroomRequest, JoinClassroomResponse, JoinInfo, LeaveClassroomRequest, MemberInfo,
};
use crate::AppState;

/// Validate API key from request headers
fn validate_api_key(headers: &HeaderMap, expected_key: &str) -> bool {
    if let Some(header_key) = headers.get("x-api-key").and_then(|v| v.to_str().ok()) {
        return header_key == expected_key;
    }
    false
}

/// Query parameters for classroom listing
#[derive(Debug, Deserialize)]
pub struct ClassroomQuery {
    pub teacher_id: Option<String>,
}

// ---- Helper structs for joined queries ----

#[derive(sqlx::FromRow)]
struct ClassroomWithCount {
    id: String,
    name: String,
    description: Option<String>,
    teacher_id: String,
    join_code: String,
    created_at: String,
    member_count: i64,
}

#[derive(sqlx::FromRow)]
struct MemberRow {
    student_id: String,
    first_name: String,
    last_name: String,
    email: String,
    joined_at: String,
}

#[derive(sqlx::FromRow)]
struct JoinInfoRow {
    classroom_name: String,
    classroom_description: Option<String>,
    teacher_first_name: String,
    teacher_last_name: String,
    viewer_id: Option<String>,
    public_key: Option<String>,
}

#[derive(sqlx::FromRow)]
struct ClassroomRow {
    id: String,
    name: String,
    description: Option<String>,
    teacher_id: String,
    join_code: String,
    created_at: String,
}

// ---- Endpoints ----

/// POST /api/classrooms — Create a new classroom
pub async fn create_classroom(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateClassroomRequest>,
) -> Result<Json<CreateClassroomResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    if req.name.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "Classroom name is required".to_string(),
        ));
    }

    // Verify teacher exists and has teacher role
    let role: Option<String> = sqlx::query_scalar("SELECT role FROM users WHERE id = ?")
        .bind(&req.teacher_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    match role.as_deref() {
        Some("teacher") | Some("admin") => {}
        Some(_) => {
            return Err((
                StatusCode::FORBIDDEN,
                "Only teachers can create classrooms".to_string(),
            ));
        }
        None => {
            return Err((StatusCode::NOT_FOUND, "User not found".to_string()));
        }
    }

    // Generate unique join code with retry
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let mut join_code = generate_join_code();

    for attempt in 0..5 {
        let result = sqlx::query(
            r#"
            INSERT INTO classrooms (id, name, description, teacher_id, join_code, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&id)
        .bind(req.name.trim())
        .bind(&req.description)
        .bind(&req.teacher_id)
        .bind(&join_code)
        .bind(&now)
        .execute(&state.db)
        .await;

        match result {
            Ok(_) => {
                tracing::info!("Classroom created: {} ({})", req.name.trim(), join_code);
                return Ok(Json(CreateClassroomResponse {
                    success: true,
                    classroom: ClassroomInfo {
                        id,
                        name: req.name.trim().to_string(),
                        description: req.description,
                        teacher_id: req.teacher_id,
                        join_code,
                        created_at: now,
                        member_count: 0,
                    },
                }));
            }
            Err(e) => {
                // Check if this is a unique constraint violation on join_code
                let err_str = e.to_string();
                if err_str.contains("UNIQUE") && err_str.contains("join_code") && attempt < 4 {
                    join_code = generate_join_code();
                    continue;
                }
                tracing::error!("Failed to create classroom: {}", e);
                return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string()));
            }
        }
    }

    Err((
        StatusCode::INTERNAL_SERVER_ERROR,
        "Failed to generate unique join code after 5 attempts".to_string(),
    ))
}

/// GET /api/classrooms — List teacher's classrooms with member counts
pub async fn list_classrooms(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ClassroomQuery>,
) -> Result<Json<ClassroomListResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let teacher_id = query.teacher_id.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            "teacher_id is required".to_string(),
        )
    })?;

    let rows = sqlx::query_as::<_, ClassroomWithCount>(
        r#"
        SELECT c.id, c.name, c.description, c.teacher_id, c.join_code, c.created_at,
               COUNT(cm.student_id) as member_count
        FROM classrooms c
        LEFT JOIN classroom_members cm ON cm.classroom_id = c.id
        WHERE c.teacher_id = ?
        GROUP BY c.id
        ORDER BY c.created_at DESC
        "#,
    )
    .bind(&teacher_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to list classrooms: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    let classrooms = rows
        .into_iter()
        .map(|r| ClassroomInfo {
            id: r.id,
            name: r.name,
            description: r.description,
            teacher_id: r.teacher_id,
            join_code: r.join_code,
            created_at: r.created_at,
            member_count: r.member_count,
        })
        .collect();

    Ok(Json(ClassroomListResponse {
        success: true,
        classrooms,
    }))
}

/// GET /api/classrooms/:id — Get classroom detail with member roster
pub async fn get_classroom(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(classroom_id): Path<String>,
) -> Result<Json<ClassroomDetailResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let classroom = sqlx::query_as::<_, ClassroomRow>(
        "SELECT id, name, description, teacher_id, join_code, created_at FROM classrooms WHERE id = ?",
    )
    .bind(&classroom_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, "Classroom not found".to_string()))?;

    let members = sqlx::query_as::<_, MemberRow>(
        r#"
        SELECT cm.student_id, u.first_name, u.last_name, u.email, cm.joined_at
        FROM classroom_members cm
        JOIN users u ON u.id = cm.student_id
        WHERE cm.classroom_id = ?
        ORDER BY cm.joined_at DESC
        "#,
    )
    .bind(&classroom_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(ClassroomDetailResponse {
        success: true,
        classroom: ClassroomDetail {
            id: classroom.id,
            name: classroom.name,
            description: classroom.description,
            teacher_id: classroom.teacher_id,
            join_code: classroom.join_code,
            created_at: classroom.created_at,
            members: members
                .into_iter()
                .map(|m| MemberInfo {
                    student_id: m.student_id,
                    first_name: m.first_name,
                    last_name: m.last_name,
                    email: m.email,
                    joined_at: m.joined_at,
                })
                .collect(),
        },
    }))
}

/// GET /api/join/:join_code — Public endpoint for join page info
pub async fn get_join_info(
    State(state): State<AppState>,
    Path(join_code): Path<String>,
) -> Result<Json<JoinInfo>, (StatusCode, String)> {
    // No API key required — this is a public endpoint

    let row = sqlx::query_as::<_, JoinInfoRow>(
        r#"
        SELECT c.name as classroom_name, c.description as classroom_description,
               u.first_name as teacher_first_name, u.last_name as teacher_last_name,
               v.id as viewer_id, v.public_key
        FROM classrooms c
        JOIN users u ON u.id = c.teacher_id
        LEFT JOIN viewers v ON v.email = u.email
        WHERE c.join_code = ?
        "#,
    )
    .bind(&join_code)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to get join info: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?
    .ok_or_else(|| (StatusCode::NOT_FOUND, "Classroom not found".to_string()))?;

    Ok(Json(JoinInfo {
        classroom_name: row.classroom_name,
        classroom_description: row.classroom_description,
        teacher_name: format!("{} {}", row.teacher_first_name, row.teacher_last_name),
        teacher_viewer_id: row.viewer_id,
        teacher_public_key: row.public_key,
    }))
}

/// POST /api/join/:join_code — Join a classroom (creates membership + sharing grant)
pub async fn join_classroom(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(join_code): Path<String>,
    Json(req): Json<JoinClassroomRequest>,
) -> Result<Json<JoinClassroomResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    if req.student_id.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "student_id is required".to_string(),
        ));
    }

    // Look up classroom
    let classroom = sqlx::query_as::<_, ClassroomRow>(
        "SELECT id, name, description, teacher_id, join_code, created_at FROM classrooms WHERE join_code = ?",
    )
    .bind(&join_code)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, "Classroom not found".to_string()))?;

    // Check if already a member
    let existing: Option<String> = sqlx::query_scalar(
        "SELECT student_id FROM classroom_members WHERE classroom_id = ? AND student_id = ?",
    )
    .bind(&classroom.id)
    .bind(&req.student_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if existing.is_some() {
        return Ok(Json(JoinClassroomResponse {
            success: true,
            classroom_id: Some(classroom.id),
            error: Some("Already a member of this classroom".to_string()),
        }));
    }

    // Look up teacher's viewer record for sharing grant
    let teacher_viewer_id: Option<String> = sqlx::query_scalar(
        r#"
        SELECT v.id FROM viewers v
        JOIN users u ON v.email = u.email
        WHERE u.id = ?
        "#,
    )
    .bind(&classroom.teacher_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let now = chrono::Utc::now().to_rfc3339();

    // Use a transaction to create membership and sharing grant atomically
    let mut tx = state.db.begin().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Transaction failed: {}", e),
        )
    })?;

    // Insert classroom membership
    sqlx::query(
        "INSERT INTO classroom_members (classroom_id, student_id, joined_at) VALUES (?, ?, ?)",
    )
    .bind(&classroom.id)
    .bind(&req.student_id)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to insert classroom member: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    // Create sharing grant if teacher has a viewer record
    if let Some(viewer_id) = &teacher_viewer_id {
        let grant_id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO sharing_grants (id, grantor_id, grantee_id, encrypted_payload, granted_at, expires_at, revoked, revoked_at)
            VALUES (?, ?, ?, ?, ?, NULL, 0, NULL)
            ON CONFLICT(grantor_id, grantee_id) DO UPDATE SET
                encrypted_payload = excluded.encrypted_payload,
                granted_at = excluded.granted_at,
                revoked = 0,
                revoked_at = NULL
            "#,
        )
        .bind(&grant_id)
        .bind(&req.student_id)
        .bind(viewer_id)
        .bind(&req.encrypted_grant_payload)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Failed to create sharing grant: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        })?;
    }

    tx.commit().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Commit failed: {}", e),
        )
    })?;

    tracing::info!(
        "Student {} joined classroom {} ({})",
        req.student_id,
        classroom.name,
        join_code
    );

    Ok(Json(JoinClassroomResponse {
        success: true,
        classroom_id: Some(classroom.id),
        error: None,
    }))
}

/// DELETE /api/classrooms/:id/members/:uid — Remove a member (teacher only)
pub async fn remove_member(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((classroom_id, student_id)): Path<(String, String)>,
) -> Result<Json<ClassroomActionResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    // Verify the classroom exists
    let teacher_id: Option<String> =
        sqlx::query_scalar("SELECT teacher_id FROM classrooms WHERE id = ?")
            .bind(&classroom_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if teacher_id.is_none() {
        return Err((StatusCode::NOT_FOUND, "Classroom not found".to_string()));
    }

    // Delete membership (does NOT revoke sharing grant per spec)
    let result =
        sqlx::query("DELETE FROM classroom_members WHERE classroom_id = ? AND student_id = ?")
            .bind(&classroom_id)
            .bind(&student_id)
            .execute(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if result.rows_affected() == 0 {
        return Ok(Json(ClassroomActionResponse {
            success: false,
            error: Some("Member not found".to_string()),
        }));
    }

    tracing::info!(
        "Removed student {} from classroom {}",
        student_id,
        classroom_id
    );

    Ok(Json(ClassroomActionResponse {
        success: true,
        error: None,
    }))
}

/// POST /api/classrooms/:id/members/leave — Student leaves a classroom
pub async fn leave_classroom(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(classroom_id): Path<String>,
    Json(req): Json<LeaveClassroomRequest>,
) -> Result<Json<ClassroomActionResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let result =
        sqlx::query("DELETE FROM classroom_members WHERE classroom_id = ? AND student_id = ?")
            .bind(&classroom_id)
            .bind(&req.student_id)
            .execute(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if result.rows_affected() == 0 {
        return Ok(Json(ClassroomActionResponse {
            success: false,
            error: Some("Not a member of this classroom".to_string()),
        }));
    }

    tracing::info!("Student {} left classroom {}", req.student_id, classroom_id);

    Ok(Json(ClassroomActionResponse {
        success: true,
        error: None,
    }))
}

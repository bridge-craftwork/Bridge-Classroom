use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};

use crate::models::{
    AssignmentActionResponse, AssignmentDetail, AssignmentDetailResponse, AssignmentInfo,
    AssignmentListResponse, AssignmentQuery, CreateAssignmentRequest, CreateAssignmentResponse,
    StudentAssignmentProgress,
};
use crate::AppState;

/// Validate API key from request headers
fn validate_api_key(headers: &HeaderMap, expected_key: &str) -> bool {
    if let Some(header_key) = headers.get("x-api-key").and_then(|v| v.to_str().ok()) {
        return header_key == expected_key;
    }
    false
}

// ---- Helper structs for queries ----

#[derive(sqlx::FromRow)]
struct AssignmentRow {
    id: String,
    exercise_id: String,
    classroom_id: Option<String>,
    student_id: Option<String>,
    assigned_by: String,
    assigned_at: String,
    due_at: Option<String>,
    sort_order: Option<i32>,
    exercise_name: String,
    classroom_name: Option<String>,
}

#[derive(sqlx::FromRow)]
struct BoardRef {
    deal_subfolder: String,
    deal_number: i32,
}

#[derive(sqlx::FromRow)]
struct StudentMemberRow {
    student_id: String,
    first_name: String,
    last_name: String,
}

#[derive(sqlx::FromRow)]
struct ObservationHit {
    deal_subfolder: String,
    deal_number: i32,
    correct: bool,
}

// ---- Endpoints ----

/// POST /api/assignments — Create an assignment
pub async fn create_assignment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateAssignmentRequest>,
) -> Result<Json<CreateAssignmentResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    // Validate: exactly one of classroom_id or student_id must be set
    match (&req.classroom_id, &req.student_id) {
        (Some(_), Some(_)) => {
            return Err((
                StatusCode::BAD_REQUEST,
                "Set either classroom_id or student_id, not both".to_string(),
            ));
        }
        (None, None) => {
            return Err((
                StatusCode::BAD_REQUEST,
                "Either classroom_id or student_id is required".to_string(),
            ));
        }
        _ => {}
    }

    // Verify teacher role
    let role: Option<String> =
        sqlx::query_scalar("SELECT role FROM users WHERE id = ?")
            .bind(&req.assigned_by)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    match role.as_deref() {
        Some("teacher") | Some("admin") => {}
        Some(_) => {
            return Err((
                StatusCode::FORBIDDEN,
                "Only teachers can create assignments".to_string(),
            ));
        }
        None => {
            return Err((StatusCode::NOT_FOUND, "User not found".to_string()));
        }
    }

    // Verify exercise exists
    let exercise_name: Option<String> =
        sqlx::query_scalar("SELECT name FROM exercises WHERE id = ?")
            .bind(&req.exercise_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let exercise_name = exercise_name
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Exercise not found".to_string()))?;

    // Get board count for the exercise
    let board_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM exercise_boards WHERE exercise_id = ?")
            .bind(&req.exercise_id)
            .fetch_one(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Get classroom name if applicable
    let classroom_name = if let Some(ref cid) = req.classroom_id {
        sqlx::query_scalar::<_, String>("SELECT name FROM classrooms WHERE id = ?")
            .bind(cid)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    } else {
        None
    };

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    sqlx::query(
        r#"
        INSERT INTO assignments (id, exercise_id, classroom_id, student_id, assigned_by, assigned_at, due_at, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(&req.exercise_id)
    .bind(&req.classroom_id)
    .bind(&req.student_id)
    .bind(&req.assigned_by)
    .bind(&now)
    .bind(&req.due_at)
    .bind(req.sort_order)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to create assignment: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    tracing::info!("Assignment created: {} (exercise: {})", id, exercise_name);

    Ok(Json(CreateAssignmentResponse {
        success: true,
        assignment: AssignmentInfo {
            id,
            exercise_name,
            exercise_id: req.exercise_id,
            classroom_id: req.classroom_id,
            classroom_name,
            student_id: req.student_id,
            assigned_by: req.assigned_by,
            assigned_at: now,
            due_at: req.due_at,
            total_boards: board_count,
            attempted_boards: 0,
            correct_boards: 0,
        },
    }))
}

/// GET /api/assignments — List assignments with computed progress
///
/// Query params:
/// - student_id: list assignments for this student (direct + via classrooms)
/// - assigned_by: list assignments created by this teacher
/// - classroom_id: list assignments for this classroom
pub async fn list_assignments(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<AssignmentQuery>,
) -> Result<Json<AssignmentListResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    // Student view: get assignments for this student (direct + via classroom membership)
    if let Some(ref student_id) = query.student_id {
        return list_student_assignments(&state, student_id).await;
    }

    // Teacher view: get assignments created by this teacher
    if let Some(ref assigned_by) = query.assigned_by {
        return list_teacher_assignments(&state, assigned_by).await;
    }

    // Classroom view: get assignments for a specific classroom
    if let Some(ref classroom_id) = query.classroom_id {
        return list_classroom_assignments(&state, classroom_id).await;
    }

    Err((
        StatusCode::BAD_REQUEST,
        "Provide student_id, assigned_by, or classroom_id".to_string(),
    ))
}

/// List assignments for a student with per-student progress
async fn list_student_assignments(
    state: &AppState,
    student_id: &str,
) -> Result<Json<AssignmentListResponse>, (StatusCode, String)> {
    // Get all assignments for this student (direct + via classrooms)
    let rows = sqlx::query_as::<_, AssignmentRow>(
        r#"
        SELECT a.id, a.exercise_id, a.classroom_id, a.student_id, a.assigned_by,
               a.assigned_at, a.due_at, a.sort_order,
               e.name AS exercise_name, c.name AS classroom_name
        FROM assignments a
        JOIN exercises e ON e.id = a.exercise_id
        LEFT JOIN classrooms c ON c.id = a.classroom_id
        WHERE a.student_id = ?
           OR a.classroom_id IN (SELECT classroom_id FROM classroom_members WHERE student_id = ?)
        ORDER BY a.assigned_at DESC
        "#,
    )
    .bind(student_id)
    .bind(student_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to list student assignments: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    let mut assignments = Vec::new();
    for row in rows {
        let progress = compute_student_progress(state, &row.id, &row.exercise_id, student_id).await?;
        assignments.push(AssignmentInfo {
            id: row.id,
            exercise_name: row.exercise_name,
            exercise_id: row.exercise_id,
            classroom_id: row.classroom_id,
            classroom_name: row.classroom_name,
            student_id: row.student_id,
            assigned_by: row.assigned_by,
            assigned_at: row.assigned_at,
            due_at: row.due_at,
            total_boards: progress.0,
            attempted_boards: progress.1,
            correct_boards: progress.2,
        });
    }

    Ok(Json(AssignmentListResponse {
        success: true,
        assignments,
    }))
}

/// List assignments created by a teacher
async fn list_teacher_assignments(
    state: &AppState,
    assigned_by: &str,
) -> Result<Json<AssignmentListResponse>, (StatusCode, String)> {
    let rows = sqlx::query_as::<_, AssignmentRow>(
        r#"
        SELECT a.id, a.exercise_id, a.classroom_id, a.student_id, a.assigned_by,
               a.assigned_at, a.due_at, a.sort_order,
               e.name AS exercise_name, c.name AS classroom_name
        FROM assignments a
        JOIN exercises e ON e.id = a.exercise_id
        LEFT JOIN classrooms c ON c.id = a.classroom_id
        WHERE a.assigned_by = ?
        ORDER BY a.assigned_at DESC
        "#,
    )
    .bind(assigned_by)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to list teacher assignments: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    let mut assignments = Vec::new();
    for row in rows {
        // For teacher view, get board count (not per-student progress)
        let board_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM exercise_boards WHERE exercise_id = ?")
                .bind(&row.exercise_id)
                .fetch_one(&state.db)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        assignments.push(AssignmentInfo {
            id: row.id,
            exercise_name: row.exercise_name,
            exercise_id: row.exercise_id,
            classroom_id: row.classroom_id,
            classroom_name: row.classroom_name,
            student_id: row.student_id,
            assigned_by: row.assigned_by,
            assigned_at: row.assigned_at,
            due_at: row.due_at,
            total_boards: board_count,
            attempted_boards: 0,
            correct_boards: 0,
        });
    }

    Ok(Json(AssignmentListResponse {
        success: true,
        assignments,
    }))
}

/// List assignments for a specific classroom
async fn list_classroom_assignments(
    state: &AppState,
    classroom_id: &str,
) -> Result<Json<AssignmentListResponse>, (StatusCode, String)> {
    let rows = sqlx::query_as::<_, AssignmentRow>(
        r#"
        SELECT a.id, a.exercise_id, a.classroom_id, a.student_id, a.assigned_by,
               a.assigned_at, a.due_at, a.sort_order,
               e.name AS exercise_name, c.name AS classroom_name
        FROM assignments a
        JOIN exercises e ON e.id = a.exercise_id
        LEFT JOIN classrooms c ON c.id = a.classroom_id
        WHERE a.classroom_id = ?
        ORDER BY a.assigned_at DESC
        "#,
    )
    .bind(classroom_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to list classroom assignments: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    let mut assignments = Vec::new();
    for row in rows {
        let board_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM exercise_boards WHERE exercise_id = ?")
                .bind(&row.exercise_id)
                .fetch_one(&state.db)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        assignments.push(AssignmentInfo {
            id: row.id,
            exercise_name: row.exercise_name,
            exercise_id: row.exercise_id,
            classroom_id: row.classroom_id,
            classroom_name: row.classroom_name,
            student_id: row.student_id,
            assigned_by: row.assigned_by,
            assigned_at: row.assigned_at,
            due_at: row.due_at,
            total_boards: board_count,
            attempted_boards: 0,
            correct_boards: 0,
        });
    }

    Ok(Json(AssignmentListResponse {
        success: true,
        assignments,
    }))
}

/// Compute progress for a single student on an exercise.
/// Returns (total_boards, attempted_boards, correct_boards).
///
/// Filters by the explicit `observations.assignment_id` link
/// (issue #15). Historical rows were migrated to populate this column
/// via a one-shot startup backfill that has since been retired; new
/// inserts set it directly from the assignment-mode practice flow.
async fn compute_student_progress(
    state: &AppState,
    assignment_id: &str,
    exercise_id: &str,
    student_id: &str,
) -> Result<(i64, i64, i64), (StatusCode, String)> {
    // Get boards for this exercise
    let boards = sqlx::query_as::<_, BoardRef>(
        "SELECT deal_subfolder, deal_number FROM exercise_boards WHERE exercise_id = ?",
    )
    .bind(exercise_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let total = boards.len() as i64;
    if total == 0 {
        return Ok((0, 0, 0));
    }

    let mut attempted = std::collections::HashSet::new();
    let mut correct = std::collections::HashSet::new();

    for board in &boards {
        let obs = sqlx::query_as::<_, ObservationHit>(
            r#"
            SELECT deal_subfolder, deal_number, correct
            FROM observations
            WHERE assignment_id  = ?
              AND user_id        = ?
              AND deal_subfolder = ?
              AND deal_number    = ?
            ORDER BY timestamp DESC
            LIMIT 1
            "#,
        )
        .bind(assignment_id)
        .bind(student_id)
        .bind(&board.deal_subfolder)
        .bind(board.deal_number)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        if let Some(hit) = obs {
            let key = format!("{}/{}", hit.deal_subfolder, hit.deal_number);
            attempted.insert(key.clone());
            if hit.correct {
                correct.insert(key);
            }
        }
    }

    Ok((total, attempted.len() as i64, correct.len() as i64))
}

/// GET /api/assignments/:id — Get assignment detail with per-student progress
pub async fn get_assignment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(assignment_id): Path<String>,
) -> Result<Json<AssignmentDetailResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let row = sqlx::query_as::<_, AssignmentRow>(
        r#"
        SELECT a.id, a.exercise_id, a.classroom_id, a.student_id, a.assigned_by,
               a.assigned_at, a.due_at, a.sort_order,
               e.name AS exercise_name, c.name AS classroom_name
        FROM assignments a
        JOIN exercises e ON e.id = a.exercise_id
        LEFT JOIN classrooms c ON c.id = a.classroom_id
        WHERE a.id = ?
        "#,
    )
    .bind(&assignment_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to fetch assignment: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?
    .ok_or_else(|| (StatusCode::NOT_FOUND, "Assignment not found".to_string()))?;

    // Get total board count
    let board_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM exercise_boards WHERE exercise_id = ?")
            .bind(&row.exercise_id)
            .fetch_one(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Build per-student progress
    let mut student_progress = Vec::new();

    if let Some(ref classroom_id) = row.classroom_id {
        // Classroom assignment: get progress for each member
        let members = sqlx::query_as::<_, StudentMemberRow>(
            r#"
            SELECT cm.student_id, u.first_name, u.last_name
            FROM classroom_members cm
            JOIN users u ON u.id = cm.student_id
            WHERE cm.classroom_id = ?
            ORDER BY u.last_name, u.first_name
            "#,
        )
        .bind(classroom_id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        for member in members {
            let progress = compute_student_progress(
                &state,
                &row.id,
                &row.exercise_id,
                &member.student_id,
            )
            .await?;

            student_progress.push(StudentAssignmentProgress {
                student_id: member.student_id,
                first_name: member.first_name,
                last_name: member.last_name,
                attempted_boards: progress.1,
                correct_boards: progress.2,
                total_boards: progress.0,
            });
        }
    } else if let Some(ref sid) = row.student_id {
        // Individual assignment: get progress for the single student
        let student = sqlx::query_as::<_, StudentMemberRow>(
            "SELECT id AS student_id, first_name, last_name FROM users WHERE id = ?",
        )
        .bind(sid)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        if let Some(s) = student {
            let progress =
                compute_student_progress(&state, &row.id, &row.exercise_id, sid).await?;
            student_progress.push(StudentAssignmentProgress {
                student_id: s.student_id,
                first_name: s.first_name,
                last_name: s.last_name,
                attempted_boards: progress.1,
                correct_boards: progress.2,
                total_boards: progress.0,
            });
        }
    }

    // Grid view (issue #7): ordered board list + one cell per
    // (student, board) for the latest observation. Cells with no
    // observation are omitted; the frontend treats those as
    // not_attempted.
    let boards: Vec<crate::models::AssignmentGridBoard> = sqlx::query_as(
        r#"
        SELECT deal_subfolder, deal_number, sort_order
        FROM exercise_boards
        WHERE exercise_id = ?
        ORDER BY sort_order ASC, deal_subfolder ASC, deal_number ASC
        "#,
    )
    .bind(&row.exercise_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Latest observation per (student, board) joined to this
    // assignment_id. Uses a window-function-style "max timestamp per
    // group" trick: a subquery picks the max timestamp, then we
    // re-join to fetch the matching row's columns.
    let cells: Vec<crate::models::AssignmentGridCell> = sqlx::query_as(
        r#"
        SELECT o.user_id        AS student_id,
               o.deal_subfolder AS deal_subfolder,
               o.deal_number    AS deal_number,
               o.status         AS status,
               o.correct        AS correct,
               o.id             AS observation_id,
               o.timestamp      AS timestamp
        FROM observations o
        JOIN (
            SELECT user_id, deal_subfolder, deal_number, MAX(timestamp) AS max_ts
            FROM observations
            WHERE assignment_id = ?
            GROUP BY user_id, deal_subfolder, deal_number
        ) latest
          ON latest.user_id        = o.user_id
         AND latest.deal_subfolder = o.deal_subfolder
         AND latest.deal_number    = o.deal_number
         AND latest.max_ts         = o.timestamp
        WHERE o.assignment_id = ?
        "#,
    )
    .bind(&assignment_id)
    .bind(&assignment_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(AssignmentDetailResponse {
        success: true,
        assignment: AssignmentDetail {
            id: row.id,
            exercise_name: row.exercise_name,
            exercise_id: row.exercise_id,
            classroom_id: row.classroom_id,
            classroom_name: row.classroom_name,
            student_id: row.student_id,
            assigned_by: row.assigned_by,
            assigned_at: row.assigned_at,
            due_at: row.due_at,
            total_boards: board_count,
            student_progress,
            boards,
            cells,
        },
    }))
}

/// DELETE /api/assignments/:id — Delete assignment (teacher only)
pub async fn delete_assignment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(assignment_id): Path<String>,
) -> Result<Json<AssignmentActionResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let result = sqlx::query("DELETE FROM assignments WHERE id = ?")
        .bind(&assignment_id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to delete assignment: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        })?;

    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "Assignment not found".to_string()));
    }

    tracing::info!("Assignment deleted: {}", assignment_id);

    Ok(Json(AssignmentActionResponse {
        success: true,
        error: None,
    }))
}

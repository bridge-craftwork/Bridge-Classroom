use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};

use crate::models::{
    CreateExerciseRequest, CreateExerciseResponse, DeleteExerciseQuery, ExerciseActionResponse,
    ExerciseAssignmentRef, ExerciseBoard, ExerciseDetail, ExerciseDetailResponse, ExerciseInfo,
    ExerciseListResponse, ExerciseQuery, UpdateExerciseRequest,
};
use crate::AppState;

/// Verify the actor owns the exercise. Returns Err if a `created_by` is
/// set on the row and the actor does not match. When `created_by IS
/// NULL` (legacy exercises with no recorded owner) anyone with the API
/// key may edit — keeps pre-#15 data usable.
fn check_owner(
    created_by: Option<&str>,
    actor_user_id: Option<&str>,
) -> Result<(), (StatusCode, String)> {
    match (created_by, actor_user_id) {
        (Some(owner), Some(actor)) if owner == actor => Ok(()),
        (Some(_), _) => Err((
            StatusCode::FORBIDDEN,
            "Only the exercise's creator can modify or delete it".to_string(),
        )),
        (None, _) => Ok(()),
    }
}

/// Per-teacher exercise-creation quotas (issue #15). The shared API key
/// is bundled with the frontend (CLAUDE.md, "API Security Notes"), so
/// it can't be relied on to keep an attacker out — these counts are the
/// real ceiling on how much data a single account can put in the DB.
/// Both counters include soft-deleted rows: those still consume storage
/// and history.
const EXERCISES_PER_MONTH: i64 = 100;
const EXERCISES_LIFETIME: i64 = 1000;
const ONE_MONTH_SECS: i64 = 30 * 24 * 60 * 60;

/// Enforce the per-month and lifetime quotas for `created_by`. Skipped
/// when the creator is unknown (we have nothing to bucket on).
async fn check_creation_quota(
    pool: &sqlx::SqlitePool,
    created_by: Option<&str>,
) -> Result<(), (StatusCode, String)> {
    let owner = match created_by {
        Some(u) => u,
        None => return Ok(()),
    };

    let lifetime: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM exercises WHERE created_by = ?",
    )
    .bind(owner)
    .fetch_one(pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if lifetime >= EXERCISES_LIFETIME {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            format!(
                "Lifetime exercise limit reached ({} per account). Delete some older exercises before creating more.",
                EXERCISES_LIFETIME
            ),
        ));
    }

    let cutoff = (chrono::Utc::now() - chrono::Duration::seconds(ONE_MONTH_SECS)).to_rfc3339();
    let last_month: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM exercises WHERE created_by = ? AND created_at >= ?",
    )
    .bind(owner)
    .bind(&cutoff)
    .fetch_one(pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if last_month >= EXERCISES_PER_MONTH {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            format!(
                "Monthly exercise limit reached ({} per 30 days). Wait or delete recent exercises.",
                EXERCISES_PER_MONTH
            ),
        ));
    }

    Ok(())
}

/// Validate API key from request headers
fn validate_api_key(headers: &HeaderMap, expected_key: &str) -> bool {
    if let Some(header_key) = headers.get("x-api-key").and_then(|v| v.to_str().ok()) {
        return header_key == expected_key;
    }
    false
}

// ---- Helper structs for joined queries ----

/// One row of the exercise listing, with all per-exercise rollup
/// counts inlined via correlated subqueries (issue #15). Cheaper than
/// a single GROUP BY because each metric joins independently.
#[derive(sqlx::FromRow)]
struct ExerciseWithRollup {
    id: String,
    name: String,
    description: Option<String>,
    created_by: Option<String>,
    curriculum_path: Option<String>,
    visibility: String,
    created_at: String,
    board_count: i64,
    assignment_count: i64,
    student_count: i64,
    observation_count: i64,
    success_rate: Option<f64>,
}

#[derive(sqlx::FromRow)]
struct ExerciseRow {
    id: String,
    name: String,
    description: Option<String>,
    created_by: Option<String>,
    curriculum_path: Option<String>,
    visibility: String,
    created_at: String,
}

/// Shared SQL fragment used by both the list and detail endpoints to
/// project exercise rows with their usage rollup. The
/// `clean_correct`-based success rate matches CORRECTNESS_AND_MASTERY.md
/// §15. Subqueries use the indexes added in db.rs (idx_assignments_exercise,
/// idx_observations_exercise).
const ROLLUP_SELECT: &str = r#"
    e.id, e.name, e.description, e.created_by, e.curriculum_path,
    e.visibility, e.created_at,
    (SELECT COUNT(*) FROM exercise_boards eb WHERE eb.exercise_id = e.id) AS board_count,
    (SELECT COUNT(*) FROM assignments a WHERE a.exercise_id = e.id) AS assignment_count,
    (SELECT COUNT(DISTINCT o.user_id) FROM observations o WHERE o.exercise_id = e.id) AS student_count,
    (SELECT COUNT(*) FROM observations o WHERE o.exercise_id = e.id) AS observation_count,
    (SELECT
        CASE WHEN COUNT(*) = 0 THEN NULL
             ELSE 1.0 * SUM(CASE WHEN status = 'clean_correct' THEN 1 ELSE 0 END) / COUNT(*)
        END
     FROM observations o WHERE o.exercise_id = e.id) AS success_rate
"#;

/// Fetch all assignments that reference any of the given exercise IDs,
/// joined to their classroom name (when classroom-targeted) and the
/// teacher who assigned them. Returns a flat list; the caller groups by
/// `exercise_id` to attach to each `ExerciseInfo`.
async fn fetch_assignments_for_exercises(
    pool: &sqlx::SqlitePool,
    exercise_ids: &[String],
) -> Result<Vec<ExerciseAssignmentRef>, (StatusCode, String)> {
    if exercise_ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = std::iter::repeat("?")
        .take(exercise_ids.len())
        .collect::<Vec<_>>()
        .join(",");
    // `users` stores names as (first_name, last_name) — no `name`
    // column. Concatenate for display.
    let sql = format!(
        r#"
        SELECT
            a.id           AS id,
            a.exercise_id  AS exercise_id,
            a.classroom_id AS classroom_id,
            c.name         AS classroom_name,
            a.student_id   AS student_id,
            a.assigned_by  AS assigned_by,
            TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS assigned_by_name,
            a.assigned_at  AS assigned_at,
            a.due_at       AS due_at
        FROM assignments a
        LEFT JOIN classrooms c ON c.id = a.classroom_id
        LEFT JOIN users      u ON u.id = a.assigned_by
        WHERE a.exercise_id IN ({})
        ORDER BY a.assigned_at DESC
        "#,
        placeholders
    );
    let mut q = sqlx::query_as::<_, ExerciseAssignmentRef>(&sql);
    for id in exercise_ids {
        q = q.bind(id);
    }
    q.fetch_all(pool).await.map_err(|e| {
        tracing::error!("Failed to fetch exercise assignments: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })
}

/// Group a flat list of assignments by `exercise_id`, preserving the
/// SQL-side ordering (assigned_at DESC).
fn group_assignments_by_exercise(
    rows: Vec<ExerciseAssignmentRef>,
) -> std::collections::HashMap<String, Vec<ExerciseAssignmentRef>> {
    let mut by_exercise: std::collections::HashMap<String, Vec<ExerciseAssignmentRef>> =
        std::collections::HashMap::new();
    for row in rows {
        by_exercise
            .entry(row.exercise_id.clone())
            .or_default()
            .push(row);
    }
    by_exercise
}

// ---- Endpoints ----

/// POST /api/exercises — Create an exercise with boards
pub async fn create_exercise(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateExerciseRequest>,
) -> Result<Json<CreateExerciseResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    if req.name.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Exercise name is required".to_string()));
    }

    if req.boards.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "At least one board is required".to_string(),
        ));
    }

    check_creation_quota(&state.db, req.created_by.as_deref()).await?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let visibility = req.visibility.as_deref().unwrap_or("public");

    // Use a transaction to insert exercise + boards atomically
    let mut tx = state.db.begin().await.map_err(|e| {
        tracing::error!("Failed to begin transaction: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    sqlx::query(
        r#"
        INSERT INTO exercises (id, name, description, created_by, curriculum_path, visibility, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(req.name.trim())
    .bind(&req.description)
    .bind(&req.created_by)
    .bind(&req.curriculum_path)
    .bind(visibility)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to insert exercise: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    for board in &req.boards {
        sqlx::query(
            r#"
            INSERT INTO exercise_boards (exercise_id, deal_subfolder, deal_number, sort_order, collection_id)
            VALUES (?, ?, ?, ?, ?)
            "#,
        )
        .bind(&id)
        .bind(&board.deal_subfolder)
        .bind(board.deal_number)
        .bind(board.sort_order)
        .bind(&board.collection_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Failed to insert exercise board: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        })?;
    }

    tx.commit().await.map_err(|e| {
        tracing::error!("Failed to commit transaction: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    let board_count = req.boards.len() as i64;
    tracing::info!("Exercise created: {} ({} boards)", req.name.trim(), board_count);

    // Newly created exercise has no assignments / observations yet — the
    // rollup fields are all zero.
    Ok(Json(CreateExerciseResponse {
        success: true,
        exercise: ExerciseInfo {
            id,
            name: req.name.trim().to_string(),
            description: req.description,
            created_by: req.created_by,
            curriculum_path: req.curriculum_path,
            visibility: visibility.to_string(),
            created_at: now,
            board_count,
            assignment_count: 0,
            student_count: 0,
            observation_count: 0,
            success_rate: None,
            assignments: Vec::new(),
        },
    }))
}

/// GET /api/exercises — List exercises with board counts
pub async fn list_exercises(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ExerciseQuery>,
) -> Result<Json<ExerciseListResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    // Soft-deleted rows are excluded — they're tombstones kept only so
    // observations' `exercise_id` references remain resolvable for
    // history views.
    let mut sql = format!(
        r#"
        SELECT {rollup}
        FROM exercises e
        WHERE e.deleted_at IS NULL
        "#,
        rollup = ROLLUP_SELECT
    );

    let mut binds: Vec<String> = Vec::new();

    if let Some(ref created_by) = query.created_by {
        sql.push_str(" AND e.created_by = ?");
        binds.push(created_by.clone());
    }

    if let Some(ref curriculum_path) = query.curriculum_path {
        sql.push_str(" AND e.curriculum_path = ?");
        binds.push(curriculum_path.clone());
    }

    if let Some(ref visibility) = query.visibility {
        sql.push_str(" AND e.visibility = ?");
        binds.push(visibility.clone());
    }

    sql.push_str(" ORDER BY e.created_at DESC");

    // Execute with dynamic binds
    let mut q = sqlx::query_as::<_, ExerciseWithRollup>(&sql);
    for bind in &binds {
        q = q.bind(bind);
    }

    let rows = q.fetch_all(&state.db).await.map_err(|e| {
        tracing::error!("Failed to list exercises: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    // Fetch the per-exercise assignment list in one batched query. A
    // public exercise can be assigned by any teacher, so `assigned_by`
    // here is the assignment author — not necessarily the exercise's
    // `created_by`.
    let ids: Vec<String> = rows.iter().map(|r| r.id.clone()).collect();
    let assignments_flat = fetch_assignments_for_exercises(&state.db, &ids).await?;
    let mut assignments_by_id = group_assignments_by_exercise(assignments_flat);

    let exercises = rows
        .into_iter()
        .map(|r| ExerciseInfo {
            assignments: assignments_by_id.remove(&r.id).unwrap_or_default(),
            id: r.id,
            name: r.name,
            description: r.description,
            created_by: r.created_by,
            curriculum_path: r.curriculum_path,
            visibility: r.visibility,
            created_at: r.created_at,
            board_count: r.board_count,
            assignment_count: r.assignment_count,
            student_count: r.student_count,
            observation_count: r.observation_count,
            success_rate: r.success_rate,
        })
        .collect();

    Ok(Json(ExerciseListResponse {
        success: true,
        exercises,
    }))
}

/// GET /api/exercises/:id — Get exercise detail with board list
pub async fn get_exercise(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(exercise_id): Path<String>,
) -> Result<Json<ExerciseDetailResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let exercise = sqlx::query_as::<_, ExerciseRow>(
        "SELECT id, name, description, created_by, curriculum_path, visibility, created_at FROM exercises WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&exercise_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to fetch exercise: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?
    .ok_or_else(|| (StatusCode::NOT_FOUND, "Exercise not found".to_string()))?;

    let boards = sqlx::query_as::<_, ExerciseBoard>(
        "SELECT exercise_id, deal_subfolder, deal_number, sort_order, collection_id FROM exercise_boards WHERE exercise_id = ? ORDER BY sort_order",
    )
    .bind(&exercise_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to fetch exercise boards: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    Ok(Json(ExerciseDetailResponse {
        success: true,
        exercise: ExerciseDetail {
            id: exercise.id,
            name: exercise.name,
            description: exercise.description,
            created_by: exercise.created_by,
            curriculum_path: exercise.curriculum_path,
            visibility: exercise.visibility,
            created_at: exercise.created_at,
            boards,
        },
    }))
}

/// PUT /api/exercises/:id — Update exercise (owner only)
pub async fn update_exercise(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(exercise_id): Path<String>,
    Json(req): Json<UpdateExerciseRequest>,
) -> Result<Json<ExerciseActionResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    // Verify exercise exists and the actor owns it (issue #15).
    let existing = sqlx::query_as::<_, ExerciseRow>(
        "SELECT id, name, description, created_by, curriculum_path, visibility, created_at FROM exercises WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&exercise_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, "Exercise not found".to_string()))?;

    check_owner(existing.created_by.as_deref(), req.actor_user_id.as_deref())?;

    let mut tx = state.db.begin().await.map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    // Update exercise fields if provided
    if let Some(ref name) = req.name {
        if name.trim().is_empty() {
            return Err((StatusCode::BAD_REQUEST, "Exercise name cannot be empty".to_string()));
        }
        sqlx::query("UPDATE exercises SET name = ? WHERE id = ?")
            .bind(name.trim())
            .bind(&exercise_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    if let Some(ref description) = req.description {
        sqlx::query("UPDATE exercises SET description = ? WHERE id = ?")
            .bind(description)
            .bind(&exercise_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    if let Some(ref visibility) = req.visibility {
        sqlx::query("UPDATE exercises SET visibility = ? WHERE id = ?")
            .bind(visibility)
            .bind(&exercise_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    // Replace boards if provided
    if let Some(ref boards) = req.boards {
        if boards.is_empty() {
            return Err((
                StatusCode::BAD_REQUEST,
                "At least one board is required".to_string(),
            ));
        }

        sqlx::query("DELETE FROM exercise_boards WHERE exercise_id = ?")
            .bind(&exercise_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        for board in boards {
            sqlx::query(
                "INSERT INTO exercise_boards (exercise_id, deal_subfolder, deal_number, sort_order, collection_id) VALUES (?, ?, ?, ?, ?)",
            )
            .bind(&exercise_id)
            .bind(&board.deal_subfolder)
            .bind(board.deal_number)
            .bind(board.sort_order)
            .bind(&board.collection_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        }
    }

    tx.commit().await.map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    tracing::info!("Exercise updated: {}", exercise_id);

    Ok(Json(ExerciseActionResponse {
        success: true,
        error: None,
    }))
}

/// DELETE /api/exercises/:id — Soft-delete an exercise (issue #15).
///
/// Tombstones the row by setting `deleted_at`. Observations keep their
/// `exercise_id` value, which still resolves for history views; new
/// listings exclude the tombstoned row. Existing assignments stay so
/// their progress history is preserved — student-facing flows should
/// treat the deleted exercise as unavailable.
pub async fn delete_exercise(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(exercise_id): Path<String>,
    Query(query): Query<DeleteExerciseQuery>,
) -> Result<Json<ExerciseActionResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let existing = sqlx::query_as::<_, ExerciseRow>(
        "SELECT id, name, description, created_by, curriculum_path, visibility, created_at FROM exercises WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&exercise_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, "Exercise not found".to_string()))?;

    check_owner(existing.created_by.as_deref(), query.actor_user_id.as_deref())?;

    let now = chrono::Utc::now().to_rfc3339();
    let result = sqlx::query("UPDATE exercises SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL")
        .bind(&now)
        .bind(&exercise_id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to soft-delete exercise: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        })?;

    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "Exercise not found".to_string()));
    }

    tracing::info!("Exercise soft-deleted: {}", exercise_id);

    Ok(Json(ExerciseActionResponse {
        success: true,
        error: None,
    }))
}

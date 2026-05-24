use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;

use crate::{
    models::{
        Observation, ObservationMetadata, ObservationQuery, ObservationsMetadataResponse,
        ObservationsResponse, SubmitObservationsRequest, SubmitObservationsResponse,
    },
    AppState,
};

use super::board_status::{derive_wilderness, recompute_board_history};
use crate::student_summary::recompute_student_summary;

use std::collections::HashSet;

/// Query parameters for submit endpoint (for sendBeacon support)
#[derive(Debug, Deserialize)]
pub struct SubmitQuery {
    pub api_key: Option<String>,
}

/// Validate API key from request headers or query params
fn validate_api_key(headers: &HeaderMap, query_key: Option<&str>, expected_key: &str) -> bool {
    // Check header first
    if let Some(header_key) = headers.get("x-api-key").and_then(|v| v.to_str().ok()) {
        if header_key == expected_key {
            return true;
        }
    }

    // Fall back to query parameter (for sendBeacon)
    if let Some(qk) = query_key {
        if qk == expected_key {
            return true;
        }
    }

    false
}

/// POST /api/observations
/// Submit encrypted observations
pub async fn submit_observations(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<SubmitQuery>,
    Json(req): Json<SubmitObservationsRequest>,
) -> Result<Json<SubmitObservationsResponse>, (StatusCode, String)> {
    // Validate API key (from header or query param for sendBeacon support)
    if !validate_api_key(&headers, query.api_key.as_deref(), &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let received = req.observations.len();
    let mut stored = 0;
    let mut errors = Vec::new();

    // Boards needing recomputation, and users needing a refreshed summary.
    // Use HashSet to dedupe across multiple observations in the same batch.
    let mut boards_to_recompute: HashSet<(String, String, i32)> = HashSet::new();
    let mut users_to_refresh: HashSet<String> = HashSet::new();

    for encrypted_obs in req.observations {
        let obs = Observation::from_encrypted(encrypted_obs);

        // CORRECTNESS_AND_MASTERY.md §11.2: derive wilderness from the
        // observation's context fields, frozen at insert time.
        let wilderness = derive_wilderness(
            &state.db,
            obs.deal_subfolder.as_deref(),
            obs.exercise_id.as_deref(),
            obs.assignment_id.as_deref(),
            obs.jungle,
        )
        .await;

        match sqlx::query(
            r#"
            INSERT INTO observations (
                id, user_id, timestamp, skill_path, correct, classroom,
                deal_subfolder, deal_number, encrypted_data, iv, created_at,
                board_result, wilderness, exercise_id, assignment_id, jungle,
                time_taken_ms
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                encrypted_data = excluded.encrypted_data,
                iv             = excluded.iv,
                correct        = excluded.correct,
                timestamp      = excluded.timestamp,
                board_result   = excluded.board_result,
                wilderness     = excluded.wilderness,
                exercise_id    = excluded.exercise_id,
                assignment_id  = excluded.assignment_id,
                jungle         = excluded.jungle,
                time_taken_ms  = COALESCE(excluded.time_taken_ms, observations.time_taken_ms)
            "#,
        )
        .bind(&obs.id)
        .bind(&obs.user_id)
        .bind(&obs.timestamp)
        .bind(&obs.skill_path)
        .bind(obs.correct)
        .bind(&obs.classroom)
        .bind(&obs.deal_subfolder)
        .bind(obs.deal_number)
        .bind(&obs.encrypted_data)
        .bind(&obs.iv)
        .bind(&obs.created_at)
        .bind(&obs.board_result)
        .bind(&wilderness)
        .bind(&obs.exercise_id)
        .bind(&obs.assignment_id)
        .bind(obs.jungle)
        .bind(obs.time_taken_ms)
        .execute(&state.db)
        .await
        {
            Ok(_) => {
                stored += 1;
                if let (Some(ref subfolder), Some(deal_num)) = (&obs.deal_subfolder, obs.deal_number) {
                    boards_to_recompute.insert((
                        obs.user_id.clone(),
                        subfolder.clone(),
                        deal_num,
                    ));
                    users_to_refresh.insert(obs.user_id.clone());
                }
            }
            Err(e) => {
                tracing::error!("Failed to store observation {}: {}", obs.id, e);
                errors.push(format!("Failed to store {}: {}", obs.id, e));
            }
        }
    }

    // Recompute board_status (and per-observation status/wilderness) for
    // every affected (user, board). This is the v2 walker that produces
    // the new state machine, stars, and wild_achievement.
    for (user_id, subfolder, deal_number) in &boards_to_recompute {
        if let Err(e) =
            recompute_board_history(&state.db, user_id, subfolder, *deal_number).await
        {
            tracing::error!(
                "Failed to recompute board history for {}/{}/{}: {}",
                user_id, subfolder, deal_number, e
            );
        }
    }

    // Refresh the per-user summary row once for each affected user.
    // student_summary is a cache; this is what keeps it in sync.
    for user_id in &users_to_refresh {
        if let Err(e) = recompute_student_summary(&state.db, user_id).await {
            tracing::error!("Failed to refresh student_summary for {}: {}", user_id, e);
        }
    }

    tracing::info!(
        "Stored {}/{} observations ({} boards recomputed, {} summaries refreshed)",
        stored, received, boards_to_recompute.len(), users_to_refresh.len(),
    );

    Ok(Json(SubmitObservationsResponse {
        received,
        stored,
        errors,
    }))
}

/// GET /api/observations
/// Fetch observations with optional filters
pub async fn get_observations(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ObservationQuery>,
) -> Result<Json<ObservationsResponse>, (StatusCode, String)> {
    // Validate API key
    if !validate_api_key(&headers, None, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let limit = query.limit.unwrap_or(100).min(10000);
    let offset = query.offset.unwrap_or(0);

    // Build query dynamically
    let mut sql = String::from("SELECT * FROM observations WHERE 1=1");
    let mut count_sql = String::from("SELECT COUNT(*) as count FROM observations WHERE 1=1");

    if query.user_id.is_some() {
        sql.push_str(" AND user_id = ?");
        count_sql.push_str(" AND user_id = ?");
    }
    if query.classroom.is_some() {
        sql.push_str(" AND classroom = ?");
        count_sql.push_str(" AND classroom = ?");
    }
    if query.skill_path.is_some() {
        sql.push_str(" AND skill_path LIKE ?");
        count_sql.push_str(" AND skill_path LIKE ?");
    }
    if query.correct.is_some() {
        sql.push_str(" AND correct = ?");
        count_sql.push_str(" AND correct = ?");
    }
    if query.from.is_some() {
        sql.push_str(" AND timestamp >= ?");
        count_sql.push_str(" AND timestamp >= ?");
    }
    if query.to.is_some() {
        sql.push_str(" AND timestamp <= ?");
        count_sql.push_str(" AND timestamp <= ?");
    }

    sql.push_str(" ORDER BY timestamp DESC LIMIT ? OFFSET ?");

    // Build and execute the query
    let mut query_builder = sqlx::query_as::<_, Observation>(&sql);
    let mut count_builder = sqlx::query_scalar::<_, i64>(&count_sql);

    // Bind parameters in order
    if let Some(ref user_id) = query.user_id {
        query_builder = query_builder.bind(user_id);
        count_builder = count_builder.bind(user_id);
    }
    if let Some(ref classroom) = query.classroom {
        query_builder = query_builder.bind(classroom);
        count_builder = count_builder.bind(classroom);
    }
    if let Some(ref skill_path) = query.skill_path {
        let pattern = format!("{}%", skill_path);
        query_builder = query_builder.bind(pattern.clone());
        count_builder = count_builder.bind(pattern);
    }
    if let Some(correct) = query.correct {
        query_builder = query_builder.bind(correct);
        count_builder = count_builder.bind(correct);
    }
    if let Some(ref from) = query.from {
        query_builder = query_builder.bind(from);
        count_builder = count_builder.bind(from);
    }
    if let Some(ref to) = query.to {
        query_builder = query_builder.bind(to);
        count_builder = count_builder.bind(to);
    }

    query_builder = query_builder.bind(limit).bind(offset);

    let observations = query_builder
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let total = count_builder
        .fetch_one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(ObservationsResponse {
        observations,
        total,
        limit,
        offset,
    }))
}

/// GET /api/observations/metadata
/// Fetch observation metadata only (no encrypted data)
pub async fn get_observations_metadata(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ObservationQuery>,
) -> Result<Json<ObservationsMetadataResponse>, (StatusCode, String)> {
    // Validate API key
    if !validate_api_key(&headers, None, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    // Build query dynamically
    let mut sql = String::from(
        "SELECT id, user_id, timestamp, skill_path, correct, classroom, deal_subfolder, deal_number, board_result FROM observations WHERE 1=1",
    );
    let mut count_sql = String::from("SELECT COUNT(*) as count FROM observations WHERE 1=1");

    if query.user_id.is_some() {
        sql.push_str(" AND user_id = ?");
        count_sql.push_str(" AND user_id = ?");
    }
    if query.classroom.is_some() {
        sql.push_str(" AND classroom = ?");
        count_sql.push_str(" AND classroom = ?");
    }
    if query.skill_path.is_some() {
        sql.push_str(" AND skill_path LIKE ?");
        count_sql.push_str(" AND skill_path LIKE ?");
    }
    if query.correct.is_some() {
        sql.push_str(" AND correct = ?");
        count_sql.push_str(" AND correct = ?");
    }
    if query.from.is_some() {
        sql.push_str(" AND timestamp >= ?");
        count_sql.push_str(" AND timestamp >= ?");
    }
    if query.to.is_some() {
        sql.push_str(" AND timestamp <= ?");
        count_sql.push_str(" AND timestamp <= ?");
    }

    sql.push_str(" ORDER BY timestamp DESC");

    // Build and execute the query
    let mut query_builder = sqlx::query_as::<_, (String, String, String, String, bool, Option<String>, Option<String>, Option<i32>, Option<String>)>(&sql);
    let mut count_builder = sqlx::query_scalar::<_, i64>(&count_sql);

    // Bind parameters in order
    if let Some(ref user_id) = query.user_id {
        query_builder = query_builder.bind(user_id);
        count_builder = count_builder.bind(user_id);
    }
    if let Some(ref classroom) = query.classroom {
        query_builder = query_builder.bind(classroom);
        count_builder = count_builder.bind(classroom);
    }
    if let Some(ref skill_path) = query.skill_path {
        let pattern = format!("{}%", skill_path);
        query_builder = query_builder.bind(pattern.clone());
        count_builder = count_builder.bind(pattern);
    }
    if let Some(correct) = query.correct {
        query_builder = query_builder.bind(correct);
        count_builder = count_builder.bind(correct);
    }
    if let Some(ref from) = query.from {
        query_builder = query_builder.bind(from);
        count_builder = count_builder.bind(from);
    }
    if let Some(ref to) = query.to {
        query_builder = query_builder.bind(to);
        count_builder = count_builder.bind(to);
    }

    let rows = query_builder
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let observations: Vec<ObservationMetadata> = rows
        .into_iter()
        .map(|(id, user_id, timestamp, skill_path, correct, classroom, deal_subfolder, deal_number, board_result)| {
            ObservationMetadata {
                observation_id: id,
                user_id,
                timestamp,
                skill_path,
                correct,
                classroom,
                deal_subfolder,
                deal_number,
                board_result,
            }
        })
        .collect();

    let total = count_builder
        .fetch_one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(ObservationsMetadataResponse { observations, total }))
}

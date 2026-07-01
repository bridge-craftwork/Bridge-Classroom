use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Sqlite};

use crate::AppState;

const COOLDOWN_SECS: i64 = 3600; // 1 hour
const ACHIEVEMENT_SPACING_DAYS: i64 = 6;

// ---- Models ----

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct BoardStatusEntry {
    pub deal_subfolder: String,
    pub deal_number: i32,
    pub status: String,
    pub wilderness: String,
    pub last_error_date: Option<String>,
    pub star_count: i64,
    pub max_stars: i64,
    pub last_star_update: Option<String>,
    pub wild_achievement: Option<String>,
    pub last_observation_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct BoardStatusResponse {
    pub boards: Vec<BoardStatusEntry>,
}

#[derive(Debug, Deserialize)]
pub struct BoardStatusQuery {
    pub user_id: String,
    pub deal_subfolder: Option<String>,
}


/// Parse an ISO8601 timestamp string into a chrono DateTime.
fn parse_timestamp(ts: &str) -> Option<DateTime<Utc>> {
    ts.parse::<DateTime<Utc>>().ok()
}


// ---- API Handler ----

/// Validate API key from request headers
fn validate_api_key(headers: &HeaderMap, expected_key: &str) -> bool {
    if let Some(header_key) = headers.get("x-api-key").and_then(|v| v.to_str().ok()) {
        return header_key == expected_key;
    }
    false
}

/// GET /api/board-status?user_id=X&deal_subfolder=Y
pub async fn get_board_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<BoardStatusQuery>,
) -> Result<Json<BoardStatusResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    // FromRow on BoardStatusEntry means we can pull all the v2 columns
    // directly. The legacy `achievement` column is intentionally not
    // selected — it's been superseded by max_stars / wild_achievement.
    let select_columns = r#"
        deal_subfolder, deal_number,
        status, wilderness, last_error_date,
        star_count, max_stars, last_star_update,
        wild_achievement, last_observation_at
    "#;

    let entries: Vec<BoardStatusEntry> = if let Some(ref subfolder) = query.deal_subfolder {
        sqlx::query_as::<_, BoardStatusEntry>(&format!(
            "SELECT {} FROM board_status WHERE user_id = ? AND deal_subfolder = ? ORDER BY deal_number ASC",
            select_columns
        ))
        .bind(&query.user_id)
        .bind(subfolder)
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    } else {
        sqlx::query_as::<_, BoardStatusEntry>(&format!(
            "SELECT {} FROM board_status WHERE user_id = ? ORDER BY deal_subfolder ASC, deal_number ASC",
            select_columns
        ))
        .bind(&query.user_id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    };

    Ok(Json(BoardStatusResponse { boards: entries }))
}

// =====================================================================
// Assignment-scoped board status (rollup parallel to board_status)
// =====================================================================

#[derive(Debug, Deserialize)]
pub struct AssignmentStatusQuery {
    pub user_id: String,
    pub assignment_id: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct AssignmentStatusEntry {
    pub deal_subfolder: String,
    pub deal_number: i32,
    pub status: String,
    pub last_observation_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AssignmentStatusResponse {
    pub entries: Vec<AssignmentStatusEntry>,
}

/// GET /api/assignment-status?user_id=X&assignment_id=Y
///
/// Returns the per-board §5 status for the work a student did INSIDE one
/// assignment (observations tagged with that assignment_id). Mirrors
/// `/api/board-status` but scoped to a single assignment — the canonical
/// source for the assignment progress bar (no client-side observation query).
pub async fn get_assignment_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<AssignmentStatusQuery>,
) -> Result<Json<AssignmentStatusResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let entries: Vec<AssignmentStatusEntry> = sqlx::query_as(
        r#"
        SELECT deal_subfolder, deal_number, status, last_observation_at
        FROM assignment_board_status
        WHERE user_id = ? AND assignment_id = ?
        ORDER BY deal_subfolder ASC, deal_number ASC
        "#,
    )
    .bind(&query.user_id)
    .bind(&query.assignment_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(AssignmentStatusResponse { entries }))
}

// =====================================================================
// Wilderness derivation
// =====================================================================
//
// Implements CORRECTNESS_AND_MASTERY.md §11.2. Called at observation
// insert time from `submit_observations` to set the clear-text
// `wilderness` column on the row, which the recompute walker then reads.

/// Compute the wilderness of an observation given its context.
///
/// Rules:
///   1. `jungle = true` → `Wild`
///   2. `exercise_id` set → look up the exercise's boards, apply the 25% rule
///   3. `assignment_id` set → resolve to the underlying exercise, then 25% rule
///   4. None of the above → `Tame`
///
/// The 25% rule: if fewer than 25% of the exercise's boards share the
/// `deal_subfolder` of the board being recorded, wilderness is Wild.
/// Otherwise Tame.
pub async fn derive_wilderness(
    pool: &Pool<Sqlite>,
    deal_subfolder: Option<&str>,
    exercise_id: Option<&str>,
    assignment_id: Option<&str>,
    jungle: bool,
) -> String {
    if jungle {
        return "Wild".to_string();
    }

    let subfolder = match deal_subfolder {
        Some(s) => s,
        None => return "Tame".to_string(), // No board context — can't be wild
    };

    // Resolve to an exercise_id (assignment wraps exercise).
    let resolved_exercise_id: Option<String> = if let Some(eid) = exercise_id {
        Some(eid.to_string())
    } else if let Some(aid) = assignment_id {
        sqlx::query_scalar::<_, String>(
            r#"SELECT exercise_id FROM assignments WHERE id = ?"#,
        )
        .bind(aid)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
    } else {
        None
    };

    let eid = match resolved_exercise_id {
        Some(e) => e,
        None => return "Tame".to_string(),
    };

    // Count total boards in the exercise and how many share this subfolder.
    let row: Result<(i64, i64), _> = sqlx::query_as(
        r#"
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN deal_subfolder = ? THEN 1 ELSE 0 END) AS same_lesson
        FROM exercise_boards
        WHERE exercise_id = ?
        "#,
    )
    .bind(subfolder)
    .bind(&eid)
    .fetch_one(pool)
    .await;

    match row {
        Ok((total, same_lesson)) if total > 0 => {
            let ratio = same_lesson as f64 / total as f64;
            if ratio < 0.25 { "Wild".to_string() } else { "Tame".to_string() }
        }
        // Empty or missing exercise — default safe, treat as Tame.
        _ => "Tame".to_string(),
    }
}

// =====================================================================
// Correctness & Mastery v2 walker
// =====================================================================
//
// See documentation/CORRECTNESS_AND_MASTERY.md §5 (state), §6 (stars),
// §7 (paws), §11 (wilderness). Replaces the old `recompute_board_status`
// / `compute_achievement` pair with a single full-history walk that
// produces both the per-observation `status` / `wilderness` fields and
// the final `board_status` row in one pass.
//
// The old `recompute_board_status` and its helpers are left untouched
// for now; they're still wired to `observations.rs::submit_observations`
// and will be replaced in a later commit. This module is exported so
// the v2 backfill in `db.rs` can call it directly.

#[derive(Debug, sqlx::FromRow)]
struct ObservationFullRow {
    id: String,
    timestamp: String,
    correct: bool,
    board_result: Option<String>,
    wilderness: Option<String>,
}

/// Walk every observation for (user, board) in chronological order and
/// recompute both the per-observation `status` / `wilderness` fields
/// and the final `board_status` row.
///
/// Idempotent: running it again on unchanged input produces unchanged
/// output. Used by both the v2 backfill and (eventually) the runtime
/// observation-insert path.
pub async fn recompute_board_history(
    pool: &Pool<Sqlite>,
    user_id: &str,
    deal_subfolder: &str,
    deal_number: i32,
) -> Result<(), String> {
    let observations: Vec<ObservationFullRow> = sqlx::query_as(
        r#"
        SELECT id, timestamp, correct, board_result, wilderness
        FROM observations
        WHERE user_id = ? AND deal_subfolder = ? AND deal_number = ?
        ORDER BY timestamp ASC
        "#,
    )
    .bind(user_id)
    .bind(deal_subfolder)
    .bind(deal_number)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Observation fetch failed: {}", e))?;

    if observations.is_empty() {
        upsert_board_status_v2(
            pool, user_id, deal_subfolder, deal_number,
            "not_attempted", "Tame",
            None, 0, 0, None, None, None,
        )
        .await?;
        return Ok(());
    }

    // Running state across the walk.
    let mut last_error_date: Option<DateTime<Utc>> = None;
    let mut star_count: i64 = 0;
    let mut max_stars: i64 = 0;
    let mut last_star_update: Option<DateTime<Utc>> = None;
    let mut wild_achievement: Option<String> = None;

    // Capture the final-observation values for the board_status upsert.
    let mut final_status = String::from("not_attempted");
    let mut final_wilderness = String::from("Tame");
    let mut final_timestamp = String::new();

    // §C8: apply the per-observation status/wilderness rewrites in a single
    // transaction. Previously each row was UPDATEd independently against the
    // pool, so an error partway through left observations.status inconsistent
    // with the derived history until the next sync happened to fix it.
    let mut tx = pool.begin().await.map_err(|e| format!("begin recompute tx failed: {}", e))?;

    for (i, obs) in observations.iter().enumerate() {
        let obs_ts = parse_timestamp(&obs.timestamp);
        let wilderness = obs.wilderness.clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Tame".to_string());
        let is_tame = wilderness == "Tame";

        // Derive this observation's status (§5).
        let obs_status: &str = derive_obs_status_v2(obs, obs_ts, &mut last_error_date);

        // Star transitions (§6.2/§6.3). Tame failed/corrected reset the
        // track; any clean_correct (Tame or Wild) can advance it.
        if is_tame && (obs_status == "failed" || obs_status == "corrected") {
            star_count = 0;
            last_star_update = None;
        } else if obs_status == "clean_correct" {
            match (last_star_update, obs_ts) {
                (None, Some(t)) => {
                    last_star_update = Some(t);
                    // star_count stays at 0 — track initiated, no star yet.
                }
                (Some(lsu), Some(cur)) => {
                    if (cur - lsu).num_days() >= ACHIEVEMENT_SPACING_DAYS {
                        star_count += 1;
                        last_star_update = Some(cur);
                        if star_count > max_stars {
                            max_stars = star_count;
                        }
                    }
                }
                _ => {} // timestamps unparseable; skip
            }
        }
        // close_correct and wild failed/corrected: no star change.

        // Wild achievement transitions (§7.2).
        if obs_status == "clean_correct"
            && !is_tame
            && wild_achievement.as_deref() != Some("Fresh")
        {
            let cold = is_board_cold(&observations, i, obs_ts);
            if cold {
                wild_achievement = Some("Fresh".to_string());
            } else if wild_achievement.is_none() {
                wild_achievement = Some("Recent".to_string());
            }
        }

        // Write the per-observation fields.
        sqlx::query(
            r#"UPDATE observations SET status = ?, wilderness = ? WHERE id = ?"#,
        )
        .bind(obs_status)
        .bind(&wilderness)
        .bind(&obs.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Observation update failed: {}", e))?;

        final_status = obs_status.to_string();
        final_wilderness = wilderness;
        final_timestamp = obs.timestamp.clone();
    }

    tx.commit().await.map_err(|e| format!("commit recompute tx failed: {}", e))?;

    upsert_board_status_v2(
        pool,
        user_id,
        deal_subfolder,
        deal_number,
        &final_status,
        &final_wilderness,
        last_error_date.map(|t| t.to_rfc3339()),
        star_count,
        max_stars,
        last_star_update.map(|t| t.to_rfc3339()),
        wild_achievement,
        Some(&final_timestamp),
    )
    .await
}

fn effective_board_result_v2(obs: &ObservationFullRow) -> String {
    match &obs.board_result {
        Some(r) if !r.is_empty() => r.clone(),
        _ => {
            if obs.correct {
                "correct".to_string()
            } else {
                "failed".to_string()
            }
        }
    }
}

/// Derive one observation's §5 status given the running `last_error_date`,
/// which this fn updates for failed/corrected observations. Pure §5 — no
/// star/paw/wilderness side effects. Shared by the board-scoped walk
/// (`recompute_board_history`) and the assignment-scoped walk
/// (`recompute_assignment_boards`) so both stay byte-identical.
fn derive_obs_status_v2(
    obs: &ObservationFullRow,
    obs_ts: Option<DateTime<Utc>>,
    last_error_date: &mut Option<DateTime<Utc>>,
) -> &'static str {
    let effective = effective_board_result_v2(obs);
    match effective.as_str() {
        "failed" => {
            *last_error_date = obs_ts;
            "failed"
        }
        "corrected" => {
            *last_error_date = obs_ts;
            "corrected"
        }
        "correct" => {
            let within_cooldown = match (*last_error_date, obs_ts) {
                (Some(led), Some(cur)) => (cur - led).num_seconds() < COOLDOWN_SECS,
                _ => false,
            };
            if within_cooldown { "close_correct" } else { "clean_correct" }
        }
        _ => {
            // Defensive — effective_board_result_v2 normalises null/empty;
            // shouldn't hit this branch.
            if obs.correct {
                "clean_correct"
            } else {
                *last_error_date = obs_ts;
                "failed"
            }
        }
    }
}

/// Recompute `assignment_board_status` for one (user, assignment).
///
/// For each board in the assignment's exercise, walk the user's observations
/// tagged with this assignment_id in chronological order and derive the §5
/// status (via `derive_obs_status_v2`), then upsert. Boards with no
/// assignment-tagged observation get `not_attempted`, so the rollup holds one
/// row per exercise board and is self-contained (total = row count).
///
/// Unlike `recompute_board_history`, this does NOT modify per-observation
/// columns — the canonical `observations.status` belongs to the board-scoped
/// walk. This is purely an assignment-scoped projection.
pub async fn recompute_assignment_boards(
    pool: &Pool<Sqlite>,
    user_id: &str,
    assignment_id: &str,
) -> Result<(), String> {
    let exercise_id: Option<String> =
        sqlx::query_scalar("SELECT exercise_id FROM assignments WHERE id = ?")
            .bind(assignment_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Assignment lookup failed: {}", e))?;

    let exercise_id = match exercise_id {
        Some(e) => e,
        None => return Ok(()), // orphaned assignment_id — nothing to roll up
    };

    let boards: Vec<(String, i32)> = sqlx::query_as(
        "SELECT deal_subfolder, deal_number FROM exercise_boards WHERE exercise_id = ?",
    )
    .bind(&exercise_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Exercise board fetch failed: {}", e))?;

    for (deal_subfolder, deal_number) in &boards {
        let observations: Vec<ObservationFullRow> = sqlx::query_as(
            r#"
            SELECT id, timestamp, correct, board_result, wilderness
            FROM observations
            WHERE user_id = ? AND assignment_id = ?
              AND deal_subfolder = ? AND deal_number = ?
            ORDER BY timestamp ASC
            "#,
        )
        .bind(user_id)
        .bind(assignment_id)
        .bind(deal_subfolder)
        .bind(deal_number)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Observation fetch failed: {}", e))?;

        // Walk to the final §5 status. Empty → not_attempted.
        let mut last_error_date: Option<DateTime<Utc>> = None;
        let mut final_status: &str = "not_attempted";
        let mut last_observation_at: Option<String> = None;
        for obs in &observations {
            let obs_ts = parse_timestamp(&obs.timestamp);
            final_status = derive_obs_status_v2(obs, obs_ts, &mut last_error_date);
            last_observation_at = Some(obs.timestamp.clone());
        }

        upsert_assignment_board_status(
            pool,
            user_id,
            assignment_id,
            deal_subfolder,
            *deal_number,
            final_status,
            last_observation_at.as_deref(),
        )
        .await?;
    }

    Ok(())
}

async fn upsert_assignment_board_status(
    pool: &Pool<Sqlite>,
    user_id: &str,
    assignment_id: &str,
    deal_subfolder: &str,
    deal_number: i32,
    status: &str,
    last_observation_at: Option<&str>,
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        r#"
        INSERT INTO assignment_board_status (
            user_id, assignment_id, deal_subfolder, deal_number,
            status, last_observation_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, assignment_id, deal_subfolder, deal_number) DO UPDATE SET
            status              = excluded.status,
            last_observation_at = excluded.last_observation_at,
            updated_at          = excluded.updated_at
        "#,
    )
    .bind(user_id)
    .bind(assignment_id)
    .bind(deal_subfolder)
    .bind(deal_number)
    .bind(status)
    .bind(last_observation_at)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| format!("assignment_board_status upsert failed: {}", e))?;
    Ok(())
}

/// Returns true if no observation other than the one at `current_index`
/// falls in the half-open window `[current_ts - spacing, current_ts)`.
fn is_board_cold(
    observations: &[ObservationFullRow],
    current_index: usize,
    current_ts: Option<DateTime<Utc>>,
) -> bool {
    let cur = match current_ts {
        Some(t) => t,
        None => return true,
    };
    let window_start = cur - chrono::Duration::days(ACHIEVEMENT_SPACING_DAYS);
    for (i, other) in observations.iter().enumerate() {
        if i == current_index {
            continue;
        }
        if let Some(other_ts) = parse_timestamp(&other.timestamp) {
            if other_ts >= window_start && other_ts < cur {
                return false;
            }
        }
    }
    true
}

#[allow(clippy::too_many_arguments)]
async fn upsert_board_status_v2(
    pool: &Pool<Sqlite>,
    user_id: &str,
    deal_subfolder: &str,
    deal_number: i32,
    status: &str,
    wilderness: &str,
    last_error_date: Option<String>,
    star_count: i64,
    max_stars: i64,
    last_star_update: Option<String>,
    wild_achievement: Option<String>,
    last_observation_at: Option<&str>,
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    // The legacy `achievement` column is no longer used; we always
    // write 'none' to satisfy its NOT NULL constraint.
    sqlx::query(
        r#"
        INSERT INTO board_status (
            user_id, deal_subfolder, deal_number,
            status, wilderness, last_error_date,
            star_count, max_stars, last_star_update, wild_achievement,
            last_observation_at, updated_at, achievement
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none')
        ON CONFLICT(user_id, deal_subfolder, deal_number) DO UPDATE SET
            status              = excluded.status,
            wilderness          = excluded.wilderness,
            last_error_date     = excluded.last_error_date,
            star_count          = excluded.star_count,
            max_stars           = max(board_status.max_stars, excluded.max_stars),
            last_star_update    = excluded.last_star_update,
            wild_achievement    = excluded.wild_achievement,
            last_observation_at = excluded.last_observation_at,
            updated_at          = excluded.updated_at
        "#,
    )
    .bind(user_id)
    .bind(deal_subfolder)
    .bind(deal_number)
    .bind(status)
    .bind(wilderness)
    .bind(&last_error_date)
    .bind(star_count)
    .bind(max_stars)
    .bind(&last_star_update)
    .bind(&wild_achievement)
    .bind(last_observation_at)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| format!("Upsert failed: {}", e))?;

    Ok(())
}

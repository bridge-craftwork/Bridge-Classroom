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

/// Per-board active-time ceiling (15 min). A defensive backstop for the
/// assignment-duration rollup: new observations are already per-prompt idle-capped
/// on the client (PER_PROMPT_CAP_MS = 120s in observationSchema.js), and the
/// historical backfill recomputes `time_taken_ms` the same way — this clamp only
/// bites rows we couldn't clean (no data-consent / decrypt failures).
const PER_BOARD_CAP_MS: i64 = 900_000;

/// Per-prompt (per-measurement) idle ceiling (2 min). Mirrors
/// PER_PROMPT_CAP_MS in observationSchema.js. Used by the historical
/// `time_taken_ms` backfill to re-cap each prompt from the decrypted blob.
pub const PER_PROMPT_CAP_MS: i64 = 120_000;

/// Clamp one observation's active time to the per-board ceiling. `None`
/// (unknown time) contributes 0.
fn capped_ms(time_taken_ms: Option<i64>) -> i64 {
    time_taken_ms.unwrap_or(0).clamp(0, PER_BOARD_CAP_MS)
}

// ---- Models ----

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct BoardStatusEntry {
    pub collection_id: String,
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
    /// True when this board was played while not-ready (beta). The board still
    /// appears for navigation/drill-down; the UI marks it distinctly (triangle)
    /// and excludes it from mastery counts.
    pub prerelease: bool,
}

#[derive(Debug, Serialize)]
pub struct BoardStatusResponse {
    pub boards: Vec<BoardStatusEntry>,
}

#[derive(Debug, Deserialize)]
pub struct BoardStatusQuery {
    pub user_id: String,
    pub deal_subfolder: Option<String>,
    /// Optional collection scope. When present, only rows for this collection
    /// are returned. Omitted → all collections (legacy behavior). Callers that
    /// know the active collection (per-lesson strip/grids) pass it so a
    /// subfolder shared across collections doesn't leak the other's boards.
    pub collection_id: Option<String>,
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
        collection_id, deal_subfolder, deal_number,
        status, wilderness, last_error_date,
        star_count, max_stars, last_star_update,
        wild_achievement, last_observation_at, prerelease
    "#;

    // Build the WHERE clause + ORDER BY dynamically over two optional filters
    // (deal_subfolder, collection_id). Binds are pushed in the same order the
    // placeholders are appended. The (user_id, collection_id, deal_subfolder)
    // prefix of the PK indexes every combination.
    let mut sql = format!(
        "SELECT {} FROM board_status WHERE user_id = ?",
        select_columns
    );
    if query.deal_subfolder.is_some() {
        sql.push_str(" AND deal_subfolder = ?");
    }
    if query.collection_id.is_some() {
        sql.push_str(" AND collection_id = ?");
    }
    // When scoped to a single subfolder the deal_subfolder ORDER is redundant.
    if query.deal_subfolder.is_some() {
        sql.push_str(" ORDER BY deal_number ASC");
    } else {
        sql.push_str(" ORDER BY deal_subfolder ASC, deal_number ASC");
    }

    let mut q = sqlx::query_as::<_, BoardStatusEntry>(&sql).bind(&query.user_id);
    if let Some(ref subfolder) = query.deal_subfolder {
        q = q.bind(subfolder);
    }
    if let Some(ref collection_id) = query.collection_id {
        q = q.bind(collection_id);
    }

    let entries: Vec<BoardStatusEntry> = q
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

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
    /// The student's board-level mastery for this board, from the global
    /// `board_status` rollup (max_stars ≥1 = silver, ≥2 = gold;
    /// wild_achievement = 'Fresh'/'Recent'). Wild masteries are only earned in
    /// assignments, so these surface the assignment's paws/stars without a
    /// separate rollup or any observation query.
    pub max_stars: Option<i64>,
    pub wild_achievement: Option<String>,
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
        SELECT abs.deal_subfolder, abs.deal_number, abs.status, abs.last_observation_at,
               bs.max_stars        AS max_stars,
               bs.wild_achievement AS wild_achievement
        FROM assignment_board_status abs
        LEFT JOIN board_status bs
          ON bs.user_id        = abs.user_id
         AND bs.collection_id  = abs.collection_id
         AND bs.deal_subfolder = abs.deal_subfolder
         AND bs.deal_number    = abs.deal_number
        WHERE abs.user_id = ? AND abs.assignment_id = ?
        ORDER BY abs.deal_subfolder ASC, abs.deal_number ASC
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
        sqlx::query_scalar::<_, String>(r#"SELECT exercise_id FROM assignments WHERE id = ?"#)
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
            if ratio < 0.25 {
                "Wild".to_string()
            } else {
                "Tame".to_string()
            }
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
    prerelease: bool,
    time_taken_ms: Option<i64>,
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
    collection_id: &str,
    deal_subfolder: &str,
    deal_number: i32,
) -> Result<(), String> {
    let observations: Vec<ObservationFullRow> = sqlx::query_as(
        r#"
        SELECT id, timestamp, correct, board_result, wilderness, prerelease, time_taken_ms
        FROM observations
        WHERE user_id = ? AND collection_id = ? AND deal_subfolder = ? AND deal_number = ?
        ORDER BY timestamp ASC
        "#,
    )
    .bind(user_id)
    .bind(collection_id)
    .bind(deal_subfolder)
    .bind(deal_number)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Observation fetch failed: {}", e))?;

    if observations.is_empty() {
        upsert_board_status_v2(
            pool,
            user_id,
            collection_id,
            deal_subfolder,
            deal_number,
            "not_attempted",
            "Tame",
            None,
            0,
            0,
            None,
            None,
            None,
            false,
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
    // The board's prerelease state = its most recent observation's flag (so a
    // beta board later released, and replayed, stops being excluded).
    let mut final_prerelease = false;

    // §C8: apply the per-observation status/wilderness rewrites in a single
    // transaction. Previously each row was UPDATEd independently against the
    // pool, so an error partway through left observations.status inconsistent
    // with the derived history until the next sync happened to fix it.
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("begin recompute tx failed: {}", e))?;

    for (i, obs) in observations.iter().enumerate() {
        let obs_ts = parse_timestamp(&obs.timestamp);
        let wilderness = obs
            .wilderness
            .clone()
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
                (Some(lsu), Some(cur)) if (cur - lsu).num_days() >= ACHIEVEMENT_SPACING_DAYS => {
                    star_count += 1;
                    last_star_update = Some(cur);
                    if star_count > max_stars {
                        max_stars = star_count;
                    }
                }
                _ => {} // timestamps unparseable; skip
            }
        }
        // close_correct and wild failed/corrected: no star change.

        // Wild achievement transitions (§7.2).
        if obs_status == "clean_correct" && !is_tame && wild_achievement.as_deref() != Some("Fresh")
        {
            let cold = is_board_cold(&observations, i, obs_ts);
            if cold {
                wild_achievement = Some("Fresh".to_string());
            } else if wild_achievement.is_none() {
                wild_achievement = Some("Recent".to_string());
            }
        }

        // Write the per-observation fields.
        sqlx::query(r#"UPDATE observations SET status = ?, wilderness = ? WHERE id = ?"#)
            .bind(obs_status)
            .bind(&wilderness)
            .bind(&obs.id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Observation update failed: {}", e))?;

        final_status = obs_status.to_string();
        final_wilderness = wilderness;
        final_timestamp = obs.timestamp.clone();
        final_prerelease = obs.prerelease;
    }

    tx.commit()
        .await
        .map_err(|e| format!("commit recompute tx failed: {}", e))?;

    upsert_board_status_v2(
        pool,
        user_id,
        collection_id,
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
        final_prerelease,
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
            if within_cooldown {
                "close_correct"
            } else {
                "clean_correct"
            }
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

    let boards: Vec<(String, String, i32)> = sqlx::query_as(
        "SELECT collection_id, deal_subfolder, deal_number FROM exercise_boards WHERE exercise_id = ?",
    )
    .bind(&exercise_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Exercise board fetch failed: {}", e))?;

    for (collection_id, deal_subfolder, deal_number) in &boards {
        let observations: Vec<ObservationFullRow> = sqlx::query_as(
            r#"
            SELECT id, timestamp, correct, board_result, wilderness, prerelease, time_taken_ms
            FROM observations
            WHERE user_id = ? AND assignment_id = ?
              AND collection_id = ? AND deal_subfolder = ? AND deal_number = ?
            ORDER BY timestamp ASC
            "#,
        )
        .bind(user_id)
        .bind(assignment_id)
        .bind(collection_id)
        .bind(deal_subfolder)
        .bind(deal_number)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Observation fetch failed: {}", e))?;

        // Walk to the final §5 status. Empty → not_attempted. `observations`
        // is ordered oldest-first, so the first row is the first attempt.
        // Active-time rollup (idle-capped): first_pass = the first attempt's
        // time; total = sum across all attempts/replays. Left as NULL when the
        // board was never attempted so the panel can distinguish "no data".
        let mut last_error_date: Option<DateTime<Utc>> = None;
        let mut final_status: &str = "not_attempted";
        // The FIRST attempt's §5 status — retained so the teacher view can flag a
        // board the student originally stumbled on, even after a later clean redo
        // (>1h) resets `final_status` to clean_correct. The student's own view keys
        // off `final_status` (all-green = as good as they can make it); `initial_status`
        // is teacher-only forensics. Can't be close_correct (no prior error at i=0) →
        // one of clean_correct / corrected / failed / not_attempted.
        let mut initial_status: &str = "not_attempted";
        let mut last_observation_at: Option<String> = None;
        let mut first_pass_ms: Option<i64> = None;
        let mut total_ms: Option<i64> = None;
        for (i, obs) in observations.iter().enumerate() {
            let obs_ts = parse_timestamp(&obs.timestamp);
            let s = derive_obs_status_v2(obs, obs_ts, &mut last_error_date);
            final_status = s;
            last_observation_at = Some(obs.timestamp.clone());
            let ms = capped_ms(obs.time_taken_ms);
            if i == 0 {
                first_pass_ms = Some(ms);
                initial_status = s;
            }
            total_ms = Some(total_ms.unwrap_or(0) + ms);
        }

        upsert_assignment_board_status(
            pool,
            user_id,
            assignment_id,
            collection_id,
            deal_subfolder,
            *deal_number,
            final_status,
            initial_status,
            last_observation_at.as_deref(),
            first_pass_ms,
            total_ms,
        )
        .await?;
    }

    Ok(())
}

// One parameter per column of the upsert; bundling them into a struct would
// just move the same list somewhere else.
#[allow(clippy::too_many_arguments)]
async fn upsert_assignment_board_status(
    pool: &Pool<Sqlite>,
    user_id: &str,
    assignment_id: &str,
    collection_id: &str,
    deal_subfolder: &str,
    deal_number: i32,
    status: &str,
    initial_status: &str,
    last_observation_at: Option<&str>,
    first_pass_ms: Option<i64>,
    total_ms: Option<i64>,
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        r#"
        INSERT INTO assignment_board_status (
            user_id, assignment_id, collection_id, deal_subfolder, deal_number,
            status, initial_status, last_observation_at, updated_at, first_pass_ms, total_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, assignment_id, collection_id, deal_subfolder, deal_number) DO UPDATE SET
            status              = excluded.status,
            initial_status      = excluded.initial_status,
            last_observation_at = excluded.last_observation_at,
            updated_at          = excluded.updated_at,
            first_pass_ms       = excluded.first_pass_ms,
            total_ms            = excluded.total_ms
        "#,
    )
    .bind(user_id)
    .bind(assignment_id)
    .bind(collection_id)
    .bind(deal_subfolder)
    .bind(deal_number)
    .bind(status)
    .bind(initial_status)
    .bind(last_observation_at)
    .bind(&now)
    .bind(first_pass_ms)
    .bind(total_ms)
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
    collection_id: &str,
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
    prerelease: bool,
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    // The legacy `achievement` column is no longer used; we always
    // write 'none' to satisfy its NOT NULL constraint.
    sqlx::query(
        r#"
        INSERT INTO board_status (
            user_id, collection_id, deal_subfolder, deal_number,
            status, wilderness, last_error_date,
            star_count, max_stars, last_star_update, wild_achievement,
            last_observation_at, updated_at, achievement, prerelease
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', ?)
        ON CONFLICT(user_id, collection_id, deal_subfolder, deal_number) DO UPDATE SET
            status              = excluded.status,
            wilderness          = excluded.wilderness,
            last_error_date     = excluded.last_error_date,
            star_count          = excluded.star_count,
            max_stars           = max(board_status.max_stars, excluded.max_stars),
            last_star_update    = excluded.last_star_update,
            wild_achievement    = excluded.wild_achievement,
            last_observation_at = excluded.last_observation_at,
            updated_at          = excluded.updated_at,
            prerelease          = excluded.prerelease
        "#,
    )
    .bind(user_id)
    .bind(collection_id)
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
    .bind(prerelease)
    .execute(pool)
    .await
    .map_err(|e| format!("Upsert failed: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::SqlitePool;

    /// Minimal schema for exercising `recompute_assignment_boards`: just the four
    /// tables it reads/writes, with only the columns the recompute touches.
    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        for ddl in [
            "CREATE TABLE assignments (id TEXT PRIMARY KEY, exercise_id TEXT NOT NULL)",
            "CREATE TABLE exercise_boards (exercise_id TEXT NOT NULL, collection_id TEXT NOT NULL, \
                deal_subfolder TEXT NOT NULL, deal_number INTEGER NOT NULL)",
            "CREATE TABLE observations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, \
                assignment_id TEXT, collection_id TEXT NOT NULL, deal_subfolder TEXT NOT NULL, \
                deal_number INTEGER NOT NULL, timestamp TEXT NOT NULL, correct INTEGER NOT NULL, \
                board_result TEXT, wilderness TEXT, prerelease INTEGER NOT NULL DEFAULT 0, \
                time_taken_ms INTEGER)",
            "CREATE TABLE assignment_board_status (user_id TEXT NOT NULL, assignment_id TEXT NOT NULL, \
                collection_id TEXT NOT NULL DEFAULT 'baker-bridge', deal_subfolder TEXT NOT NULL, \
                deal_number INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'not_attempted', \
                initial_status TEXT NOT NULL DEFAULT 'not_attempted', last_observation_at TEXT, \
                updated_at TEXT NOT NULL, first_pass_ms INTEGER, total_ms INTEGER, \
                PRIMARY KEY (user_id, assignment_id, collection_id, deal_subfolder, deal_number))",
        ] {
            sqlx::query(ddl).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO assignments (id, exercise_id) VALUES ('a1', 'ex1')")
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    async fn add_board(pool: &SqlitePool, subfolder: &str, num: i32) {
        sqlx::query(
            "INSERT INTO exercise_boards (exercise_id, collection_id, deal_subfolder, deal_number) \
             VALUES ('ex1', 'baker-bridge', ?, ?)",
        )
        .bind(subfolder)
        .bind(num)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn add_obs(
        pool: &SqlitePool,
        id: &str,
        subfolder: &str,
        num: i32,
        ts: &str,
        result: &str,
    ) {
        let correct = if result == "failed" { 0 } else { 1 };
        sqlx::query(
            "INSERT INTO observations (id, user_id, assignment_id, collection_id, deal_subfolder, \
             deal_number, timestamp, correct, board_result, wilderness, prerelease, time_taken_ms) \
             VALUES (?, 'u1', 'a1', 'baker-bridge', ?, ?, ?, ?, ?, 'Tame', 0, 1000)",
        )
        .bind(id)
        .bind(subfolder)
        .bind(num)
        .bind(ts)
        .bind(correct)
        .bind(result)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn read_status(pool: &SqlitePool, subfolder: &str, num: i32) -> (String, String) {
        sqlx::query_as(
            "SELECT status, initial_status FROM assignment_board_status \
             WHERE user_id='u1' AND assignment_id='a1' AND deal_subfolder=? AND deal_number=?",
        )
        .bind(subfolder)
        .bind(num)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    // The report that motivated this: a board first CORRECTED, then cleanly
    // redone >1h later. `status` follows the cooldown → clean_correct (student
    // sees green), but `initial_status` retains the first-attempt stumble so the
    // teacher grid can mark it.
    #[tokio::test]
    async fn initial_status_retains_first_stumble_after_late_clean_redo() {
        let pool = setup_pool().await;
        add_board(&pool, "NMF", 7).await;
        add_obs(&pool, "o1", "NMF", 7, "2026-07-27T01:39:48Z", "corrected").await;
        add_obs(&pool, "o2", "NMF", 7, "2026-07-27T16:27:30Z", "correct").await; // ~14h later

        recompute_assignment_boards(&pool, "u1", "a1")
            .await
            .unwrap();

        let (status, initial) = read_status(&pool, "NMF", 7).await;
        assert_eq!(status, "clean_correct"); // >1h gap → student sees green
        assert_eq!(initial, "corrected"); // teacher still sees the original stumble
    }

    #[tokio::test]
    async fn initial_status_matches_status_for_clean_first_try() {
        let pool = setup_pool().await;
        add_board(&pool, "NMF", 6).await;
        add_obs(&pool, "o1", "NMF", 6, "2026-07-27T01:33:14Z", "correct").await;

        recompute_assignment_boards(&pool, "u1", "a1")
            .await
            .unwrap();

        let (status, initial) = read_status(&pool, "NMF", 6).await;
        assert_eq!(status, "clean_correct");
        assert_eq!(initial, "clean_correct"); // nailed first try → no stumble marker
    }

    // A redo WITHIN the hour already surfaces as close_correct (orange) today;
    // initial_status agrees, and status stays orange — no regression.
    #[tokio::test]
    async fn within_cooldown_redo_stays_close_correct() {
        let pool = setup_pool().await;
        add_board(&pool, "NMF", 8).await;
        add_obs(&pool, "o1", "NMF", 8, "2026-07-27T01:39:48Z", "corrected").await;
        add_obs(&pool, "o2", "NMF", 8, "2026-07-27T01:49:48Z", "correct").await; // 10 min later

        recompute_assignment_boards(&pool, "u1", "a1")
            .await
            .unwrap();

        let (status, initial) = read_status(&pool, "NMF", 8).await;
        assert_eq!(status, "close_correct");
        assert_eq!(initial, "corrected");
    }

    // A board in the exercise the student never touched → not_attempted for both.
    #[tokio::test]
    async fn untouched_board_is_not_attempted() {
        let pool = setup_pool().await;
        add_board(&pool, "NMF", 9).await;

        recompute_assignment_boards(&pool, "u1", "a1")
            .await
            .unwrap();

        let (status, initial) = read_status(&pool, "NMF", 9).await;
        assert_eq!(status, "not_attempted");
        assert_eq!(initial, "not_attempted");
    }
}

//! Bulk read endpoint for the `student_summary` table.
//!
//! Used by the teacher roster view to render one row per student
//! without fetching observations across many students. See
//! `documentation/CORRECTNESS_AND_MASTERY.md` §14 (query patterns).

use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct StudentSummariesQuery {
    /// Comma-separated list of user_ids.
    pub user_ids: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct StudentSummaryRow {
    pub user_id: String,
    pub last_observation_at: Option<String>,
    pub total_observations: i64,
    pub distinct_lessons: i64,
    pub distinct_boards_seen: i64,
    pub boards_not_attempted: i64,
    pub boards_failed: i64,
    pub boards_corrected: i64,
    pub boards_close_correct: i64,
    pub boards_clean_correct: i64,
    pub boards_silver: i64,
    pub boards_gold: i64,
    pub on_star_track: i64,
    pub boards_recent_paw: i64,
    pub boards_fresh_paw: i64,
    pub lessons_exploring: i64,
    pub lessons_learning: i64,
    pub lessons_retaining: i64,
    pub lessons_mastering: i64,
    pub updated_at: String,
}

/// One recently-practiced lesson, with a server-computed release status so the
/// GUI can badge it without inspecting individual boards (ADR-0001).
#[derive(Debug, Serialize)]
pub struct RecentLesson {
    pub subfolder: String,
    /// `released` (no prerelease boards played), `beta` (all prerelease), or
    /// `mixed` — derived from the student's `board_status` rows for this lesson.
    pub status: String,
}

#[derive(Debug, Serialize)]
pub struct StudentSummaryEntry {
    #[serde(flatten)]
    pub summary: StudentSummaryRow,
    /// Top N most-recently-practiced lessons (by last_observation_at
    /// across the user's `board_status` rows). Up to 3 entries.
    pub recent_lessons: Vec<RecentLesson>,
}

#[derive(Debug, Serialize)]
pub struct StudentSummariesResponse {
    pub summaries: Vec<StudentSummaryEntry>,
}

fn validate_api_key(headers: &HeaderMap, expected_key: &str) -> bool {
    headers
        .get("x-api-key")
        .and_then(|v| v.to_str().ok())
        .map(|k| k == expected_key)
        .unwrap_or(false)
}

/// GET /api/student-summaries?user_ids=a,b,c
///
/// Returns one entry per requested user_id, drawn from the
/// `student_summary` cache plus the top-3 most-recently-practiced
/// lessons derived from `board_status`. Missing user_ids (no summary
/// row yet — e.g. a fresh student with no observations) are silently
/// omitted from the response; callers should fall back to defaults.
pub async fn get_student_summaries(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<StudentSummariesQuery>,
) -> Result<Json<StudentSummariesResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let user_ids: Vec<&str> = query
        .user_ids
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    if user_ids.is_empty() {
        return Ok(Json(StudentSummariesResponse { summaries: vec![] }));
    }

    // Build a parameterised IN clause for the summary fetch.
    let placeholders = vec!["?"; user_ids.len()].join(",");
    let summary_sql = format!(
        "SELECT * FROM student_summary WHERE user_id IN ({})",
        placeholders
    );

    let mut summary_q = sqlx::query_as::<_, StudentSummaryRow>(&summary_sql);
    for uid in &user_ids {
        summary_q = summary_q.bind(*uid);
    }
    let summaries: Vec<StudentSummaryRow> = summary_q
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Recent lessons: pull all (user_id, deal_subfolder, last_observation_at)
    // tuples for the requested users in one query, then trim to top 3
    // per user in Rust. Cheap at our scale.
    // Per (user, lesson): most recent activity, plus a prerelease tally so we can
    // label the lesson released / beta / mixed without the GUI touching boards.
    let lessons_sql = format!(
        "SELECT user_id, deal_subfolder, MAX(last_observation_at) AS last_obs, \
                SUM(prerelease) AS beta_boards, COUNT(*) AS total_boards \
         FROM board_status \
         WHERE user_id IN ({}) AND last_observation_at IS NOT NULL \
         GROUP BY user_id, deal_subfolder \
         ORDER BY last_obs DESC",
        placeholders
    );
    let mut lessons_q = sqlx::query_as::<_, (String, String, String, i64, i64)>(&lessons_sql);
    for uid in &user_ids {
        lessons_q = lessons_q.bind(*uid);
    }
    let lesson_rows: Vec<(String, String, String, i64, i64)> = lessons_q
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut recent_by_user: HashMap<String, Vec<RecentLesson>> = HashMap::new();
    for (uid, subfolder, _last_obs, beta_boards, total_boards) in lesson_rows {
        let entry = recent_by_user.entry(uid).or_default();
        if entry.len() < 3 {
            let status = if beta_boards == 0 {
                "released"
            } else if beta_boards >= total_boards {
                "beta"
            } else {
                "mixed"
            };
            entry.push(RecentLesson {
                subfolder,
                status: status.to_string(),
            });
        }
    }

    let entries: Vec<StudentSummaryEntry> = summaries
        .into_iter()
        .map(|s| {
            let recent = recent_by_user.remove(&s.user_id).unwrap_or_default();
            StudentSummaryEntry {
                summary: s,
                recent_lessons: recent,
            }
        })
        .collect();

    Ok(Json(StudentSummariesResponse { summaries: entries }))
}

//! Per-lesson mastery tier endpoint.
//!
//! Implements `documentation/CORRECTNESS_AND_MASTERY.md` §13. The tier
//! is derived on demand (not stored — see §13.3) from `board_status`
//! and the global lesson catalog (boards seen across all users).
//!
//! Returned tiers:
//!   - "Exploring" — user has at least one observation in this lesson
//!   - "Learning"  — ≥50% of the lesson's boards have max_stars ≥ 1
//!   - "Retaining" — ≥80% of the lesson's boards have max_stars ≥ 2
//!   - "Mastering" — ≥80% have (max_stars ≥ 2 OR wild_achievement='Fresh')
//!                   AND ≥25% have wild_achievement='Fresh'
//!
//! A lesson can only be in one tier; we return the highest the user
//! qualifies for. Lessons the user has never touched are omitted.

use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct LessonMasteryQuery {
    pub user_id: String,
}

#[derive(Debug, Serialize)]
pub struct LessonMasteryEntry {
    /// Collection this lesson belongs to. Two collections may reuse the same
    /// `deal_subfolder` name; grouping/keying by (collection_id, deal_subfolder)
    /// keeps their tiers separate. Consumers still key by subfolder today (no
    /// user straddles collections), but the field is returned so they can move
    /// to the composite key without a further backend change.
    pub collection_id: String,
    pub deal_subfolder: String,
    pub tier: String,
    /// Total boards declared in the lesson (i.e. distinct boards seen
    /// in this `deal_subfolder` across all users — the denominator).
    pub total_boards: i64,
    /// Boards the user has attempted in this lesson.
    pub attempted_boards: i64,
    /// Boards with max_stars ≥ 1 (silver-or-better).
    pub silver_or_better: i64,
    /// Boards with max_stars ≥ 2 (gold).
    pub gold: i64,
    /// Boards with wild_achievement = 'Fresh'.
    pub fresh_paw: i64,
    /// Boards qualifying for the Mastering "deep" criterion
    /// (max_stars ≥ 2 OR wild_achievement = 'Fresh').
    pub deep: i64,
}

#[derive(Debug, Serialize)]
pub struct LessonMasteryResponse {
    pub lessons: Vec<LessonMasteryEntry>,
}

#[derive(Debug, sqlx::FromRow)]
struct LessonStatsRow {
    collection_id: String,
    deal_subfolder: String,
    total_boards: i64,
    attempted_boards: i64,
    silver_or_better: i64,
    gold: i64,
    fresh_paw: i64,
    deep: i64,
}

fn validate_api_key(headers: &HeaderMap, expected_key: &str) -> bool {
    headers
        .get("x-api-key")
        .and_then(|v| v.to_str().ok())
        .map(|k| k == expected_key)
        .unwrap_or(false)
}

/// Decide the tier for a lesson given the user's stats. Returns a
/// lowercase-Title-Case string ("Exploring" / "Learning" / "Retaining"
/// / "Mastering"). Callers should not invoke this for lessons with
/// zero observations; that case is `None` and we filter it out before
/// returning.
fn decide_tier(row: &LessonStatsRow) -> &'static str {
    if row.total_boards == 0 || row.attempted_boards == 0 {
        return "Exploring"; // defensive — shouldn't be called in this case
    }
    let total = row.total_boards as f64;

    let deep_frac = row.deep as f64 / total;
    let fresh_frac = row.fresh_paw as f64 / total;
    if deep_frac >= 0.80 && fresh_frac >= 0.25 {
        return "Mastering";
    }

    let gold_frac = row.gold as f64 / total;
    if gold_frac >= 0.80 {
        return "Retaining";
    }

    let silver_or_better_frac = row.silver_or_better as f64 / total;
    if silver_or_better_frac >= 0.50 {
        return "Learning";
    }

    "Exploring"
}

/// GET /api/lesson-mastery?user_id=X
///
/// Returns a tier per lesson the user has touched, ordered by lesson
/// subfolder. The "boards in lesson" denominator is the count of
/// distinct deal_numbers seen for that subfolder across ALL users
/// (i.e. the lesson catalog grows lazily as boards are encountered).
pub async fn get_lesson_mastery(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<LessonMasteryQuery>,
) -> Result<Json<LessonMasteryResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    // Group by (collection_id, deal_subfolder) so a subfolder name reused
    // across collections keeps a separate denominator and tier per collection.
    // For today's data (no user straddles collections, each subfolder maps to
    // exactly one collection) this yields the same groups as keying by
    // subfolder alone — it only diverges once a real collision exists.
    let rows: Vec<LessonStatsRow> = sqlx::query_as(
        r#"
        WITH lesson_totals AS (
            SELECT collection_id, deal_subfolder, COUNT(DISTINCT deal_number) AS total_boards
            FROM board_status
            WHERE deal_subfolder IS NOT NULL AND prerelease = 0
            GROUP BY collection_id, deal_subfolder
        )
        SELECT
            bs.collection_id                                                          AS collection_id,
            bs.deal_subfolder                                                         AS deal_subfolder,
            lt.total_boards                                                           AS total_boards,
            COUNT(*)                                                                  AS attempted_boards,
            SUM(CASE WHEN bs.max_stars >= 1 THEN 1 ELSE 0 END)                        AS silver_or_better,
            SUM(CASE WHEN bs.max_stars >= 2 THEN 1 ELSE 0 END)                        AS gold,
            SUM(CASE WHEN bs.wild_achievement = 'Fresh' THEN 1 ELSE 0 END)            AS fresh_paw,
            SUM(CASE WHEN bs.max_stars >= 2 OR bs.wild_achievement = 'Fresh' THEN 1 ELSE 0 END) AS deep
        FROM board_status bs
        JOIN lesson_totals lt
          ON lt.collection_id = bs.collection_id AND lt.deal_subfolder = bs.deal_subfolder
        WHERE bs.user_id = ? AND bs.prerelease = 0
        GROUP BY bs.collection_id, bs.deal_subfolder, lt.total_boards
        ORDER BY bs.deal_subfolder
        "#,
    )
    .bind(&query.user_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let lessons: Vec<LessonMasteryEntry> = rows
        .into_iter()
        .filter(|r| r.attempted_boards > 0)
        .map(|r| {
            let tier = decide_tier(&r).to_string();
            LessonMasteryEntry {
                collection_id: r.collection_id,
                deal_subfolder: r.deal_subfolder,
                tier,
                total_boards: r.total_boards,
                attempted_boards: r.attempted_boards,
                silver_or_better: r.silver_or_better,
                gold: r.gold,
                fresh_paw: r.fresh_paw,
                deep: r.deep,
            }
        })
        .collect();

    Ok(Json(LessonMasteryResponse { lessons }))
}

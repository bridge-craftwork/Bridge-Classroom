//! Per-student rollup table used by the teacher dashboard.
//!
//! See `documentation/CORRECTNESS_AND_MASTERY.md` §14.2. The table is
//! a cache, not a source of truth: rebuildable at any time from
//! `board_status` and `observations`. The functions here perform that
//! rebuild for a single user; callers (the v2 backfill, and eventually
//! `submit_observations`) decide when to invoke.

use sqlx::{Pool, Sqlite};

/// Rebuild the `student_summary` row for the given user from scratch.
/// Upserts on conflict. Idempotent.
pub async fn recompute_student_summary(pool: &Pool<Sqlite>, user_id: &str) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();

    // ---- Top-line counts from observations ----
    let (total_obs, last_obs_at, distinct_lessons, distinct_boards): (
        i64,
        Option<String>,
        i64,
        i64,
    ) = sqlx::query_as(
        r#"
            SELECT
                COUNT(*),
                MAX(timestamp),
                COUNT(DISTINCT deal_subfolder),
                COUNT(DISTINCT deal_subfolder || '/' || deal_number)
            FROM observations
            WHERE user_id = ?
            "#,
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Observations aggregation failed: {}", e))?;

    // ---- Board-state distribution from board_status ----
    let status_counts: Vec<(String, i64)> = sqlx::query_as(
        r#"
        SELECT status, COUNT(*)
        FROM board_status
        WHERE user_id = ? AND prerelease = 0
        GROUP BY status
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Status counts failed: {}", e))?;

    let count = |status: &str| -> i64 {
        status_counts
            .iter()
            .find(|(s, _)| s == status)
            .map(|(_, c)| *c)
            .unwrap_or(0)
    };
    let boards_not_attempted = count("not_attempted");
    let boards_failed = count("failed");
    let boards_corrected = count("corrected");
    let boards_close_correct = count("close_correct");
    let boards_clean_correct = count("clean_correct");

    // ---- Star achievement distribution (uses max_stars; see §6.4) ----
    // max_stars = 1 → silver badge, max_stars >= 2 → gold badge.
    let boards_silver: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM board_status WHERE user_id = ? AND max_stars = 1 AND prerelease = 0"#,
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let boards_gold: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM board_status WHERE user_id = ? AND max_stars >= 2 AND prerelease = 0"#,
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let on_star_track: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM board_status WHERE user_id = ? AND (max_stars > 0 OR last_star_update IS NOT NULL) AND prerelease = 0"#,
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    // ---- Paw achievement distribution ----
    let boards_recent_paw: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM board_status WHERE user_id = ? AND wild_achievement = 'Recent' AND prerelease = 0"#,
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let boards_fresh_paw: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM board_status WHERE user_id = ? AND wild_achievement = 'Fresh' AND prerelease = 0"#,
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    // ---- Lesson mastery distribution ----
    //
    // CORRECTNESS_AND_MASTERY.md §13 defines lesson mastery in terms of
    // "the lesson's boards" (declared boards, not attempted boards).
    // That requires a backend catalog of which boards belong to which
    // lesson, which lives in the frontend's PBN cache today and is not
    // yet on the server. Leaving all four counts at 0 until that
    // catalog exists; the column is reserved for future use.
    let lessons_exploring: i64 = 0;
    let lessons_learning: i64 = 0;
    let lessons_retaining: i64 = 0;
    let lessons_mastering: i64 = 0;

    sqlx::query(
        r#"
        INSERT INTO student_summary (
            user_id,
            last_observation_at,
            total_observations,
            distinct_lessons,
            distinct_boards_seen,
            boards_not_attempted,
            boards_failed,
            boards_corrected,
            boards_close_correct,
            boards_clean_correct,
            boards_silver,
            boards_gold,
            on_star_track,
            boards_recent_paw,
            boards_fresh_paw,
            lessons_exploring,
            lessons_learning,
            lessons_retaining,
            lessons_mastering,
            updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            last_observation_at  = excluded.last_observation_at,
            total_observations   = excluded.total_observations,
            distinct_lessons     = excluded.distinct_lessons,
            distinct_boards_seen = excluded.distinct_boards_seen,
            boards_not_attempted = excluded.boards_not_attempted,
            boards_failed        = excluded.boards_failed,
            boards_corrected     = excluded.boards_corrected,
            boards_close_correct = excluded.boards_close_correct,
            boards_clean_correct = excluded.boards_clean_correct,
            boards_silver        = excluded.boards_silver,
            boards_gold          = excluded.boards_gold,
            on_star_track        = excluded.on_star_track,
            boards_recent_paw    = excluded.boards_recent_paw,
            boards_fresh_paw     = excluded.boards_fresh_paw,
            lessons_exploring    = excluded.lessons_exploring,
            lessons_learning     = excluded.lessons_learning,
            lessons_retaining    = excluded.lessons_retaining,
            lessons_mastering    = excluded.lessons_mastering,
            updated_at           = excluded.updated_at
        "#,
    )
    .bind(user_id)
    .bind(&last_obs_at)
    .bind(total_obs)
    .bind(distinct_lessons)
    .bind(distinct_boards)
    .bind(boards_not_attempted)
    .bind(boards_failed)
    .bind(boards_corrected)
    .bind(boards_close_correct)
    .bind(boards_clean_correct)
    .bind(boards_silver)
    .bind(boards_gold)
    .bind(on_star_track)
    .bind(boards_recent_paw)
    .bind(boards_fresh_paw)
    .bind(lessons_exploring)
    .bind(lessons_learning)
    .bind(lessons_retaining)
    .bind(lessons_mastering)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| format!("student_summary upsert failed: {}", e))?;

    Ok(())
}

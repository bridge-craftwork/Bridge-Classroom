use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{Pool, Sqlite};
use std::path::Path;
use std::str::FromStr;
use std::time::Duration;

/// Initialize the database connection pool and run migrations
pub async fn init_db(database_url: &str) -> Result<Pool<Sqlite>, DbError> {
    // Ensure data directory exists for SQLite file
    if database_url.starts_with("sqlite:") {
        // Extract the path, handling query parameters
        let path_part = database_url
            .trim_start_matches("sqlite:")
            .split('?')
            .next()
            .unwrap_or("");

        let path = Path::new(path_part);
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() && !parent.exists() {
                tracing::info!("Creating database directory: {:?}", parent);
                std::fs::create_dir_all(parent).map_err(|e| DbError::Init(e.to_string()))?;
            }
        }
    }

    tracing::info!("Connecting to database: {}", database_url);

    // §C8: connect in WAL mode with a real busy timeout. Previously the pool ran
    // in the default rollback-journal (`delete`) mode where writers block readers
    // and vice versa — with the write-heavy observation-sync paths that meant
    // SQLITE_BUSY 500s when two students synced while a teacher loaded the
    // dashboard. WAL lets reads proceed concurrently with a writer; the 10s
    // busy_timeout absorbs brief write contention instead of erroring. (This also
    // brings the runtime in line with the backup docs, which already assume WAL.)
    let options = SqliteConnectOptions::from_str(database_url)
        .map_err(|e| DbError::Connection(e.to_string()))?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(Duration::from_secs(10));

    // Create connection pool
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
        .map_err(|e| DbError::Connection(e.to_string()))?;

    // Run migrations
    run_migrations(&pool).await?;

    Ok(pool)
}

/// Add a column to `table` only if it doesn't already exist.
///
/// `column_def` is the type and constraints, e.g. `"TEXT"` or
/// `"INTEGER NOT NULL DEFAULT 0"`. Caller-supplied — not bound — so do not
/// pass user input here.
async fn add_column_if_missing(
    pool: &Pool<Sqlite>,
    table: &str,
    column: &str,
    column_def: &str,
) -> Result<(), DbError> {
    let exists: bool = sqlx::query_scalar(&format!(
        "SELECT COUNT(*) > 0 FROM pragma_table_info('{}') WHERE name = ?",
        table
    ))
    .bind(column)
    .fetch_one(pool)
    .await
    .unwrap_or(false);

    if !exists {
        let sql = format!("ALTER TABLE {} ADD COLUMN {} {}", table, column, column_def);
        sqlx::query(&sql)
            .execute(pool)
            .await
            .map_err(|e| DbError::Migration(e.to_string()))?;
        tracing::info!("Added column {}.{}", table, column);
    }
    Ok(())
}

/// Run database migrations
async fn run_migrations(pool: &Pool<Sqlite>) -> Result<(), DbError> {
    // Users table - stores student information
    // Note: first_name and last_name are plaintext for teacher queries
    // Secret key is stored client-side only (not on server)
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            classroom TEXT,
            data_consent INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    // Viewers table - teachers, partners, admin who can view student data
    // Each viewer has an RSA keypair for receiving encrypted sharing grants
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS viewers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            public_key TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'teacher',
            created_at TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    // Add recovery_encrypted_private_key column to viewers table if it doesn't exist
    let has_viewer_recovery_column: bool = sqlx::query_scalar(
        r#"SELECT COUNT(*) > 0 FROM pragma_table_info('viewers') WHERE name = 'recovery_encrypted_private_key'"#,
    )
    .fetch_one(pool)
    .await
    .unwrap_or(false);

    if !has_viewer_recovery_column {
        sqlx::query(r#"ALTER TABLE viewers ADD COLUMN recovery_encrypted_private_key TEXT"#)
            .execute(pool)
            .await
            .map_err(|e| DbError::Migration(e.to_string()))?;
    }

    // Sharing grants - links students to viewers
    // encrypted_payload contains student's secret key encrypted with viewer's public key
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS sharing_grants (
            id TEXT PRIMARY KEY,
            grantor_id TEXT NOT NULL,
            grantee_id TEXT NOT NULL,
            encrypted_payload TEXT NOT NULL,
            granted_at TEXT NOT NULL,
            expires_at TEXT,
            revoked INTEGER NOT NULL DEFAULT 0,
            revoked_at TEXT,
            FOREIGN KEY (grantor_id) REFERENCES users(id),
            FOREIGN KEY (grantee_id) REFERENCES viewers(id),
            UNIQUE(grantor_id, grantee_id)
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    // Observations table - encrypted practice data
    // encrypted_data is AES-256-GCM encrypted with student's secret key
    // No key blobs needed - viewers use sharing grants to get the key
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS observations (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            skill_path TEXT NOT NULL,
            correct INTEGER NOT NULL,
            classroom TEXT,
            deal_subfolder TEXT,
            deal_number INTEGER,
            encrypted_data TEXT NOT NULL,
            iv TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    // Create indexes for common queries
    sqlx::query(
        r#"CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)"#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    sqlx::query(
        r#"CREATE INDEX IF NOT EXISTS idx_users_classroom ON users(classroom)"#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    sqlx::query(
        r#"CREATE INDEX IF NOT EXISTS idx_viewers_email ON viewers(email)"#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    sqlx::query(
        r#"CREATE INDEX IF NOT EXISTS idx_grants_grantor ON sharing_grants(grantor_id)"#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    sqlx::query(
        r#"CREATE INDEX IF NOT EXISTS idx_grants_grantee ON sharing_grants(grantee_id)"#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    sqlx::query(
        r#"CREATE INDEX IF NOT EXISTS idx_observations_user_id ON observations(user_id)"#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    sqlx::query(
        r#"CREATE INDEX IF NOT EXISTS idx_observations_classroom ON observations(classroom)"#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    sqlx::query(
        r#"CREATE INDEX IF NOT EXISTS idx_observations_timestamp ON observations(timestamp)"#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    sqlx::query(
        r#"CREATE INDEX IF NOT EXISTS idx_observations_skill_path ON observations(skill_path)"#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    // Recovery tokens table - for email-based account recovery
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS recovery_tokens (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            token_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            used INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    sqlx::query(
        r#"CREATE INDEX IF NOT EXISTS idx_recovery_tokens_user_id ON recovery_tokens(user_id)"#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    // Account-merge handoff: after an admin merges a duplicate account onto a
    // keeper, this row lets the merged-away device switch itself to the keeper
    // on next load. `encrypted_payload` is the keeper identity (incl. keeper's
    // AES key) wrapped under the MERGED-AWAY account's key, so only that device
    // can unwrap it. No FK to users — the merged-away user row gets deleted.
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS account_handoff (
            from_user_id      TEXT PRIMARY KEY,
            encrypted_payload TEXT NOT NULL,
            iv                TEXT NOT NULL,
            created_at        TEXT NOT NULL,
            expires_at        TEXT NOT NULL,
            used              INTEGER NOT NULL DEFAULT 0
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    // Add recovery_encrypted_key column to users table if it doesn't exist
    // SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we check first
    let has_recovery_column: bool = sqlx::query_scalar(
        r#"SELECT COUNT(*) > 0 FROM pragma_table_info('users') WHERE name = 'recovery_encrypted_key'"#,
    )
    .fetch_one(pool)
    .await
    .unwrap_or(false);

    if !has_recovery_column {
        sqlx::query(r#"ALTER TABLE users ADD COLUMN recovery_encrypted_key TEXT"#)
            .execute(pool)
            .await
            .map_err(|e| DbError::Migration(e.to_string()))?;
        tracing::info!("Added recovery_encrypted_key column to users table");
    }

    // Add recovery_code_hash column to recovery_tokens if it doesn't exist
    let has_code_column: bool = sqlx::query_scalar(
        r#"SELECT COUNT(*) > 0 FROM pragma_table_info('recovery_tokens') WHERE name = 'recovery_code_hash'"#,
    )
    .fetch_one(pool)
    .await
    .unwrap_or(false);

    if !has_code_column {
        sqlx::query(r#"ALTER TABLE recovery_tokens ADD COLUMN recovery_code_hash TEXT"#)
            .execute(pool)
            .await
            .map_err(|e| DbError::Migration(e.to_string()))?;
        tracing::info!("Added recovery_code_hash column to recovery_tokens table");
    }

    // Convention cards table - stores card definitions
    // owner_id is NULL for system cards (templates/samples)
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS convention_cards (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            format TEXT NOT NULL DEFAULT 'bridge_classroom',
            owner_id TEXT REFERENCES users(id),
            card_data TEXT NOT NULL,
            visibility TEXT NOT NULL DEFAULT 'private',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    // User-card links - many-to-many relationship between users and convention cards
    // Partners can share a card (multiple users linked to same card)
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS user_convention_cards (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id),
            card_id TEXT NOT NULL REFERENCES convention_cards(id),
            is_primary INTEGER NOT NULL DEFAULT 0,
            label TEXT,
            linked_at TEXT NOT NULL,
            UNIQUE(user_id, card_id)
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    // Indexes for convention cards
    sqlx::query(r#"CREATE INDEX IF NOT EXISTS idx_cards_owner ON convention_cards(owner_id)"#)
        .execute(pool)
        .await
        .map_err(|e| DbError::Migration(e.to_string()))?;

    sqlx::query(
        r#"CREATE INDEX IF NOT EXISTS idx_cards_visibility ON convention_cards(visibility)"#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    sqlx::query(
        r#"CREATE INDEX IF NOT EXISTS idx_user_cards_user ON user_convention_cards(user_id)"#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    sqlx::query(
        r#"CREATE INDEX IF NOT EXISTS idx_user_cards_card ON user_convention_cards(card_id)"#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    // ---- Role column on users table ----
    let has_role_column: bool = sqlx::query_scalar(
        r#"SELECT COUNT(*) > 0 FROM pragma_table_info('users') WHERE name = 'role'"#,
    )
    .fetch_one(pool)
    .await
    .unwrap_or(false);

    if !has_role_column {
        sqlx::query(r#"ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'student'"#)
            .execute(pool)
            .await
            .map_err(|e| DbError::Migration(e.to_string()))?;
        tracing::info!("Added role column to users table");
    }

    let has_teacher_terms_column: bool = sqlx::query_scalar(
        r#"SELECT COUNT(*) > 0 FROM pragma_table_info('users') WHERE name = 'teacher_terms_accepted_at'"#,
    )
    .fetch_one(pool)
    .await
    .unwrap_or(false);

    if !has_teacher_terms_column {
        sqlx::query(r#"ALTER TABLE users ADD COLUMN teacher_terms_accepted_at TEXT"#)
            .execute(pool)
            .await
            .map_err(|e| DbError::Migration(e.to_string()))?;
        tracing::info!("Added teacher_terms_accepted_at column to users table");
    }

    // ---- Dashboard cleared-at columns on users table ----
    let has_attention_cleared: bool = sqlx::query_scalar(
        r#"SELECT COUNT(*) > 0 FROM pragma_table_info('users') WHERE name = 'attention_cleared_at'"#,
    )
    .fetch_one(pool)
    .await
    .unwrap_or(false);

    if !has_attention_cleared {
        sqlx::query(r#"ALTER TABLE users ADD COLUMN attention_cleared_at TEXT"#)
            .execute(pool)
            .await
            .map_err(|e| DbError::Migration(e.to_string()))?;
        tracing::info!("Added attention_cleared_at column to users table");
    }

    let has_activity_cleared: bool = sqlx::query_scalar(
        r#"SELECT COUNT(*) > 0 FROM pragma_table_info('users') WHERE name = 'activity_cleared_at'"#,
    )
    .fetch_one(pool)
    .await
    .unwrap_or(false);

    if !has_activity_cleared {
        sqlx::query(r#"ALTER TABLE users ADD COLUMN activity_cleared_at TEXT"#)
            .execute(pool)
            .await
            .map_err(|e| DbError::Migration(e.to_string()))?;
        tracing::info!("Added activity_cleared_at column to users table");
    }

    // ---- Admin name correction column on users table ----
    let has_name_corrected: bool = sqlx::query_scalar(
        r#"SELECT COUNT(*) > 0 FROM pragma_table_info('users') WHERE name = 'name_corrected_at'"#,
    )
    .fetch_one(pool)
    .await
    .unwrap_or(false);

    if !has_name_corrected {
        sqlx::query(r#"ALTER TABLE users ADD COLUMN name_corrected_at TEXT"#)
            .execute(pool)
            .await
            .map_err(|e| DbError::Migration(e.to_string()))?;
        tracing::info!("Added name_corrected_at column to users table");
    }

    // ---- Exercises table ----
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS exercises (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            created_by TEXT REFERENCES users(id),
            curriculum_path TEXT,
            visibility TEXT NOT NULL DEFAULT 'public',
            created_at TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    sqlx::query(r#"CREATE INDEX IF NOT EXISTS idx_exercises_created_by ON exercises(created_by)"#)
        .execute(pool)
        .await
        .map_err(|e| DbError::Migration(e.to_string()))?;

    sqlx::query(r#"CREATE INDEX IF NOT EXISTS idx_exercises_curriculum ON exercises(curriculum_path)"#)
        .execute(pool)
        .await
        .map_err(|e| DbError::Migration(e.to_string()))?;

    sqlx::query(r#"CREATE INDEX IF NOT EXISTS idx_exercises_visibility ON exercises(visibility)"#)
        .execute(pool)
        .await
        .map_err(|e| DbError::Migration(e.to_string()))?;

    // ---- Exercise boards junction table ----
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS exercise_boards (
            exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
            deal_subfolder TEXT NOT NULL,
            deal_number INTEGER NOT NULL,
            sort_order INTEGER NOT NULL,
            collection_id TEXT,
            PRIMARY KEY (exercise_id, deal_subfolder, deal_number)
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    sqlx::query(r#"CREATE INDEX IF NOT EXISTS idx_exercise_boards_deal ON exercise_boards(deal_subfolder, deal_number)"#)
        .execute(pool)
        .await
        .map_err(|e| DbError::Migration(e.to_string()))?;

    // ---- Classrooms table ----
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS classrooms (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            teacher_id TEXT NOT NULL REFERENCES users(id),
            join_code TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    sqlx::query(r#"CREATE INDEX IF NOT EXISTS idx_classrooms_teacher ON classrooms(teacher_id)"#)
        .execute(pool)
        .await
        .map_err(|e| DbError::Migration(e.to_string()))?;

    sqlx::query(r#"CREATE INDEX IF NOT EXISTS idx_classrooms_join_code ON classrooms(join_code)"#)
        .execute(pool)
        .await
        .map_err(|e| DbError::Migration(e.to_string()))?;

    // ---- Classroom members table ----
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS classroom_members (
            classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
            student_id TEXT NOT NULL REFERENCES users(id),
            joined_at TEXT NOT NULL,
            PRIMARY KEY (classroom_id, student_id)
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    sqlx::query(r#"CREATE INDEX IF NOT EXISTS idx_classroom_members_student ON classroom_members(student_id)"#)
        .execute(pool)
        .await
        .map_err(|e| DbError::Migration(e.to_string()))?;

    // ---- Assignments table ----
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS assignments (
            id TEXT PRIMARY KEY,
            exercise_id TEXT NOT NULL REFERENCES exercises(id),
            classroom_id TEXT REFERENCES classrooms(id),
            student_id TEXT REFERENCES users(id),
            assigned_by TEXT NOT NULL REFERENCES users(id),
            assigned_at TEXT NOT NULL,
            due_at TEXT,
            sort_order INTEGER,
            CHECK (
                (classroom_id IS NOT NULL AND student_id IS NULL) OR
                (classroom_id IS NULL AND student_id IS NOT NULL)
            )
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    sqlx::query(r#"CREATE INDEX IF NOT EXISTS idx_assignments_classroom ON assignments(classroom_id)"#)
        .execute(pool)
        .await
        .map_err(|e| DbError::Migration(e.to_string()))?;

    sqlx::query(r#"CREATE INDEX IF NOT EXISTS idx_assignments_student ON assignments(student_id)"#)
        .execute(pool)
        .await
        .map_err(|e| DbError::Migration(e.to_string()))?;

    sqlx::query(r#"CREATE INDEX IF NOT EXISTS idx_assignments_exercise ON assignments(exercise_id)"#)
        .execute(pool)
        .await
        .map_err(|e| DbError::Migration(e.to_string()))?;

    sqlx::query(r#"CREATE INDEX IF NOT EXISTS idx_assignments_assigned_by ON assignments(assigned_by)"#)
        .execute(pool)
        .await
        .map_err(|e| DbError::Migration(e.to_string()))?;

    // ---- Announcements table ----
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS announcements (
            id TEXT PRIMARY KEY,
            message TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'info',
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT,
            active INTEGER NOT NULL DEFAULT 1
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    // ---- Compound index on observations for assignment progress queries ----
    sqlx::query(r#"CREATE INDEX IF NOT EXISTS idx_observations_deal_user ON observations(deal_subfolder, deal_number, user_id)"#)
        .execute(pool)
        .await
        .map_err(|e| DbError::Migration(e.to_string()))?;

    // ---- board_result column on observations ----
    let has_board_result: bool = sqlx::query_scalar(
        r#"SELECT COUNT(*) > 0 FROM pragma_table_info('observations') WHERE name = 'board_result'"#,
    )
    .fetch_one(pool)
    .await
    .unwrap_or(false);

    if !has_board_result {
        sqlx::query(r#"ALTER TABLE observations ADD COLUMN board_result TEXT"#)
            .execute(pool)
            .await
            .map_err(|e| DbError::Migration(e.to_string()))?;
        tracing::info!("Added board_result column to observations table");
    }

    // ---- Board status table ----
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS board_status (
            user_id TEXT NOT NULL,
            deal_subfolder TEXT NOT NULL,
            deal_number INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'not_attempted',
            achievement TEXT NOT NULL DEFAULT 'none',
            last_observation_at TEXT,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (user_id, deal_subfolder, deal_number)
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    sqlx::query(r#"CREATE INDEX IF NOT EXISTS idx_board_status_user_subfolder ON board_status(user_id, deal_subfolder)"#)
        .execute(pool)
        .await
        .map_err(|e| DbError::Migration(e.to_string()))?;

    // ---- Assignment-scoped board status (rollup parallel to board_status) ----
    // One row per (user, assignment, board). Holds the §5 status of the work the
    // student did INSIDE the assignment (observations tagged with assignment_id),
    // so the assignment progress bar reads a canonical rollup instead of querying
    // observations. Status-only — the bar needs just the 4-colour breakdown.
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS assignment_board_status (
            user_id TEXT NOT NULL,
            assignment_id TEXT NOT NULL,
            deal_subfolder TEXT NOT NULL,
            deal_number INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'not_attempted',
            last_observation_at TEXT,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (user_id, assignment_id, deal_subfolder, deal_number)
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    sqlx::query(r#"CREATE INDEX IF NOT EXISTS idx_abs_user_assignment ON assignment_board_status(user_id, assignment_id)"#)
        .execute(pool)
        .await
        .map_err(|e| DbError::Migration(e.to_string()))?;

    // ===============================================================
    // Correctness & Mastery v2 — see documentation/CORRECTNESS_AND_MASTERY.md
    // (issue #2). Adds clear-text context fields to observations,
    // expands board_status with per-board achievement state, adds
    // schema_meta to gate one-shot data backfills, and adds
    // student_summary for teacher-dashboard rollups (§14.2).
    // ===============================================================

    // ---- New observations columns (per CORRECTNESS_AND_MASTERY.md §16) ----
    // status / wilderness populated by the recompute walker. The three
    // context fields (exercise_id, assignment_id, jungle) are set by the
    // client at insert time and used by the backend to derive wilderness.
    add_column_if_missing(pool, "observations", "status", "TEXT").await?;
    add_column_if_missing(pool, "observations", "wilderness", "TEXT").await?;
    add_column_if_missing(pool, "observations", "exercise_id", "TEXT").await?;
    add_column_if_missing(pool, "observations", "assignment_id", "TEXT").await?;
    add_column_if_missing(pool, "observations", "jungle", "INTEGER NOT NULL DEFAULT 0").await?;

    // Per-play total time spent on the board, in milliseconds (issue #7).
    // Sum of prompts[].time_ms for board-level observations, falling
    // back to result.time_taken_ms for prompt-level. Populated by the
    // frontend on insert; backfilled once at startup from the encrypted
    // blob for pre-existing rows.
    add_column_if_missing(pool, "observations", "time_taken_ms", "INTEGER").await?;

    // ---- New board_status columns (per CORRECTNESS_AND_MASTERY.md §6, §7) ----
    // The old `achievement` column is intentionally left in place; the
    // new model replaces it with the (max_stars, wild_achievement) pair,
    // and code stops reading the old column.
    add_column_if_missing(pool, "board_status", "wilderness", "TEXT NOT NULL DEFAULT 'Tame'").await?;
    add_column_if_missing(pool, "board_status", "last_error_date", "TEXT").await?;
    add_column_if_missing(pool, "board_status", "star_count", "INTEGER NOT NULL DEFAULT 0").await?;
    add_column_if_missing(pool, "board_status", "max_stars", "INTEGER NOT NULL DEFAULT 0").await?;
    add_column_if_missing(pool, "board_status", "last_star_update", "TEXT").await?;
    add_column_if_missing(pool, "board_status", "wild_achievement", "TEXT").await?;

    // ---- Exercise soft-delete (issue #15) ----
    // Soft-delete keeps observation history intact when a teacher deletes
    // an exercise. Listings filter on `deleted_at IS NULL`; observations
    // retain their `exercise_id` text value, which references the
    // tombstoned row.
    add_column_if_missing(pool, "exercises", "deleted_at", "TEXT").await?;

    // Indexes for the exercise usage rollup (issue #15): when listing a
    // teacher's exercises we look up assignment / observation / student
    // counts per exercise_id.
    sqlx::query(r#"CREATE INDEX IF NOT EXISTS idx_observations_exercise ON observations(exercise_id)"#)
        .execute(pool)
        .await
        .map_err(|e| DbError::Migration(e.to_string()))?;

    // §C10: assignment_id is the hot filter for compute_assignment_stats, the
    // duration rollups, recompute_assignment_boards (per board), and the grid
    // query — all previously full-scanning the largest table. Index it.
    sqlx::query(r#"CREATE INDEX IF NOT EXISTS idx_observations_assignment ON observations(assignment_id)"#)
        .execute(pool)
        .await
        .map_err(|e| DbError::Migration(e.to_string()))?;

    // §C9: create observations_decrypted in migrations so it always exists. It
    // was previously created only as a side effect of the admin decrypt endpoint,
    // so merge_accounts (which DELETEs from it) 500'd on any DB where decrypt had
    // never been run (fresh install / clean restore). The admin endpoint still
    // DROP+CREATEs it on each run to refresh the schema; this just guarantees a
    // baseline table is present.
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS observations_decrypted (
            observation_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            timestamp TEXT,
            deal_subfolder TEXT,
            deal_number INTEGER,
            prompt_index INTEGER,
            correct INTEGER,
            board_result_metadata TEXT,
            board_result_payload TEXT,
            inferred_board_result TEXT,
            had_wrong_prompt INTEGER,
            prompt_count INTEGER,
            student_bid TEXT,
            expected_bid TEXT,
            student_hand TEXT,
            full_auction TEXT,
            auction_so_far TEXT,
            skill_path TEXT,
            session_id TEXT,
            decrypted_json TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    // ---- Index for the "is the board cold?" check (CORRECTNESS_AND_MASTERY.md §7.2) ----
    // Supports the wild_achievement promotion lookup: for a given
    // (user, board), are there any observations in [t - 6 days, t)?
    sqlx::query(
        r#"CREATE INDEX IF NOT EXISTS idx_observations_user_board_ts
           ON observations(user_id, deal_subfolder, deal_number, timestamp)"#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    // ---- schema_meta — gates one-shot data migrations ----
    // Each row records that a named migration has run. Used to keep
    // the v2 backfill (in a follow-up commit) from re-running on every
    // server startup.
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS schema_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            completed_at TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    // ---- student_summary — denormalised per-student rollup (§14.2) ----
    // A cache, not source of truth: rebuildable from board_status and
    // observations at any time. Read by the teacher dashboard so the
    // GUI never spans observations across multiple students.
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS student_summary (
            user_id              TEXT PRIMARY KEY,
            last_observation_at  TEXT,
            total_observations   INTEGER NOT NULL DEFAULT 0,
            distinct_lessons     INTEGER NOT NULL DEFAULT 0,
            distinct_boards_seen INTEGER NOT NULL DEFAULT 0,

            boards_not_attempted INTEGER NOT NULL DEFAULT 0,
            boards_failed        INTEGER NOT NULL DEFAULT 0,
            boards_corrected     INTEGER NOT NULL DEFAULT 0,
            boards_close_correct INTEGER NOT NULL DEFAULT 0,
            boards_clean_correct INTEGER NOT NULL DEFAULT 0,

            boards_silver        INTEGER NOT NULL DEFAULT 0,
            boards_gold          INTEGER NOT NULL DEFAULT 0,
            on_star_track        INTEGER NOT NULL DEFAULT 0,

            boards_recent_paw    INTEGER NOT NULL DEFAULT 0,
            boards_fresh_paw     INTEGER NOT NULL DEFAULT 0,

            lessons_exploring    INTEGER NOT NULL DEFAULT 0,
            lessons_learning     INTEGER NOT NULL DEFAULT 0,
            lessons_retaining    INTEGER NOT NULL DEFAULT 0,
            lessons_mastering    INTEGER NOT NULL DEFAULT 0,

            updated_at           TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    // ---- View: board_status with human-readable username ----
    // DROP + CREATE rather than CREATE IF NOT EXISTS because the column
    // list has changed (issue #2, CORRECTNESS_AND_MASTERY.md §16). Used
    // by the DB browser for ad-hoc lookups where user IDs aren't
    // memorable; surface the new achievement fields here too.
    sqlx::query(r#"DROP VIEW IF EXISTS board_status_by_name"#)
        .execute(pool)
        .await
        .map_err(|e| DbError::Migration(e.to_string()))?;
    sqlx::query(
        r#"
        CREATE VIEW board_status_by_name AS
        SELECT
            bs.user_id,
            u.first_name || ' ' || u.last_name AS student_name,
            u.email                            AS student_email,
            bs.deal_subfolder,
            bs.deal_number,
            bs.status,
            bs.wilderness,
            bs.last_error_date,
            bs.star_count,
            bs.max_stars,
            bs.last_star_update,
            bs.wild_achievement,
            bs.last_observation_at,
            bs.updated_at
        FROM board_status bs
        JOIN users u ON u.id = bs.user_id
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    // View: sharing grants with human-readable names
    sqlx::query(
        r#"
        CREATE VIEW IF NOT EXISTS grants_by_name AS
        SELECT
            g.id,
            u.first_name || ' ' || u.last_name AS grantor_name,
            u.email AS grantor_email,
            v.name AS grantee_name,
            v.role AS grantee_role,
            g.granted_at,
            g.revoked
        FROM sharing_grants g
        JOIN users u ON u.id = g.grantor_id
        JOIN viewers v ON v.id = g.grantee_id
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    // Seed the "2/1 Intermediate" system card if it doesn't exist
    let system_card_id = "system-21-intermediate";
    let card_exists: bool = sqlx::query_scalar(
        r#"SELECT COUNT(*) > 0 FROM convention_cards WHERE id = ?"#,
    )
    .bind(system_card_id)
    .fetch_one(pool)
    .await
    .unwrap_or(false);

    if !card_exists {
        let now = chrono::Utc::now().to_rfc3339();
        let card_data = include_str!("../seed_data/21_intermediate_card.json");

        sqlx::query(
            r#"
            INSERT INTO convention_cards (id, name, description, format, owner_id, card_data, visibility, created_at, updated_at)
            VALUES (?, ?, ?, ?, NULL, ?, 'public', ?, ?)
            "#,
        )
        .bind(system_card_id)
        .bind("2/1 Intermediate")
        .bind("Standard 2/1 Game Force system with common conventions for intermediate players")
        .bind("bridge_classroom")
        .bind(card_data)
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await
        .map_err(|e| DbError::Migration(e.to_string()))?;

        tracing::info!("Created system convention card: 2/1 Intermediate");

        // Assign to all existing users as their primary card
        let users: Vec<(String,)> = sqlx::query_as("SELECT id FROM users")
            .fetch_all(pool)
            .await
            .map_err(|e| DbError::Migration(e.to_string()))?;

        for (user_id,) in users {
            let link_id = uuid::Uuid::new_v4().to_string();
            sqlx::query(
                r#"
                INSERT OR IGNORE INTO user_convention_cards (id, user_id, card_id, is_primary, label, linked_at)
                VALUES (?, ?, ?, 1, NULL, ?)
                "#,
            )
            .bind(&link_id)
            .bind(&user_id)
            .bind(system_card_id)
            .bind(&now)
            .execute(pool)
            .await
            .map_err(|e| DbError::Migration(e.to_string()))?;
        }

        tracing::info!("Assigned 2/1 Intermediate card to all existing users");
    }

    // One-shot data backfill for the Correctness & Mastery v2 schema
    // additions above. Gated by `schema_meta` so it runs exactly once.
    run_v2_backfill(pool).await?;

    // One-shot backfill for the assignment_board_status rollup. Separate
    // schema_meta gate so it runs once even on DBs already past v2.
    run_assignment_status_backfill(pool).await?;

    tracing::info!("Database migrations completed successfully");
    Ok(())
}

/// One-shot backfill for `assignment_board_status`: projects existing
/// assignment-tagged observations into the per-(user, assignment, board)
/// rollup via `recompute_assignment_boards`. Gated by its own `schema_meta`
/// key so it runs exactly once, independent of the v2 backfill gate.
async fn run_assignment_status_backfill(pool: &Pool<Sqlite>) -> Result<(), DbError> {
    let already_done: bool = sqlx::query_scalar(
        r#"SELECT COUNT(*) > 0 FROM schema_meta WHERE key = 'assignment_board_status_backfill'"#,
    )
    .fetch_one(pool)
    .await
    .unwrap_or(false);

    if already_done {
        tracing::debug!("assignment_board_status_backfill already complete, skipping");
        return Ok(());
    }

    tracing::info!("Running assignment_board_status_backfill...");
    let started = std::time::Instant::now();

    let pairs: Vec<(String, String)> = sqlx::query_as(
        r#"
        SELECT DISTINCT user_id, assignment_id
        FROM observations
        WHERE assignment_id IS NOT NULL
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    tracing::info!("assignment backfill: recomputing {} (user, assignment) pairs", pairs.len());

    let mut failed = 0_usize;
    for (user_id, assignment_id) in &pairs {
        if let Err(e) = crate::routes::board_status::recompute_assignment_boards(
            pool, user_id, assignment_id,
        )
        .await
        {
            tracing::error!(
                "assignment backfill: recompute failed for {}/{}: {}",
                user_id, assignment_id, e
            );
            failed += 1;
        }
    }
    if failed > 0 {
        tracing::warn!("assignment backfill: {} pairs failed", failed);
    }

    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(r#"INSERT INTO schema_meta (key, value, completed_at) VALUES (?, ?, ?)"#)
        .bind("assignment_board_status_backfill")
        .bind("done")
        .bind(&now)
        .execute(pool)
        .await
        .map_err(|e| DbError::Migration(e.to_string()))?;

    tracing::info!(
        "assignment_board_status_backfill complete in {:.2}s",
        started.elapsed().as_secs_f64()
    );
    Ok(())
}

/// One-shot backfill for the Correctness & Mastery v2 columns added in
/// the section above. Walks every (user, board) tuple with observations
/// through `recompute_board_history`, then rebuilds `student_summary`
/// for every user with observations. Records completion in `schema_meta`
/// so subsequent startups no-op.
///
/// See `documentation/CORRECTNESS_AND_MASTERY.md` §16 for the migration
/// plan and §14.2 for the summary table shape.
async fn run_v2_backfill(pool: &Pool<Sqlite>) -> Result<(), DbError> {
    let already_done: bool = sqlx::query_scalar(
        r#"SELECT COUNT(*) > 0 FROM schema_meta WHERE key = 'correctness_v2_backfill'"#,
    )
    .fetch_one(pool)
    .await
    .unwrap_or(false);

    if already_done {
        tracing::debug!("correctness_v2_backfill already complete, skipping");
        return Ok(());
    }

    tracing::info!("Running correctness_v2_backfill...");
    let started = std::time::Instant::now();

    // 1. Recompute board_status (and per-observation status/wilderness)
    //    for every distinct (user, board) tuple that appears in EITHER
    //    table. UNION with board_status catches orphan rows whose
    //    observations have been deleted — those get recomputed to
    //    `not_attempted` under the new rules instead of stranding stale
    //    enum values (e.g. `fresh_correct`) from the old model.
    let boards: Vec<(String, String, i32)> = sqlx::query_as(
        r#"
        SELECT DISTINCT user_id, deal_subfolder, deal_number
        FROM observations
        WHERE deal_subfolder IS NOT NULL AND deal_number IS NOT NULL
        UNION
        SELECT user_id, deal_subfolder, deal_number FROM board_status
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    tracing::info!("v2 backfill: recomputing {} (user, board) tuples", boards.len());

    let mut board_succeeded = 0_usize;
    let mut board_failed = 0_usize;
    for (user_id, subfolder, deal_number) in &boards {
        match crate::routes::board_status::recompute_board_history(
            pool, user_id, subfolder, *deal_number,
        )
        .await
        {
            Ok(()) => board_succeeded += 1,
            Err(e) => {
                tracing::error!(
                    "v2 backfill: recompute failed for {}/{}/{}: {}",
                    user_id, subfolder, deal_number, e
                );
                board_failed += 1;
            }
        }
    }
    tracing::info!(
        "v2 backfill: board_status — {} succeeded, {} failed",
        board_succeeded, board_failed
    );

    // 2. Build student_summary from the rebuilt board_status.
    let users_with_obs: Vec<String> = sqlx::query_scalar(
        r#"SELECT DISTINCT user_id FROM observations"#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    tracing::info!("v2 backfill: building student_summary for {} users", users_with_obs.len());

    let mut summary_failed = 0_usize;
    for user_id in &users_with_obs {
        if let Err(e) = crate::student_summary::recompute_student_summary(pool, user_id).await {
            tracing::error!("v2 backfill: summary failed for {}: {}", user_id, e);
            summary_failed += 1;
        }
    }
    if summary_failed > 0 {
        tracing::warn!("v2 backfill: {} student_summary rows failed", summary_failed);
    }

    // 3. Mark complete so subsequent startups skip Steps 1 & 2.
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        r#"INSERT INTO schema_meta (key, value, completed_at) VALUES (?, ?, ?)"#,
    )
    .bind("correctness_v2_backfill")
    .bind("done")
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;

    tracing::info!(
        "correctness_v2_backfill complete in {:.2}s",
        started.elapsed().as_secs_f64()
    );
    Ok(())
}

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("Failed to initialize database: {0}")]
    Init(String),

    #[error("Failed to connect to database: {0}")]
    Connection(String),

    #[error("Migration failed: {0}")]
    Migration(String),

    #[allow(dead_code)]
    #[error("Query failed: {0}")]
    Query(String),
}

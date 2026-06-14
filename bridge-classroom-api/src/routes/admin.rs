use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use ring::aead::{self, LessSafeKey, UnboundKey, AES_256_GCM, Nonce, NONCE_LEN};
use serde::{Deserialize, Serialize};

use crate::AppState;
use super::recovery::decrypt_for_recovery;

/// Validate API key from request headers
fn validate_api_key(headers: &HeaderMap, expected_key: &str) -> bool {
    if let Some(header_key) = headers.get("x-api-key").and_then(|v| v.to_str().ok()) {
        return header_key == expected_key;
    }
    false
}

// ---- Request / Response types ----

#[derive(Debug, Deserialize)]
pub struct AdminQuery {
    pub admin_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AdminStatsResponse {
    pub success: bool,
    pub stats: AdminStats,
    pub popular_lessons: Vec<PopularLesson>,
    pub database: DatabaseInfo,
}

#[derive(Debug, Serialize)]
pub struct AdminStats {
    pub total_users: i64,
    pub new_users_7d: i64,
    pub new_users_today: i64,
    /// Names of users created in the last 7 days, newest first (for tooltip).
    pub new_users_7d_names: Vec<String>,
    pub active_7d: i64,
    pub observation_count_7d: i64,
    pub active_today: i64,
    pub total_observations: i64,
    pub total_classrooms: i64,
    pub total_assignments: i64,
}

#[derive(Debug, Serialize)]
pub struct PopularLesson {
    pub deal_subfolder: String,
    pub play_count: i64,
    pub unique_users: i64,
    pub accuracy_pct: i64,
}

#[derive(Debug, Serialize)]
pub struct DatabaseInfo {
    pub file_size_bytes: u64,
    pub tables: Vec<TableInfo>,
}

#[derive(Debug, Serialize)]
pub struct TableInfo {
    pub name: String,
    pub row_count: i64,
}

#[derive(Debug, Serialize)]
pub struct AdminHealthResponse {
    pub success: bool,
    pub health: HealthInfo,
}

#[derive(Debug, Serialize)]
pub struct HealthInfo {
    pub uptime_seconds: u64,
    pub disk_available_gb: f64,
    pub disk_total_gb: f64,
    pub last_observation_at: Option<String>,
    pub database_writable: bool,
    pub api_version: String,
}

// ---- Helper query structs ----

#[derive(sqlx::FromRow)]
struct CountRow {
    count: i64,
}

#[derive(sqlx::FromRow)]
struct PopularLessonRow {
    deal_subfolder: String,
    play_count: i64,
    unique_users: i64,
    accuracy_pct: f64,
}

#[derive(sqlx::FromRow)]
struct TableNameRow {
    name: String,
}

#[derive(sqlx::FromRow)]
struct MaxTimestampRow {
    max_ts: Option<String>,
}

// ---- Handlers ----

/// GET /api/admin/stats
pub async fn admin_stats(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(_query): Query<AdminQuery>,
) -> Result<Json<AdminStatsResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let now = chrono::Utc::now();
    let seven_days_ago = (now - chrono::Duration::days(7)).to_rfc3339();
    // "Today" = local (Pacific) midnight, converted to UTC for comparison with stored timestamps
    let local_now = chrono::Local::now();
    let local_offset = *local_now.offset();
    let local_midnight = local_now.date_naive().and_hms_opt(0, 0, 0).unwrap();
    let local_midnight_utc = local_midnight.and_local_timezone(local_offset).unwrap().with_timezone(&chrono::Utc);
    let today_start = local_midnight_utc.to_rfc3339();

    // Fetch all stats in parallel
    let total_users: CountRow = sqlx::query_as("SELECT COUNT(*) as count FROM users")
        .fetch_one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // New registrations: users created within the last 7 days, and (separately)
    // since local midnight. created_at is RFC3339 UTC (+00:00), so a string
    // comparison against these RFC3339 bounds orders correctly.
    let new_users_7d: CountRow =
        sqlx::query_as("SELECT COUNT(*) as count FROM users WHERE created_at >= ?")
            .bind(&seven_days_ago)
            .fetch_one(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let new_users_today: CountRow =
        sqlx::query_as("SELECT COUNT(*) as count FROM users WHERE created_at >= ?")
            .bind(&today_start)
            .fetch_one(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Names of the week's new users (newest first), capped — for the tooltip.
    let new_users_7d_names: Vec<String> = sqlx::query_scalar(
        "SELECT trim(first_name || ' ' || last_name) FROM users \
         WHERE created_at >= ? ORDER BY created_at DESC LIMIT 50",
    )
    .bind(&seven_days_ago)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let active_7d: CountRow = sqlx::query_as(
        "SELECT COUNT(DISTINCT user_id) as count FROM observations WHERE timestamp >= ?",
    )
    .bind(&seven_days_ago)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let obs_count_7d: CountRow =
        sqlx::query_as("SELECT COUNT(*) as count FROM observations WHERE timestamp >= ?")
            .bind(&seven_days_ago)
            .fetch_one(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let active_today: CountRow = sqlx::query_as(
        "SELECT COUNT(DISTINCT user_id) as count FROM observations WHERE timestamp >= ?",
    )
    .bind(&today_start)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let total_obs: CountRow = sqlx::query_as("SELECT COUNT(*) as count FROM observations")
        .fetch_one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let total_classrooms: CountRow = sqlx::query_as("SELECT COUNT(*) as count FROM classrooms")
        .fetch_one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let total_assignments: CountRow = sqlx::query_as("SELECT COUNT(*) as count FROM assignments")
        .fetch_one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Popular lessons
    let popular_lessons: Vec<PopularLessonRow> = sqlx::query_as(
        r#"
        SELECT
            deal_subfolder,
            COUNT(*) as play_count,
            COUNT(DISTINCT user_id) as unique_users,
            ROUND(AVG(CASE WHEN correct THEN 100.0 ELSE 0.0 END)) as accuracy_pct
        FROM observations
        WHERE deal_subfolder IS NOT NULL AND deal_subfolder != ''
        GROUP BY deal_subfolder
        ORDER BY play_count DESC
        LIMIT 20
        "#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Database info
    let db_path = state
        .config
        .database_url
        .trim_start_matches("sqlite:")
        .split('?')
        .next()
        .unwrap_or("");

    let file_size_bytes = if let Ok(metadata) = std::fs::metadata(db_path) {
        metadata.len()
    } else {
        0
    };

    // Get table row counts
    let table_names: Vec<TableNameRow> = sqlx::query_as(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_sqlx_%' ORDER BY name",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut tables = Vec::new();
    for tn in &table_names {
        let count_query = format!("SELECT COUNT(*) as count FROM \"{}\"", tn.name);
        if let Ok(row) = sqlx::query_as::<_, CountRow>(&count_query)
            .fetch_one(&state.db)
            .await
        {
            tables.push(TableInfo {
                name: tn.name.clone(),
                row_count: row.count,
            });
        }
    }

    Ok(Json(AdminStatsResponse {
        success: true,
        stats: AdminStats {
            total_users: total_users.count,
            new_users_7d: new_users_7d.count,
            new_users_today: new_users_today.count,
            new_users_7d_names,
            active_7d: active_7d.count,
            observation_count_7d: obs_count_7d.count,
            active_today: active_today.count,
            total_observations: total_obs.count,
            total_classrooms: total_classrooms.count,
            total_assignments: total_assignments.count,
        },
        popular_lessons: popular_lessons
            .into_iter()
            .map(|r| PopularLesson {
                deal_subfolder: r.deal_subfolder,
                play_count: r.play_count,
                unique_users: r.unique_users,
                accuracy_pct: r.accuracy_pct as i64,
            })
            .collect(),
        database: DatabaseInfo {
            file_size_bytes,
            tables,
        },
    }))
}

/// GET /api/admin/health
pub async fn admin_health(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<AdminHealthResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    // Uptime
    let uptime_seconds = state.started_at.elapsed().as_secs();

    // Disk usage via df command
    let (disk_available_gb, disk_total_gb) = get_disk_usage();

    // Last observation timestamp
    let last_obs: MaxTimestampRow =
        sqlx::query_as("SELECT MAX(timestamp) as max_ts FROM observations")
            .fetch_one(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Database writable check
    let database_writable = sqlx::query("SELECT 1")
        .execute(&state.db)
        .await
        .is_ok();

    Ok(Json(AdminHealthResponse {
        success: true,
        health: HealthInfo {
            uptime_seconds,
            disk_available_gb,
            disk_total_gb,
            last_observation_at: last_obs.max_ts,
            database_writable,
            api_version: env!("CARGO_PKG_VERSION").to_string(),
        },
    }))
}

// ---- Observation decryption ----

#[derive(Debug, Serialize)]
pub struct DecryptObservationsResponse {
    pub success: bool,
    pub users_processed: usize,
    pub observations_decrypted: usize,
    pub users_skipped: usize,
    pub errors: usize,
}

#[derive(Debug, sqlx::FromRow)]
struct UserRecoveryRow {
    id: String,
    recovery_encrypted_key: Option<String>,
}

#[derive(Debug, sqlx::FromRow)]
struct ObservationEncryptedRow {
    id: String,
    user_id: String,
    timestamp: String,
    skill_path: String,
    correct: bool,
    deal_subfolder: Option<String>,
    deal_number: Option<i32>,
    encrypted_data: String,
    iv: String,
    board_result: Option<String>,
}

/// Decrypt an observation's encrypted_data using the student's AES key.
fn decrypt_observation_data(
    encrypted_data: &str,
    iv: &str,
    aes_key_base64: &str,
) -> Result<String, String> {
    let key_bytes = BASE64
        .decode(aes_key_base64)
        .map_err(|e| format!("Bad AES key base64: {}", e))?;
    let iv_bytes = BASE64
        .decode(iv)
        .map_err(|e| format!("Bad IV base64: {}", e))?;
    let ciphertext = BASE64
        .decode(encrypted_data)
        .map_err(|e| format!("Bad ciphertext base64: {}", e))?;

    if iv_bytes.len() != NONCE_LEN {
        return Err(format!("IV length {} != expected {}", iv_bytes.len(), NONCE_LEN));
    }

    let nonce_array: [u8; NONCE_LEN] = iv_bytes
        .try_into()
        .map_err(|_| "Invalid nonce length")?;
    let nonce = Nonce::assume_unique_for_key(nonce_array);

    let unbound_key = UnboundKey::new(&AES_256_GCM, &key_bytes)
        .map_err(|e| format!("Failed to create AES key: {:?}", e))?;
    let key = LessSafeKey::new(unbound_key);

    let mut in_out = ciphertext;
    let plaintext = key
        .open_in_place(nonce, aead::Aad::empty(), &mut in_out)
        .map_err(|e| format!("Decryption failed: {:?}", e))?;

    String::from_utf8(plaintext.to_vec()).map_err(|e| format!("Invalid UTF-8: {}", e))
}

/// POST /api/admin/decrypt-observations
/// Decrypts all observations using RECOVERY_SECRET and populates observations_decrypted table.
pub async fn admin_decrypt_observations(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<DecryptObservationsResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let recovery_secret = state
        .config
        .recovery_secret
        .as_ref()
        .ok_or((StatusCode::BAD_REQUEST, "RECOVERY_SECRET not configured".to_string()))?;

    // Create (or recreate) the observations_decrypted table
    sqlx::query("DROP TABLE IF EXISTS observations_decrypted")
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Drop table failed: {}", e)))?;

    sqlx::query(
        r#"
        CREATE TABLE observations_decrypted (
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
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Create table failed: {}", e)))?;

    // Fetch all users with recovery keys
    let users: Vec<UserRecoveryRow> = sqlx::query_as(
        "SELECT id, recovery_encrypted_key FROM users",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut users_processed = 0usize;
    let mut users_skipped = 0usize;
    let mut total_decrypted = 0usize;
    let mut total_errors = 0usize;

    for user in &users {
        let encrypted_key = match &user.recovery_encrypted_key {
            Some(k) if !k.is_empty() => k,
            _ => {
                users_skipped += 1;
                continue;
            }
        };

        // Decrypt the user's AES secret key
        let aes_key = match decrypt_for_recovery(encrypted_key, recovery_secret) {
            Ok(k) => k,
            Err(e) => {
                tracing::warn!("Failed to decrypt recovery key for user {}: {}", user.id, e);
                users_skipped += 1;
                continue;
            }
        };

        // Fetch all observations for this user
        let observations: Vec<ObservationEncryptedRow> = sqlx::query_as(
            r#"
            SELECT id, user_id, timestamp, skill_path, correct,
                   deal_subfolder, deal_number, encrypted_data, iv, board_result
            FROM observations
            WHERE user_id = ?
            ORDER BY timestamp ASC
            "#,
        )
        .bind(&user.id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        for obs in &observations {
            match decrypt_observation_data(&obs.encrypted_data, &obs.iv, &aes_key) {
                Ok(json_str) => {
                    // Parse the decrypted JSON
                    let json: serde_json::Value = match serde_json::from_str(&json_str) {
                        Ok(v) => v,
                        Err(e) => {
                            tracing::warn!("Failed to parse decrypted JSON for obs {}: {}", obs.id, e);
                            total_errors += 1;
                            continue;
                        }
                    };

                    // Extract fields
                    let prompt_index = json
                        .get("bid_prompt")
                        .and_then(|bp| bp.get("prompt_index"))
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0) as i32;

                    let session_id = json.get("session_id").and_then(|v| v.as_str()).unwrap_or("");

                    let student_bid = json
                        .get("result")
                        .and_then(|r| r.get("student_bid"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");

                    let expected_bid = json
                        .get("bid_prompt")
                        .and_then(|bp| bp.get("expected_bid"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");

                    // Extract student's hand cards
                    let student_seat_raw = json
                        .get("deal")
                        .and_then(|d| d.get("student_seat"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("S");
                    // Map seat letter to full name for JSON lookup
                    let seat_upper = student_seat_raw.to_uppercase();
                    let student_seat: &str = match seat_upper.as_str() {
                        "N" => "north",
                        "E" => "east",
                        "S" => "south",
                        "W" => "west",
                        _ => "south",
                    };
                    let student_hand_value = json
                        .get("deal")
                        .and_then(|d| d.get("hands"))
                        .and_then(|h| h.get(student_seat));
                    let student_hand = match student_hand_value {
                        Some(serde_json::Value::String(s)) => s.clone(),
                        Some(serde_json::Value::Object(obj)) => {
                            // Object format: {"spades":["Q","T"],"hearts":["7"],...}
                            let mut parts = Vec::new();
                            for (suit, symbol) in [("spades", "S"), ("hearts", "H"), ("diamonds", "D"), ("clubs", "C")] {
                                if let Some(cards) = obj.get(suit).and_then(|v| v.as_array()) {
                                    let card_str: Vec<&str> = cards
                                        .iter()
                                        .filter_map(|c| c.as_str())
                                        .collect();
                                    if !card_str.is_empty() {
                                        parts.push(format!("{}{}", symbol, card_str.join("")));
                                    }
                                }
                            }
                            parts.join(" ")
                        }
                        _ => String::new(),
                    };

                    // Extract auction info
                    let full_auction = json
                        .get("deal")
                        .and_then(|d| d.get("full_auction"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let auction_so_far = json
                        .get("bid_prompt")
                        .and_then(|bp| bp.get("auction_so_far"))
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|v| v.as_str())
                                .collect::<Vec<_>>()
                                .join(" ")
                        })
                        .unwrap_or_default();

                    let board_result_payload = json
                        .get("board_result")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());

                    // Analyze prompts array for had_wrong_prompt
                    let prompts = json.get("prompts").and_then(|v| v.as_array());
                    let prompt_count = prompts.map(|a| a.len()).unwrap_or(0) as i32;
                    let had_wrong_prompt = prompts
                        .map(|arr| {
                            arr.iter().any(|p| {
                                p.get("correct").and_then(|v| v.as_bool()) == Some(false)
                            })
                        })
                        .unwrap_or(false);

                    // Infer board_result
                    let inferred_board_result = if prompt_index == -1 {
                        // Board-level: use prompts array to detect corrections
                        if !obs.correct {
                            Some("failed".to_string())
                        } else if had_wrong_prompt {
                            Some("corrected".to_string())
                        } else {
                            Some("correct".to_string())
                        }
                    } else {
                        // Prompt-level: infer directly from correct field
                        if obs.correct {
                            Some("correct".to_string())
                        } else {
                            Some("failed".to_string())
                        }
                    };

                    // Insert into decrypted table
                    if let Err(e) = sqlx::query(
                        r#"
                        INSERT INTO observations_decrypted
                            (observation_id, user_id, timestamp, deal_subfolder, deal_number,
                             prompt_index, correct, board_result_metadata, board_result_payload,
                             inferred_board_result, had_wrong_prompt, prompt_count,
                             student_bid, expected_bid, student_hand, full_auction,
                             auction_so_far, skill_path, session_id, decrypted_json)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        "#,
                    )
                    .bind(&obs.id)
                    .bind(&obs.user_id)
                    .bind(&obs.timestamp)
                    .bind(&obs.deal_subfolder)
                    .bind(&obs.deal_number)
                    .bind(prompt_index)
                    .bind(obs.correct)
                    .bind(&obs.board_result)
                    .bind(&board_result_payload)
                    .bind(&inferred_board_result)
                    .bind(had_wrong_prompt as i32)
                    .bind(prompt_count)
                    .bind(student_bid)
                    .bind(expected_bid)
                    .bind(&student_hand)
                    .bind(&full_auction)
                    .bind(&auction_so_far)
                    .bind(&obs.skill_path)
                    .bind(session_id)
                    .bind(&json_str)
                    .execute(&state.db)
                    .await
                    {
                        tracing::warn!("Insert failed for obs {}: {}", obs.id, e);
                        total_errors += 1;
                        continue;
                    }

                    total_decrypted += 1;
                }
                Err(e) => {
                    tracing::warn!("Decrypt failed for obs {}: {}", obs.id, e);
                    total_errors += 1;
                }
            }
        }

        users_processed += 1;
    }

    tracing::info!(
        "Observation decryption complete: {} users processed, {} observations decrypted, {} skipped, {} errors",
        users_processed, total_decrypted, users_skipped, total_errors
    );

    Ok(Json(DecryptObservationsResponse {
        success: true,
        users_processed,
        observations_decrypted: total_decrypted,
        users_skipped,
        errors: total_errors,
    }))
}

/// Get disk usage using df command (macOS/Linux compatible)
fn get_disk_usage() -> (f64, f64) {
    let output = std::process::Command::new("df")
        .args(["-g", "/"])
        .output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            // Parse df output: second line has filesystem info
            // Format: Filesystem 1G-blocks Used Available Capacity ...
            if let Some(line) = stdout.lines().nth(1) {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 4 {
                    let total = parts[1].parse::<f64>().unwrap_or(0.0);
                    let available = parts[3].parse::<f64>().unwrap_or(0.0);
                    return (available, total);
                }
            }
            (0.0, 0.0)
        }
        Err(_) => (0.0, 0.0),
    }
}


use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::AppState;

// ---- Clear panel types ----

#[derive(Debug, Deserialize)]
pub struct ClearPanelRequest {
    pub teacher_id: String,
    pub panel: String,
}

#[derive(Debug, Serialize)]
pub struct ClearPanelResponse {
    pub success: bool,
}

/// Validate API key from request headers
fn validate_api_key(headers: &HeaderMap, expected_key: &str) -> bool {
    if let Some(header_key) = headers.get("x-api-key").and_then(|v| v.to_str().ok()) {
        return header_key == expected_key;
    }
    false
}

// ---- Request / Response types ----

#[derive(Debug, Deserialize)]
pub struct TeacherDashboardQuery {
    pub teacher_id: String,
}

#[derive(Debug, Serialize)]
pub struct TeacherDashboardResponse {
    pub success: bool,
    pub classrooms: Vec<DashboardClassroom>,
    pub needs_attention: Vec<AttentionItem>,
    pub recent_activity: Vec<ActivityEvent>,
}

#[derive(Debug, Serialize)]
pub struct DashboardClassroom {
    pub id: String,
    pub name: String,
    pub join_code: String,
    pub member_count: i64,
    pub open_assignment_count: i64,
    pub avg_completion_pct: i64,
    pub assignments: Vec<DashboardAssignment>,
}

#[derive(Debug, Serialize)]
pub struct DashboardAssignment {
    pub id: String,
    pub exercise_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_at: Option<String>,
    pub total_boards: i64,
    pub students_completed: i64,
    pub students_total: i64,
}

#[derive(Debug, Serialize)]
pub struct AttentionItem {
    #[serde(rename = "type")]
    pub item_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignment_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exercise_name: Option<String>,
    pub classroom_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub student_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lagging_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_students: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accuracy_pct: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub joined_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ActivityEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub student_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exercise_name: Option<String>,
    pub classroom_name: String,
    pub timestamp: String,
}

// ---- Helper query structs ----

#[derive(sqlx::FromRow)]
struct ClassroomRow {
    id: String,
    name: String,
    join_code: String,
    member_count: i64,
}

#[derive(sqlx::FromRow)]
struct AssignmentRow {
    id: String,
    exercise_id: String,
    exercise_name: String,
    due_at: Option<String>,
    assigned_at: String,
}

#[derive(sqlx::FromRow)]
struct MemberRow {
    student_id: String,
    first_name: String,
    last_name: String,
    joined_at: String,
}

#[derive(sqlx::FromRow)]
struct ObservationHit {
    deal_subfolder: String,
    deal_number: i64,
    correct: bool,
}

#[derive(sqlx::FromRow)]
struct ClearedTimestamps {
    attention_cleared_at: Option<String>,
    activity_cleared_at: Option<String>,
}

// ---- Handler ----

/// GET /api/teacher/dashboard?teacher_id=X
pub async fn teacher_dashboard(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<TeacherDashboardQuery>,
) -> Result<Json<TeacherDashboardResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let teacher_id = &query.teacher_id;

    // Fetch cleared-at timestamps for filtering
    let cleared: Option<ClearedTimestamps> = sqlx::query_as(
        "SELECT attention_cleared_at, activity_cleared_at FROM users WHERE id = ?",
    )
    .bind(teacher_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let attention_cleared_at = cleared.as_ref().and_then(|c| c.attention_cleared_at.clone());
    let activity_cleared_at = cleared.as_ref().and_then(|c| c.activity_cleared_at.clone());

    // 1. Fetch teacher's classrooms with member counts
    let classrooms: Vec<ClassroomRow> = sqlx::query_as(
        r#"
        SELECT c.id, c.name, c.join_code,
               (SELECT COUNT(*) FROM classroom_members cm WHERE cm.classroom_id = c.id) as member_count
        FROM classrooms c
        WHERE c.teacher_id = ?
        ORDER BY c.created_at DESC
        "#,
    )
    .bind(teacher_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let now = chrono::Utc::now();
    let seven_days_ago = (now - chrono::Duration::days(7)).to_rfc3339();
    let seven_days_ahead = (now + chrono::Duration::days(7)).to_rfc3339();

    let mut dashboard_classrooms = Vec::new();
    let mut needs_attention: Vec<AttentionItem> = Vec::new();
    let mut recent_activity: Vec<ActivityEvent> = Vec::new();

    for classroom in &classrooms {
        // 2. Fetch assignments for this classroom
        let assignments: Vec<AssignmentRow> = sqlx::query_as(
            r#"
            SELECT a.id, a.exercise_id, e.name as exercise_name, a.due_at, a.assigned_at
            FROM assignments a
            JOIN exercises e ON e.id = a.exercise_id
            WHERE a.classroom_id = ? AND a.closed_at IS NULL
            ORDER BY a.assigned_at DESC
            "#,
        )
        .bind(&classroom.id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        // 3. Fetch members for this classroom
        let members: Vec<MemberRow> = sqlx::query_as(
            r#"
            SELECT cm.student_id, u.first_name, u.last_name, cm.joined_at
            FROM classroom_members cm
            JOIN users u ON u.id = cm.student_id
            WHERE cm.classroom_id = ?
            "#,
        )
        .bind(&classroom.id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        // 4. Compute per-assignment completion
        let mut dash_assignments = Vec::new();
        let mut total_completion_sum: i64 = 0;
        let mut assignment_count: i64 = 0;

        for assignment in &assignments {
            // Get board count for this exercise
            let (total_boards,): (i64,) = sqlx::query_as(
                "SELECT COUNT(*) FROM exercise_boards WHERE exercise_id = ?",
            )
            .bind(&assignment.exercise_id)
            .fetch_one(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            if total_boards == 0 {
                continue;
            }

            let students_total = members.len() as i64;
            let mut students_completed: i64 = 0;

            for member in &members {
                // For each student, count how many boards they've attempted and gotten correct
                let obs: Vec<ObservationHit> = sqlx::query_as(
                    r#"
                    SELECT DISTINCT o.deal_subfolder, o.deal_number, o.correct
                    FROM observations o
                    WHERE o.user_id = ?
                      AND o.timestamp >= ?
                      AND (o.deal_subfolder, o.deal_number) IN (
                          SELECT deal_subfolder, deal_number FROM exercise_boards WHERE exercise_id = ?
                      )
                    "#,
                )
                .bind(&member.student_id)
                .bind(&assignment.assigned_at)
                .bind(&assignment.exercise_id)
                .fetch_all(&state.db)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

                // Deduplicate by board: count distinct boards attempted
                let mut attempted_boards = std::collections::HashSet::new();
                let mut correct_boards = std::collections::HashSet::new();
                for o in &obs {
                    let key = format!("{}/{}", o.deal_subfolder, o.deal_number);
                    attempted_boards.insert(key.clone());
                    if o.correct {
                        correct_boards.insert(key);
                    }
                }

                let attempted = attempted_boards.len() as i64;

                if attempted >= total_boards {
                    students_completed += 1;

                    // Check if this is a recent completion (for activity feed)
                    // Find the most recent observation for this student on this exercise
                    let latest_obs: Option<(String,)> = sqlx::query_as(
                        r#"
                        SELECT MAX(o.timestamp) as ts
                        FROM observations o
                        WHERE o.user_id = ?
                          AND o.timestamp >= ?
                          AND (o.deal_subfolder, o.deal_number) IN (
                              SELECT deal_subfolder, deal_number FROM exercise_boards WHERE exercise_id = ?
                          )
                        "#,
                    )
                    .bind(&member.student_id)
                    .bind(&assignment.assigned_at)
                    .bind(&assignment.exercise_id)
                    .fetch_optional(&state.db)
                    .await
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

                    if let Some((ts,)) = latest_obs {
                        let not_cleared = match &activity_cleared_at {
                            Some(cleared) => ts > *cleared,
                            None => true,
                        };
                        if ts >= seven_days_ago && not_cleared {
                            recent_activity.push(ActivityEvent {
                                event_type: "assignment_completed".to_string(),
                                student_name: Some(format!(
                                    "{} {}",
                                    member.first_name, member.last_name
                                )),
                                exercise_name: Some(assignment.exercise_name.clone()),
                                classroom_name: classroom.name.clone(),
                                timestamp: ts,
                            });
                        }
                    }
                }
            }

            // Completion percentage for this assignment
            let completion_pct = if students_total > 0 {
                (students_completed * 100) / students_total
            } else {
                0
            };
            total_completion_sum += completion_pct;
            assignment_count += 1;

            dash_assignments.push(DashboardAssignment {
                id: assignment.id.clone(),
                exercise_name: assignment.exercise_name.clone(),
                due_at: assignment.due_at.clone(),
                total_boards,
                students_completed,
                students_total,
            });

            // Check for "due_soon" attention items
            if let Some(ref due_at) = assignment.due_at {
                let now_str = now.to_rfc3339();
                if due_at > &now_str && due_at <= &seven_days_ahead {
                    let lagging = students_total - students_completed;
                    let not_cleared = match &attention_cleared_at {
                        Some(cleared) => assignment.assigned_at > *cleared,
                        None => true,
                    };
                    if lagging > 0 && not_cleared {
                        needs_attention.push(AttentionItem {
                            item_type: "due_soon".to_string(),
                            assignment_id: Some(assignment.id.clone()),
                            exercise_name: Some(assignment.exercise_name.clone()),
                            classroom_name: classroom.name.clone(),
                            student_name: None,
                            due_at: Some(due_at.clone()),
                            lagging_count: Some(lagging),
                            total_students: Some(students_total),
                            accuracy_pct: None,
                            joined_at: None,
                        });
                    }
                }
            }

            // Check for "low_score" attention items (students with < 50% accuracy)
            if students_total > 0 && total_boards > 0 {
                for member in &members {
                    let obs: Vec<ObservationHit> = sqlx::query_as(
                        r#"
                        SELECT DISTINCT o.deal_subfolder, o.deal_number, o.correct
                        FROM observations o
                        WHERE o.user_id = ?
                          AND o.timestamp >= ?
                          AND (o.deal_subfolder, o.deal_number) IN (
                              SELECT deal_subfolder, deal_number FROM exercise_boards WHERE exercise_id = ?
                          )
                        "#,
                    )
                    .bind(&member.student_id)
                    .bind(&assignment.assigned_at)
                    .bind(&assignment.exercise_id)
                    .fetch_all(&state.db)
                    .await
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

                    let mut attempted = std::collections::HashSet::new();
                    let mut correct = std::collections::HashSet::new();
                    for o in &obs {
                        let key = format!("{}/{}", o.deal_subfolder, o.deal_number);
                        attempted.insert(key.clone());
                        if o.correct {
                            correct.insert(key);
                        }
                    }

                    let attempted_count = attempted.len();
                    let correct_count = correct.len();

                    // Only flag if they've attempted at least half the boards and accuracy is low
                    if attempted_count >= (total_boards as usize / 2) && attempted_count > 0 {
                        let accuracy = (correct_count * 100) / attempted_count;
                        let not_cleared = match &attention_cleared_at {
                            Some(cleared) => assignment.assigned_at > *cleared,
                            None => true,
                        };
                        if accuracy < 50 && not_cleared {
                            needs_attention.push(AttentionItem {
                                item_type: "low_score".to_string(),
                                assignment_id: Some(assignment.id.clone()),
                                exercise_name: Some(assignment.exercise_name.clone()),
                                classroom_name: classroom.name.clone(),
                                student_name: Some(format!(
                                    "{} {}",
                                    member.first_name, member.last_name
                                )),
                                due_at: None,
                                lagging_count: None,
                                total_students: None,
                                accuracy_pct: Some(accuracy as i64),
                                joined_at: None,
                            });
                        }
                    }
                }
            }
        }

        // Average completion across all assignments
        let avg_completion_pct = if assignment_count > 0 {
            total_completion_sum / assignment_count
        } else {
            0
        };

        // Recent joins (last 7 days) — activity only, not attention
        for member in &members {
            if member.joined_at >= seven_days_ago {
                let not_cleared = match &activity_cleared_at {
                    Some(cleared) => member.joined_at > *cleared,
                    None => true,
                };
                if not_cleared {
                    recent_activity.push(ActivityEvent {
                        event_type: "student_joined".to_string(),
                        student_name: Some(format!("{} {}", member.first_name, member.last_name)),
                        exercise_name: None,
                        classroom_name: classroom.name.clone(),
                        timestamp: member.joined_at.clone(),
                    });
                }
            }
        }

        dashboard_classrooms.push(DashboardClassroom {
            id: classroom.id.clone(),
            name: classroom.name.clone(),
            join_code: classroom.join_code.clone(),
            member_count: classroom.member_count,
            open_assignment_count: assignments.len() as i64,
            avg_completion_pct,
            assignments: dash_assignments,
        });
    }

    // Sort needs_attention: due_soon first, then low_score
    needs_attention.sort_by(|a, b| {
        let priority = |t: &str| match t {
            "due_soon" => 0,
            "low_score" => 1,
            _ => 2,
        };
        priority(&a.item_type).cmp(&priority(&b.item_type))
    });
    needs_attention.truncate(10);

    // Sort recent_activity by timestamp descending
    recent_activity.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    recent_activity.truncate(20);

    Ok(Json(TeacherDashboardResponse {
        success: true,
        classrooms: dashboard_classrooms,
        needs_attention,
        recent_activity,
    }))
}

/// POST /api/teacher/dashboard/clear
pub async fn clear_dashboard_panel(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ClearPanelRequest>,
) -> Result<Json<ClearPanelResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let now = chrono::Utc::now().to_rfc3339();
    let column = match body.panel.as_str() {
        "attention" => "attention_cleared_at",
        "activity" => "activity_cleared_at",
        _ => return Err((StatusCode::BAD_REQUEST, "Invalid panel name".to_string())),
    };

    let query = format!("UPDATE users SET {} = ? WHERE id = ?", column);
    sqlx::query(&query)
        .bind(&now)
        .bind(&body.teacher_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(ClearPanelResponse { success: true }))
}

use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Assignment stored in the database
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Assignment {
    pub id: String,
    pub exercise_id: String,
    pub classroom_id: Option<String>,
    pub student_id: Option<String>,
    pub assigned_by: String,
    pub assigned_at: String,
    pub due_at: Option<String>,
    pub sort_order: Option<i32>,
}

/// Request to create an assignment
#[derive(Debug, Deserialize)]
pub struct CreateAssignmentRequest {
    pub exercise_id: String,
    pub classroom_id: Option<String>,
    pub student_id: Option<String>,
    pub assigned_by: String,
    pub due_at: Option<String>,
    pub sort_order: Option<i32>,
}

/// Query parameters for listing assignments
#[derive(Debug, Deserialize)]
pub struct AssignmentQuery {
    pub classroom_id: Option<String>,
    pub student_id: Option<String>,
    pub assigned_by: Option<String>,
}

/// Assignment info with computed progress (for listings).
///
/// Issue #7 phase 4 (time/participation analytics): the listing rolls
/// up per-student stats so the AssignmentsTab can render box-and-whisker
/// charts for clean-rate and active-duration distributions plus a
/// participation bar. The arrays are intentionally raw (one entry per
/// attempted student); the frontend computes quartiles/median for the
/// boxplots. Active duration excludes idle gaps > 5 min between plays.
#[derive(Debug, Serialize)]
pub struct AssignmentInfo {
    pub id: String,
    pub exercise_name: String,
    pub exercise_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub classroom_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub classroom_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub student_id: Option<String>,
    /// Denormalized student display name for individual assignments
    /// (`student_id IS NOT NULL`). Lets the lobby show "Terry Lee"
    /// where it would otherwise show the classroom name. Null for
    /// classroom assignments.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub student_name: Option<String>,
    pub assigned_by: String,
    pub assigned_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_at: Option<String>,
    pub total_boards: i64,
    pub attempted_boards: i64,
    pub correct_boards: i64,
    /// Total potential students (classroom membership count, or 1 for
    /// individual assignments). Denominator for participation_rate.
    pub student_count: i64,
    /// Distinct students with at least one observation in this assignment.
    pub student_count_attempted: i64,
    /// Per-student clean-correct rate (0.0-1.0) for students who
    /// attempted, sorted ascending. clean_correct boards ÷ attempted boards.
    pub clean_rates: Vec<f64>,
    /// Per-student active duration in seconds for students who
    /// attempted, sorted ascending. Sum of gaps between consecutive
    /// observation submissions, excluding gaps > 5 minutes (treated
    /// as student-away-from-app idle time).
    pub active_durations_sec: Vec<i64>,
}

/// Per-student progress within a classroom assignment
#[derive(Debug, Serialize)]
pub struct StudentAssignmentProgress {
    pub student_id: String,
    pub first_name: String,
    pub last_name: String,
    pub attempted_boards: i64,
    pub correct_boards: i64,
    pub total_boards: i64,
    /// Total active time this student has spent on this assignment,
    /// in seconds. Sum of `time_taken_ms` across their observations,
    /// scaled to seconds. Issue #7.
    pub active_duration_sec: i64,
}

/// One column header in the assignment grid view (issue #7).
#[derive(Debug, Clone, sqlx::FromRow, Serialize)]
pub struct AssignmentGridBoard {
    pub deal_subfolder: String,
    pub deal_number: i32,
    pub sort_order: i32,
}

/// One cell in the assignment grid: the most recent observation a
/// student has logged for a given board within this assignment.
/// `status` matches the §5.1 stored values. Cells for (student, board)
/// pairs with no observation are omitted — the frontend renders those
/// as `not_attempted` (grey).
#[derive(Debug, Clone, sqlx::FromRow, Serialize)]
pub struct AssignmentGridCell {
    pub student_id: String,
    pub deal_subfolder: String,
    pub deal_number: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    pub correct: bool,
    pub observation_id: String,
    pub timestamp: String,
}

/// Assignment detail with per-student progress (for teacher drill-down)
#[derive(Debug, Serialize)]
pub struct AssignmentDetail {
    pub id: String,
    pub exercise_name: String,
    pub exercise_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub classroom_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub classroom_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub student_id: Option<String>,
    pub assigned_by: String,
    pub assigned_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_at: Option<String>,
    pub total_boards: i64,
    pub student_progress: Vec<StudentAssignmentProgress>,
    /// Ordered list of boards in this assignment's exercise (column headers).
    pub boards: Vec<AssignmentGridBoard>,
    /// Per-(student, board) outcome for the grid (issue #7).
    pub cells: Vec<AssignmentGridCell>,
}

/// Response after creating an assignment
#[derive(Debug, Serialize)]
pub struct CreateAssignmentResponse {
    pub success: bool,
    pub assignment: AssignmentInfo,
}

/// Response containing list of assignments
#[derive(Debug, Serialize)]
pub struct AssignmentListResponse {
    pub success: bool,
    pub assignments: Vec<AssignmentInfo>,
}

/// Response containing assignment detail
#[derive(Debug, Serialize)]
pub struct AssignmentDetailResponse {
    pub success: bool,
    pub assignment: AssignmentDetail,
}

/// Generic response for assignment actions
#[derive(Debug, Serialize)]
pub struct AssignmentActionResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

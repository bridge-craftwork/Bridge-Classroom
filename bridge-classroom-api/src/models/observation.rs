use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Observation stored in the database
/// encrypted_data is AES-256-GCM encrypted with the student's secret key
/// Viewers get the key through sharing grants, not per-observation key blobs
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Observation {
    pub id: String,
    pub user_id: String,
    pub timestamp: String,
    pub skill_path: String,
    pub correct: bool,
    pub classroom: Option<String>,
    pub deal_subfolder: Option<String>,
    pub deal_number: Option<i32>,
    pub encrypted_data: String,
    pub iv: String,
    pub created_at: String,
    pub board_result: Option<String>,
    // Correctness & Mastery v2 — see CORRECTNESS_AND_MASTERY.md §11/§5.
    // `status` is null until the recompute walker fills it in.
    // `wilderness` is derived at insert time from the three context fields below.
    pub status: Option<String>,
    pub wilderness: Option<String>,
    pub exercise_id: Option<String>,
    pub assignment_id: Option<String>,
    pub jungle: bool,
    /// Total time spent on the board, ms. Lifted from the encrypted
    /// blob so the analytics path doesn't need decryption (issue #7).
    pub time_taken_ms: Option<i64>,
}

/// Metadata-only observation (for dashboard queries)
#[derive(Debug, Clone, Serialize)]
pub struct ObservationMetadata {
    pub observation_id: String,
    pub user_id: String,
    pub timestamp: String,
    pub skill_path: String,
    pub correct: bool,
    pub classroom: Option<String>,
    pub deal_subfolder: Option<String>,
    pub deal_number: Option<i32>,
    pub board_result: Option<String>,
}

impl From<Observation> for ObservationMetadata {
    fn from(obs: Observation) -> Self {
        ObservationMetadata {
            observation_id: obs.id,
            user_id: obs.user_id,
            timestamp: obs.timestamp,
            skill_path: obs.skill_path,
            correct: obs.correct,
            classroom: obs.classroom,
            deal_subfolder: obs.deal_subfolder,
            deal_number: obs.deal_number,
            board_result: obs.board_result,
        }
    }
}

/// Encrypted observation as received from the client
#[derive(Debug, Deserialize)]
pub struct EncryptedObservation {
    pub encrypted_data: String,
    pub iv: String,
    pub metadata: ObservationMetadataInput,
}

/// Metadata sent with encrypted observation
#[derive(Debug, Deserialize)]
pub struct ObservationMetadataInput {
    pub observation_id: String,
    pub user_id: String,
    pub timestamp: String,
    pub skill_path: String,
    pub correct: bool,
    pub classroom: Option<String>,
    pub deal_subfolder: Option<String>,
    pub deal_number: Option<i32>,
    pub board_result: Option<String>,
    // Correctness & Mastery v2 context — see CORRECTNESS_AND_MASTERY.md §11.1.
    // All three default to None/false for clients that haven't been updated yet.
    #[serde(default)]
    pub exercise_id: Option<String>,
    #[serde(default)]
    pub assignment_id: Option<String>,
    #[serde(default)]
    pub jungle: bool,
    /// Total time the student spent on this board, in ms. Sum of
    /// per-prompt times computed by the frontend. None for clients
    /// that haven't been updated; the historical-data startup
    /// backfill populates the column from the encrypted blob.
    /// Issue #7.
    #[serde(default)]
    pub time_taken_ms: Option<i64>,
}

/// Request to submit observations
#[derive(Debug, Deserialize)]
pub struct SubmitObservationsRequest {
    pub observations: Vec<EncryptedObservation>,
}

/// Response after submitting observations
#[derive(Debug, Serialize)]
pub struct SubmitObservationsResponse {
    pub received: usize,
    pub stored: usize,
    pub errors: Vec<String>,
}

/// Query parameters for fetching observations
#[derive(Debug, Deserialize)]
pub struct ObservationQuery {
    pub user_id: Option<String>,
    pub classroom: Option<String>,
    pub skill_path: Option<String>,
    pub correct: Option<bool>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub limit: Option<i32>,
    pub offset: Option<i32>,
}

impl Default for ObservationQuery {
    fn default() -> Self {
        ObservationQuery {
            user_id: None,
            classroom: None,
            skill_path: None,
            correct: None,
            from: None,
            to: None,
            limit: Some(100),
            offset: Some(0),
        }
    }
}

/// Response containing observations
#[derive(Debug, Serialize)]
pub struct ObservationsResponse {
    pub observations: Vec<Observation>,
    pub total: i64,
    pub limit: i32,
    pub offset: i32,
}

/// Response containing only metadata
#[derive(Debug, Serialize)]
pub struct ObservationsMetadataResponse {
    pub observations: Vec<ObservationMetadata>,
    pub total: i64,
}

impl Observation {
    /// Create an observation from an encrypted submission. `wilderness`
    /// and `status` are left None here; the route handler computes
    /// wilderness from the context fields before insert, and the
    /// recompute walker fills status afterwards.
    pub fn from_encrypted(enc: EncryptedObservation) -> Self {
        let now = chrono::Utc::now().to_rfc3339();

        Observation {
            id: enc.metadata.observation_id,
            user_id: enc.metadata.user_id,
            timestamp: enc.metadata.timestamp,
            skill_path: enc.metadata.skill_path,
            correct: enc.metadata.correct,
            classroom: enc.metadata.classroom,
            deal_subfolder: enc.metadata.deal_subfolder,
            deal_number: enc.metadata.deal_number,
            board_result: enc.metadata.board_result,
            encrypted_data: enc.encrypted_data,
            iv: enc.iv,
            created_at: now,
            status: None,
            wilderness: None,
            exercise_id: enc.metadata.exercise_id,
            assignment_id: enc.metadata.assignment_id,
            jungle: enc.metadata.jungle,
            time_taken_ms: enc.metadata.time_taken_ms,
        }
    }
}

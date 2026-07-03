use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// A club-game list row — metadata only, no `payload` (the normalized JSON can
/// be large). `payload_bytes` lets the client show a size without shipping it.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ClubGameSummary {
    pub id: String,
    pub owner: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub board_count: Option<i64>,
    pub payload_bytes: i64,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

/// A full club game including the native normalized JSON `payload`.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ClubGameDetail {
    pub id: String,
    pub owner: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub board_count: Option<i64>,
    pub payload: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

/// Save (upsert) a club game. When `event_key` matches an existing live game for
/// the same `owner`, that row is updated (re-loading a game doesn't duplicate
/// it); otherwise a new row is inserted.
#[derive(Debug, Deserialize)]
pub struct SaveClubGameRequest {
    pub owner: String,
    pub event_key: Option<String>,
    pub event_name: Option<String>,
    pub event_date: Option<String>,
    pub location: Option<String>,
    pub board_count: Option<i64>,
    /// The extractor's native normalized JSON (incl. analysis rollups).
    pub payload: String,
}

/// Query params for listing (`owner` required — never list another user's games).
#[derive(Debug, Deserialize)]
pub struct ClubGameQuery {
    pub owner: String,
}

/// Query params for the owner-checked DELETE.
#[derive(Debug, Deserialize)]
pub struct DeleteClubGameQuery {
    pub actor_user_id: String,
}

#[derive(Debug, Serialize)]
pub struct ClubGameListResponse {
    pub success: bool,
    pub games: Vec<ClubGameSummary>,
}

#[derive(Debug, Serialize)]
pub struct ClubGameDetailResponse {
    pub success: bool,
    pub game: ClubGameDetail,
}

#[derive(Debug, Serialize)]
pub struct SaveClubGameResponse {
    pub success: bool,
    /// The id of the saved (inserted or updated) game.
    pub id: String,
    /// True when an existing game was updated rather than a new one inserted.
    pub updated: bool,
}

#[derive(Debug, Serialize)]
pub struct ClubGameActionResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// A metadata row of the deal library — everything EXCEPT the (potentially
/// large) `payload`. Used by the list endpoint so a teacher's whole tree
/// comes back cheaply; the full PBN/descriptor is fetched per-entry via the
/// detail endpoint. `has_payload`/`payload_bytes` let the client show
/// "24 boards ≈ 4KB" without shipping the text.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct DealLibraryEntry {
    pub id: String,
    pub owner: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    pub kind: String,
    pub name: String,
    /// Per-entry JSON blob (rotate / mode / bot) applied when dealt. Raw
    /// JSON text — the client parses it. NULL on folders.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings: Option<String>,
    pub sort_order: i64,
    pub has_payload: bool,
    pub payload_bytes: i64,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

/// A full library entry including the `payload` (PBN text for files, JSON
/// descriptor for links, NULL for folders). Returned by the detail endpoint.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct DealLibraryEntryDetail {
    pub id: String,
    pub owner: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    pub kind: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

/// Create a library entry (folder / file / link).
#[derive(Debug, Deserialize)]
pub struct CreateDealLibraryRequest {
    /// The owning teacher. Required — the library is strictly per-teacher.
    pub owner: String,
    pub parent_id: Option<String>,
    pub kind: String,
    pub name: String,
    /// PBN text (file) or JSON descriptor (link). Must be absent/NULL for
    /// folders; required for file/link.
    pub payload: Option<String>,
    /// Per-entry settings JSON (rotate / mode / bot). Optional.
    pub settings: Option<String>,
    pub sort_order: Option<i64>,
}

/// Update a library entry (owner-checked). All fields optional — only the
/// provided ones change. `parent_id` moves the entry (re-parenting);
/// `Some(None)` moves it to the root, `None` leaves it where it is.
#[derive(Debug, Deserialize)]
pub struct UpdateDealLibraryRequest {
    /// Caller's user_id — must match the entry's `owner`.
    pub actor_user_id: String,
    pub name: Option<String>,
    /// Double option: outer `Some` means "change parent", inner value is the
    /// new parent (`None` = move to root).
    #[serde(default, deserialize_with = "crate::models::deserialize_optional_field")]
    pub parent_id: Option<Option<String>>,
    pub payload: Option<String>,
    #[serde(default, deserialize_with = "crate::models::deserialize_optional_field")]
    pub settings: Option<Option<String>>,
    pub sort_order: Option<i64>,
}

/// Query params for listing (`owner` required — never list another
/// teacher's library).
#[derive(Debug, Deserialize)]
pub struct DealLibraryQuery {
    pub owner: String,
    /// Optional: restrict to direct children of this folder. Omit for the
    /// whole flat tree (client assembles the hierarchy).
    pub parent_id: Option<String>,
}

/// Query params for the owner-checked DELETE.
#[derive(Debug, Deserialize)]
pub struct DeleteDealLibraryQuery {
    pub actor_user_id: String,
}

#[derive(Debug, Serialize)]
pub struct DealLibraryListResponse {
    pub success: bool,
    pub entries: Vec<DealLibraryEntry>,
}

#[derive(Debug, Serialize)]
pub struct DealLibraryEntryResponse {
    pub success: bool,
    pub entry: DealLibraryEntryDetail,
}

#[derive(Debug, Serialize)]
pub struct DealLibraryActionResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

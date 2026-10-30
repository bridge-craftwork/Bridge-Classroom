use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Convention card stored in the database
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ConventionCard {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub format: String,
    pub owner_id: Option<String>,
    pub card_data: String, // JSON string
    pub visibility: String,
    pub created_at: String,
    pub updated_at: String,
    /// Save counter: 1 when created, +1 on every update.
    pub version: i64,
}

/// User-card link stored in the database
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct UserConventionCard {
    pub id: String,
    pub user_id: String,
    pub card_id: String,
    pub is_primary: bool,
    pub label: Option<String>,
    pub linked_at: String,
}

/// Request to create a new convention card
#[derive(Debug, Deserialize)]
pub struct CreateConventionCardRequest {
    pub name: String,
    pub description: Option<String>,
    pub card_data: serde_json::Value, // Accept JSON object
    pub visibility: Option<String>,   // private, shared, public
    /// User performing the create. Required. Public-visibility cards
    /// further require this user's role to be 'admin'.
    pub acting_user_id: String,
}

/// Response after creating a convention card
#[derive(Debug, Serialize)]
pub struct CreateConventionCardResponse {
    pub success: bool,
    pub card_id: String,
}

/// Request to update an existing convention card. All fields except
/// `acting_user_id` are optional — only the provided ones are written.
#[derive(Debug, Deserialize)]
pub struct UpdateConventionCardRequest {
    pub acting_user_id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub card_data: Option<serde_json::Value>,
    pub visibility: Option<String>,
    /// The card version this edit started from. When given and the card has
    /// been saved since, the update is refused with 409 and the current card,
    /// so the editor can merge. Omitted: the update overwrites (an import or a
    /// rename that means to replace).
    #[serde(default)]
    pub base_version: Option<i64>,
}

/// Response after updating a convention card.
#[derive(Debug, Serialize)]
pub struct UpdateConventionCardResponse {
    pub success: bool,
    /// The card's version after this save.
    pub version: i64,
}

/// One saved version in a card's history.
#[derive(Debug, Serialize, FromRow)]
pub struct CardVersionInfo {
    pub version: i64,
    pub saved_by: Option<String>,
    /// The saver's name, when they're still a known user.
    pub saved_by_name: Option<String>,
    pub saved_at: String,
}

/// A card's history, newest first.
#[derive(Debug, Serialize)]
pub struct CardVersionsResponse {
    pub versions: Vec<CardVersionInfo>,
}

/// One saved version's card_data.
#[derive(Debug, Serialize)]
pub struct CardVersionData {
    pub version: i64,
    pub card_data: serde_json::Value,
    pub saved_by: Option<String>,
    pub saved_at: String,
}

/// Request to link a card to a user
#[derive(Debug, Deserialize)]
pub struct LinkCardRequest {
    pub card_id: String,
    pub is_primary: Option<bool>,
    pub label: Option<String>,
    /// User performing the link. Required when linking a private card —
    /// must be the card's owner or an admin. Omittable when linking a
    /// public card.
    #[serde(default)]
    pub acting_user_id: Option<String>,
}

/// Response after linking a card
#[derive(Debug, Serialize)]
pub struct LinkCardResponse {
    pub success: bool,
    pub link_id: String,
}

/// Convention card info for API responses (without full card_data)
#[derive(Debug, Serialize)]
pub struct ConventionCardInfo {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub format: String,
    pub owner_id: Option<String>,
    pub visibility: String,
    pub created_at: String,
    pub updated_at: String,
    pub is_system_card: bool,
}

/// Full convention card with parsed data for API responses
#[derive(Debug, Serialize)]
pub struct ConventionCardFull {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub format: String,
    pub owner_id: Option<String>,
    pub card_data: serde_json::Value,
    pub visibility: String,
    pub created_at: String,
    pub updated_at: String,
    pub is_system_card: bool,
    pub version: i64,
}

/// User's linked cards response
#[derive(Debug, Serialize)]
pub struct UserCardsResponse {
    pub cards: Vec<UserCardInfo>,
}

/// Info about a user's linked card
#[derive(Debug, Serialize)]
pub struct UserCardInfo {
    pub link_id: String,
    pub card_id: String,
    pub card_name: String,
    pub is_primary: bool,
    pub label: Option<String>,
    pub linked_at: String,
    /// The user's role on the card: owner, editor or viewer.
    pub role: String,
    /// How many people have the card on their list (1 = not shared).
    pub member_count: i64,
}

impl ConventionCard {
    /// Create a new card from a request
    pub fn from_request(req: &CreateConventionCardRequest, owner_id: Option<String>) -> Self {
        let now = Utc::now().to_rfc3339();

        ConventionCard {
            id: uuid::Uuid::new_v4().to_string(),
            name: req.name.clone(),
            description: req.description.clone(),
            format: "bridge_classroom".to_string(),
            owner_id,
            card_data: req.card_data.to_string(),
            visibility: req
                .visibility
                .clone()
                .unwrap_or_else(|| "private".to_string()),
            created_at: now.clone(),
            updated_at: now,
            version: 1,
        }
    }
}

impl From<ConventionCard> for ConventionCardInfo {
    fn from(card: ConventionCard) -> Self {
        ConventionCardInfo {
            id: card.id,
            name: card.name,
            description: card.description,
            format: card.format,
            owner_id: card.owner_id.clone(),
            visibility: card.visibility,
            created_at: card.created_at,
            updated_at: card.updated_at,
            is_system_card: card.owner_id.is_none(),
        }
    }
}

impl ConventionCard {
    /// Convert to full response with parsed JSON data
    pub fn to_full(&self) -> Result<ConventionCardFull, serde_json::Error> {
        let card_data: serde_json::Value = serde_json::from_str(&self.card_data)?;
        Ok(ConventionCardFull {
            id: self.id.clone(),
            name: self.name.clone(),
            description: self.description.clone(),
            format: self.format.clone(),
            owner_id: self.owner_id.clone(),
            card_data,
            visibility: self.visibility.clone(),
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
            is_system_card: self.owner_id.is_none(),
            version: self.version,
        })
    }
}

// Several structs here (Assignment, Classroom, ClassroomMember, Exercise,
// UserConventionCard, and viewer's recovery_encrypted_private_key) are never
// constructed: they mirror the DB schema, but the routes read rows into inline
// `query_as` tuples instead. They're kept as the typed description of each
// table rather than deleted — whether to drop them or migrate the routes onto
// them is a real decision, not one to make inside the PR that introduced CI.
#![allow(dead_code)]

mod assignment;
mod classroom;
mod club_game;
mod convention_card;
mod deal_library;
mod exercise;
mod grant;
mod observation;
mod user;
mod viewer;

pub use assignment::*;
pub use classroom::*;
pub use club_game::*;
pub use convention_card::*;
pub use deal_library::*;
pub use exercise::*;
pub use grant::*;
pub use observation::*;
pub use user::*;
pub use viewer::*;

use serde::{Deserialize, Deserializer};

/// Deserialize a nullable field into a double `Option`, distinguishing
/// "key absent" (`None`) from "key present but null" (`Some(None)`). Pair
/// with `#[serde(default, deserialize_with = "...")]` on an
/// `Option<Option<T>>` field so PATCH-style updates can tell "leave
/// unchanged" apart from "clear to NULL" (e.g. move an entry to the root,
/// or wipe its settings).
pub fn deserialize_optional_field<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Ok(Some(Option::<T>::deserialize(deserializer)?))
}

mod assignment;
mod classroom;
mod convention_card;
mod deal_library;
mod exercise;
mod grant;
mod observation;
mod user;
mod viewer;

pub use assignment::*;
pub use classroom::*;
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
pub fn deserialize_optional_field<'de, T, D>(
    deserializer: D,
) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Ok(Some(Option::<T>::deserialize(deserializer)?))
}

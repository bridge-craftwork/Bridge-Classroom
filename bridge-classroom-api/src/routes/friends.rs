//! Friendships and friend requests (ADR-0005).
//!
//! A friendship is a single **undirected** edge between two enrolled accounts,
//! created only by mutual consent: one party proposes, the other accepts. Either
//! may remove it unilaterally, and removal is **silent** — the other side simply
//! stops seeing them.
//!
//! # Three rules worth stating up front
//!
//! 1. **Authorization is roster membership, never a client-supplied id.** Every
//!    handler takes an `acting_user_id` and runs it through
//!    [`require_roster_member`], which proves the caller's device session actually
//!    contains that user (ADR-0004 §3a). Without that, these endpoints would be a
//!    fresh IDOR surface: "send a friend request *as* anyone."
//! 2. **No user search, by design.** A request can only be addressed to a
//!    `user_id` the caller already holds from a shared context — in practice a
//!    co-player at a table. There is deliberately no lookup-by-email or
//!    by-name endpoint: that would recreate exactly the global directory
//!    ADR-0005 exists to reject, letting anyone probe whether a given real person
//!    holds an account.
//! 3. **Name only, never email.** ADR-0005 §5 as revised: friendship discloses a
//!    display name. Email is the one irreversible disclosure in a one-click accept
//!    flow, so it stays out of every response here.
//!
//! Guests are unreachable from this module by construction — `friendships`
//! endpoints resolve against `users`, and a guest has no `users` row.
//!
//! # Re-requesting after a decline is allowed
//!
//! A declined request does **not** bar a later one. The tempting design — treat
//! a decline as "never ask again" — gets the likelier failure mode backwards for
//! this user base: someone declines because an unexpected prompt appeared and
//! they didn't know what it meant, and is then permanently unfriendable with no
//! way to undo it, and no way for either party to even see why. Repeat-request
//! noise is the lesser problem, and it's already bounded by the rate limit and
//! the outstanding-request ceiling below.
//!
//! `declined` rows are still retained, but purely as history — they no longer
//! suppress anything. **Blocking is deliberately not implemented at this stage**
//! (ADR-0005 leaves it open); if it ever arrives it should be an explicit,
//! visible action a user takes, not an invisible side effect of one decline.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Instant;

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::routes::session::require_roster_member;
use crate::AppState;

// ---- Abuse controls ----
//
// A real-name social graph needs these from day one; they're far more awkward to
// retrofit once people have lists. Cheap in-memory limiter, same shape as the
// §S4 pattern used elsewhere.

/// Max friend requests one user may send per window.
const REQUEST_MAX_PER_WINDOW: u32 = 20;
const REQUEST_WINDOW_SECS: u64 = 3600;

/// Ceiling on simultaneously-outstanding outbound requests. Bounds the blast
/// radius of an account that decides to request everyone it has ever sat with.
const MAX_OUTSTANDING_REQUESTS: i64 = 50;

static REQUEST_LIMITER: LazyLock<Mutex<HashMap<String, (Instant, u32)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn allow_request(user_id: &str) -> bool {
    let mut m = REQUEST_LIMITER.lock().unwrap_or_else(|e| e.into_inner());
    let now = Instant::now();
    m.retain(|_, (start, _)| now.duration_since(*start).as_secs() < REQUEST_WINDOW_SECS);
    let entry = m.entry(user_id.to_string()).or_insert((now, 0));
    if now.duration_since(entry.0).as_secs() >= REQUEST_WINDOW_SECS {
        *entry = (now, 0);
    }
    entry.1 += 1;
    entry.1 <= REQUEST_MAX_PER_WINDOW
}

// ---- Canonical edge ordering ----

/// Order a pair so the edge has exactly one representation. The `friendships`
/// PK plus its `CHECK (user_a_id < user_b_id)` means a half-edge — A-friends-B
/// without B-friends-A — is not merely disallowed but unrepresentable.
fn canonical_pair<'a>(x: &'a str, y: &'a str) -> (&'a str, &'a str) {
    if x < y {
        (x, y)
    } else {
        (y, x)
    }
}

// ---- Shapes ----

#[derive(Debug, Deserialize)]
pub struct ActingUserQuery {
    /// The roster member acting. Proven against the session cookie — never
    /// trusted as given.
    pub acting_user_id: String,
}

#[derive(Debug, Serialize)]
pub struct Friend {
    pub user_id: String,
    /// Display name only. Deliberately no email — see the module docs.
    pub name: String,
    pub friends_since: String,
}

#[derive(Debug, Serialize)]
pub struct FriendsResponse {
    pub success: bool,
    pub friends: Vec<Friend>,
}

#[derive(Debug, Serialize)]
pub struct FriendRequestInfo {
    pub id: String,
    /// The other party — sender for inbound, recipient for outbound.
    pub user_id: String,
    pub name: String,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct RequestsResponse {
    pub success: bool,
    pub incoming: Vec<FriendRequestInfo>,
    pub outgoing: Vec<FriendRequestInfo>,
}

#[derive(Debug, Deserialize)]
pub struct CreateRequestBody {
    pub acting_user_id: String,
    /// Addressed by id the caller already holds (a table co-player). There is no
    /// search endpoint that could produce this — see the module docs.
    pub to_user_id: String,
}

fn db_err<E: std::fmt::Display>(e: E) -> (StatusCode, String) {
    tracing::error!("friends query failed: {e}");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        "database error".to_string(),
    )
}

/// `First Last`, trimmed. The only identity this module ever discloses.
async fn display_name(state: &AppState, user_id: &str) -> Result<Option<String>, sqlx::Error> {
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT first_name, last_name FROM users WHERE id = ?")
            .bind(user_id)
            .fetch_optional(&state.db)
            .await?;
    Ok(row.map(|(f, l)| format!("{f} {l}").trim().to_string()))
}

/// The user ids on the other end of every edge touching `user_id` — the
/// fan-out set for presence (a single indexed scan of both columns). Undirected,
/// so it unions the two sides of the canonical ordering. Takes the pool directly
/// (not `AppState`) so the presence fan-out and its tests can call it freely.
pub async fn friend_ids(db: &sqlx::SqlitePool, user_id: &str) -> Result<Vec<String>, sqlx::Error> {
    let rows: Vec<(String,)> = sqlx::query_as(
        r#"
        SELECT CASE WHEN user_a_id = ?1 THEN user_b_id ELSE user_a_id END
        FROM friendships
        WHERE user_a_id = ?1 OR user_b_id = ?1
        "#,
    )
    .bind(user_id)
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}

/// Is there an edge between these two? Order-independent.
pub async fn are_friends(state: &AppState, x: &str, y: &str) -> Result<bool, sqlx::Error> {
    let (a, b) = canonical_pair(x, y);
    let hit: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM friendships WHERE user_a_id = ? AND user_b_id = ?")
            .bind(a)
            .bind(b)
            .fetch_optional(&state.db)
            .await?;
    Ok(hit.is_some())
}

// ---- GET /api/friends ----

/// My friends, newest first. Name only, never email.
pub async fn list_friends(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<ActingUserQuery>,
) -> Result<Json<FriendsResponse>, (StatusCode, String)> {
    require_roster_member(&state, &headers, &q.acting_user_id).await?;

    // The edge is undirected, so "my friends" is the union of both columns —
    // whichever side of the canonical ordering I happen to be on.
    let rows: Vec<(String, String, String, String)> = sqlx::query_as(
        r#"
        SELECT u.id, u.first_name, u.last_name, f.created_at
        FROM friendships f
        JOIN users u
          ON u.id = CASE WHEN f.user_a_id = ?1 THEN f.user_b_id ELSE f.user_a_id END
        WHERE f.user_a_id = ?1 OR f.user_b_id = ?1
        ORDER BY f.created_at DESC
        "#,
    )
    .bind(&q.acting_user_id)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;

    let friends = rows
        .into_iter()
        .map(|(user_id, first, last, created_at)| Friend {
            user_id,
            name: format!("{first} {last}").trim().to_string(),
            friends_since: created_at,
        })
        .collect();

    Ok(Json(FriendsResponse {
        success: true,
        friends,
    }))
}

// ---- DELETE /api/friends/:user_id ----

/// Remove a friendship. **Silent** (ADR-0005 §1): the other party is not
/// notified, the edge simply disappears from both lists. Idempotent — removing a
/// non-friend is a no-op success, which also avoids leaking whether an edge
/// existed.
pub async fn remove_friend(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(other_user_id): Path<String>,
    Query(q): Query<ActingUserQuery>,
) -> Result<Json<Value>, (StatusCode, String)> {
    require_roster_member(&state, &headers, &q.acting_user_id).await?;

    let (a, b) = canonical_pair(&q.acting_user_id, &other_user_id);
    sqlx::query("DELETE FROM friendships WHERE user_a_id = ? AND user_b_id = ?")
        .bind(a)
        .bind(b)
        .execute(&state.db)
        .await
        .map_err(db_err)?;

    Ok(Json(json!({ "success": true })))
}

// ---- GET /api/friends/requests ----

pub async fn list_requests(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<ActingUserQuery>,
) -> Result<Json<RequestsResponse>, (StatusCode, String)> {
    require_roster_member(&state, &headers, &q.acting_user_id).await?;

    let incoming: Vec<(String, String, String, String, String)> = sqlx::query_as(
        r#"
        SELECT r.id, u.id, u.first_name, u.last_name, r.created_at
        FROM friend_requests r
        JOIN users u ON u.id = r.from_user_id
        WHERE r.to_user_id = ? AND r.status = 'pending'
        ORDER BY r.created_at DESC
        "#,
    )
    .bind(&q.acting_user_id)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;

    let outgoing: Vec<(String, String, String, String, String)> = sqlx::query_as(
        r#"
        SELECT r.id, u.id, u.first_name, u.last_name, r.created_at
        FROM friend_requests r
        JOIN users u ON u.id = r.to_user_id
        WHERE r.from_user_id = ? AND r.status = 'pending'
        ORDER BY r.created_at DESC
        "#,
    )
    .bind(&q.acting_user_id)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;

    let shape = |rows: Vec<(String, String, String, String, String)>| {
        rows.into_iter()
            .map(|(id, user_id, first, last, created_at)| FriendRequestInfo {
                id,
                user_id,
                name: format!("{first} {last}").trim().to_string(),
                created_at,
            })
            .collect()
    };

    Ok(Json(RequestsResponse {
        success: true,
        incoming: shape(incoming),
        outgoing: shape(outgoing),
    }))
}

// ---- POST /api/friends/requests ----

/// Propose a friendship.
///
/// Several outcomes deliberately return a plain success rather than an error, so
/// this endpoint can't be used as an oracle about other accounts:
/// - already friends → success, no-op
/// - a duplicate pending → success, no-op
///
/// The one genuinely interesting case: if the *recipient* already has a pending
/// request out to the *sender*, the two proposals are mutual consent, so this
/// accepts it outright instead of creating a second crossing request.
pub async fn create_request(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateRequestBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    require_roster_member(&state, &headers, &body.acting_user_id).await?;
    let from = body.acting_user_id.clone();
    let to = body.to_user_id.clone();

    if from == to {
        return Err((
            StatusCode::BAD_REQUEST,
            "cannot friend yourself".to_string(),
        ));
    }
    if !allow_request(&from) {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            "too many friend requests — try again later".to_string(),
        ));
    }

    // Recipient must be an enrolled account (ADR-0005 §2). Guests have no users
    // row, so this is also what makes "guests cannot be friended" structural.
    if display_name(&state, &to).await.map_err(db_err)?.is_none() {
        return Err((StatusCode::NOT_FOUND, "user not found".to_string()));
    }

    if are_friends(&state, &from, &to).await.map_err(db_err)? {
        return Ok(Json(
            json!({ "success": true, "status": "already_friends" }),
        ));
    }

    // Did they already ask me? Then we're both consenting — accept it now rather
    // than leaving two crossing pendings for someone to resolve by hand.
    let reciprocal: Option<String> = sqlx::query_scalar(
        "SELECT id FROM friend_requests
         WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'",
    )
    .bind(&to)
    .bind(&from)
    .fetch_optional(&state.db)
    .await
    .map_err(db_err)?;
    if let Some(request_id) = reciprocal {
        accept_request_inner(&state, &request_id, &from).await?;
        return Ok(Json(json!({ "success": true, "status": "accepted" })));
    }

    // NOTE: a previous decline does NOT block a new request — see the
    // "re-requesting" note in the module docs. Prior `declined` rows are left
    // alone as history and a fresh pending is created below.

    let outstanding: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM friend_requests WHERE from_user_id = ? AND status = 'pending'",
    )
    .bind(&from)
    .fetch_one(&state.db)
    .await
    .map_err(db_err)?;
    if outstanding >= MAX_OUTSTANDING_REQUESTS {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            "too many outstanding friend requests".to_string(),
        ));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let insert = sqlx::query(
        "INSERT INTO friend_requests (id, from_user_id, to_user_id, status, created_at)
         VALUES (?, ?, ?, 'pending', ?)",
    )
    .bind(&id)
    .bind(&from)
    .bind(&to)
    .bind(&now)
    .execute(&state.db)
    .await;

    match insert {
        Ok(_) => Ok(Json(json!({ "success": true, "status": "sent", "id": id }))),
        // The partial unique index caught a duplicate pending — treat as sent.
        Err(e) if e.to_string().contains("UNIQUE") => {
            Ok(Json(json!({ "success": true, "status": "sent" })))
        }
        Err(e) => Err(db_err(e)),
    }
}

// ---- POST /api/friends/requests/:id/accept ----

/// Create the edge and mark the request accepted, in one transaction so a
/// half-applied accept can't leave a request resolved with no friendship.
async fn accept_request_inner(
    state: &AppState,
    request_id: &str,
    accepting_user_id: &str,
) -> Result<(), (StatusCode, String)> {
    let mut tx = state.db.begin().await.map_err(db_err)?;

    // Re-read inside the transaction: this is the authorization check, so it
    // must not race against a concurrent accept/decline.
    let row: Option<(String, Option<String>, String)> =
        sqlx::query_as("SELECT from_user_id, to_user_id, status FROM friend_requests WHERE id = ?")
            .bind(request_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_err)?;

    let Some((from_user_id, to_user_id, status)) = row else {
        return Err((StatusCode::NOT_FOUND, "request not found".to_string()));
    };
    if status != "pending" {
        return Err((
            StatusCode::CONFLICT,
            "request is no longer pending".to_string(),
        ));
    }
    // Only the addressee may accept.
    if to_user_id.as_deref() != Some(accepting_user_id) {
        return Err((
            StatusCode::FORBIDDEN,
            "not your request to accept".to_string(),
        ));
    }

    let now = chrono::Utc::now().to_rfc3339();
    let (a, b) = canonical_pair(&from_user_id, accepting_user_id);
    sqlx::query(
        "INSERT OR IGNORE INTO friendships (user_a_id, user_b_id, created_at) VALUES (?, ?, ?)",
    )
    .bind(a)
    .bind(b)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;

    sqlx::query("UPDATE friend_requests SET status = 'accepted', responded_at = ? WHERE id = ?")
        .bind(&now)
        .bind(request_id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;

    // Any crossing proposal the other way is now redundant.
    sqlx::query(
        "UPDATE friend_requests SET status = 'accepted', responded_at = ?
         WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'",
    )
    .bind(&now)
    .bind(accepting_user_id)
    .bind(&from_user_id)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;

    tx.commit().await.map_err(db_err)?;
    Ok(())
}

pub async fn accept_request(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(request_id): Path<String>,
    Query(q): Query<ActingUserQuery>,
) -> Result<Json<Value>, (StatusCode, String)> {
    require_roster_member(&state, &headers, &q.acting_user_id).await?;
    accept_request_inner(&state, &request_id, &q.acting_user_id).await?;
    tracing::info!(
        event = "friendship_accepted",
        request_id = %request_id,
        "friend request accepted"
    );
    Ok(Json(json!({ "success": true })))
}

// ---- POST /api/friends/requests/:id/decline ----

/// Decline. The row is kept (status `declined`) rather than deleted, as history
/// — but it does **not** bar the sender from asking again later (see the
/// re-requesting note in the module docs).
pub async fn decline_request(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(request_id): Path<String>,
    Query(q): Query<ActingUserQuery>,
) -> Result<Json<Value>, (StatusCode, String)> {
    require_roster_member(&state, &headers, &q.acting_user_id).await?;

    let row: Option<(Option<String>, String)> =
        sqlx::query_as("SELECT to_user_id, status FROM friend_requests WHERE id = ?")
            .bind(&request_id)
            .fetch_optional(&state.db)
            .await
            .map_err(db_err)?;
    let Some((to_user_id, status)) = row else {
        return Err((StatusCode::NOT_FOUND, "request not found".to_string()));
    };
    if to_user_id.as_deref() != Some(q.acting_user_id.as_str()) {
        return Err((
            StatusCode::FORBIDDEN,
            "not your request to decline".to_string(),
        ));
    }
    if status != "pending" {
        return Err((
            StatusCode::CONFLICT,
            "request is no longer pending".to_string(),
        ));
    }

    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("UPDATE friend_requests SET status = 'declined', responded_at = ? WHERE id = ?")
        .bind(&now)
        .bind(&request_id)
        .execute(&state.db)
        .await
        .map_err(db_err)?;

    Ok(Json(json!({ "success": true })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::SqlitePool;

    #[test]
    fn canonical_pair_is_order_independent() {
        assert_eq!(canonical_pair("a", "b"), ("a", "b"));
        assert_eq!(canonical_pair("b", "a"), ("a", "b"));
    }

    /// Schema mirroring db.rs, minus the users FK (these tests exercise edge
    /// shape, not referential integrity).
    async fn friends_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query(
            r#"CREATE TABLE friendships (
                   user_a_id  TEXT NOT NULL,
                   user_b_id  TEXT NOT NULL,
                   created_at TEXT NOT NULL,
                   PRIMARY KEY (user_a_id, user_b_id),
                   CHECK (user_a_id < user_b_id)
               )"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    async fn insert_edge(pool: &SqlitePool, x: &str, y: &str) -> Result<(), sqlx::Error> {
        let (a, b) = canonical_pair(x, y);
        sqlx::query("INSERT INTO friendships VALUES (?, ?, 'now')")
            .bind(a)
            .bind(b)
            .execute(pool)
            .await
            .map(|_| ())
    }

    #[tokio::test]
    async fn edge_is_stored_once_regardless_of_direction() {
        let pool = friends_db().await;
        insert_edge(&pool, "u-b", "u-a").await.unwrap();
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM friendships")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(n, 1);
        let (a, b): (String, String) =
            sqlx::query_as("SELECT user_a_id, user_b_id FROM friendships")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!((a.as_str(), b.as_str()), ("u-a", "u-b"));
    }

    #[tokio::test]
    async fn friend_ids_unions_both_sides_of_the_edge() {
        // The presence fan-out set: every neighbor, whichever column I'm on.
        let pool = friends_db().await;
        insert_edge(&pool, "u-me", "u-x").await.unwrap(); // I'm user_b
        insert_edge(&pool, "u-a", "u-me").await.unwrap(); // I'm user_b again
        insert_edge(&pool, "u-me", "u-zz").await.unwrap(); // I'm user_a
        let mut ids = friend_ids(&pool, "u-me").await.unwrap();
        ids.sort();
        assert_eq!(ids, vec!["u-a", "u-x", "u-zz"]);
        // A stranger with no edges gets an empty fan-out set.
        assert!(friend_ids(&pool, "u-none").await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn reciprocal_insert_is_rejected_as_duplicate() {
        // The symmetry guarantee: having stored A-B, storing B-A must not create
        // a second row. Canonical ordering makes it the same PK.
        let pool = friends_db().await;
        insert_edge(&pool, "u-a", "u-b").await.unwrap();
        assert!(insert_edge(&pool, "u-b", "u-a").await.is_err());
    }

    #[tokio::test]
    async fn uncanonical_edge_cannot_be_written_directly() {
        // Even a hand-written INSERT can't produce a reversed row — the CHECK
        // makes a half-edge unrepresentable rather than merely discouraged.
        let pool = friends_db().await;
        let r = sqlx::query("INSERT INTO friendships VALUES ('u-z', 'u-a', 'now')")
            .execute(&pool)
            .await;
        assert!(r.is_err());
    }

    #[tokio::test]
    async fn self_edge_is_rejected() {
        let pool = friends_db().await;
        assert!(insert_edge(&pool, "u-a", "u-a").await.is_err());
    }

    /// `friend_requests` minus the users/guest FKs.
    async fn requests_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query(
            r#"CREATE TABLE friend_requests (
                   id           TEXT PRIMARY KEY,
                   from_user_id TEXT NOT NULL,
                   to_user_id   TEXT,
                   status       TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','accepted','declined','expired')),
                   created_at   TEXT NOT NULL,
                   responded_at TEXT,
                   CHECK (from_user_id <> to_user_id)
               )"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"CREATE UNIQUE INDEX idx_pending_pair
               ON friend_requests(from_user_id, to_user_id)
               WHERE status = 'pending' AND to_user_id IS NOT NULL"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    async fn send(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO friend_requests (id, from_user_id, to_user_id, status, created_at)
             VALUES (?, 'u-a', 'u-b', 'pending', 'now')",
        )
        .bind(id)
        .execute(pool)
        .await
        .map(|_| ())
    }

    #[tokio::test]
    async fn only_one_pending_request_per_pair() {
        let pool = requests_db().await;
        send(&pool, "r1").await.unwrap();
        assert!(send(&pool, "r2").await.is_err());
    }

    #[tokio::test]
    async fn a_decline_does_not_bar_a_later_request() {
        // The accidental-decline case: someone declines an unfamiliar prompt,
        // then genuinely wants to be friends later. The partial unique index
        // covers only `pending`, so the resolved row doesn't wedge the pair.
        let pool = requests_db().await;
        send(&pool, "r1").await.unwrap();
        sqlx::query("UPDATE friend_requests SET status = 'declined' WHERE id = 'r1'")
            .execute(&pool)
            .await
            .unwrap();

        send(&pool, "r2").await.expect("re-request must be allowed");

        // The decline is kept as history alongside the new pending.
        let declined: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM friend_requests WHERE status = 'declined'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let pending: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM friend_requests WHERE status = 'pending'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!((declined, pending), (1, 1));
    }

    #[tokio::test]
    async fn a_removed_friendship_can_be_re_requested() {
        // Same principle one step further along: unfriending (silent, either
        // party, ADR-0005 §1) must not permanently wedge the pair either.
        let pool = requests_db().await;
        send(&pool, "r1").await.unwrap();
        sqlx::query("UPDATE friend_requests SET status = 'accepted' WHERE id = 'r1'")
            .execute(&pool)
            .await
            .unwrap();
        send(&pool, "r2")
            .await
            .expect("re-request after unfriend must be allowed");
    }
}

//! Friend presence (Phase 3).
//!
//! Live online/at-table/practicing/invisible state for a user's friends,
//! delivered as Server-Sent Events straight from this API — the server that
//! already owns the friend graph, so fan-out is a single indexed query and no
//! cross-service hop (ADR-0005 §6 as revised: SSE from the API, not a droplet
//! WS; it moves *with* the API when it migrates to the droplet).
//!
//! Transport:
//!   * `GET  /api/presence/stream?acting_user_id=…` — one SSE connection per open
//!     tab, cookie-authorized (an `EventSource` can't send `x-api-key`, and the
//!     friend routes already authorize off the device-session cookie). On connect
//!     the client gets a snapshot of every friend's current state, then live
//!     `{ presence: { <friend_id>: <state> } }` deltas.
//!   * `POST /api/presence` — `{ acting_user_id, state }` heartbeat (~30s). Sets
//!     the caller's state + freshness; a background sweep flips stale users to
//!     `offline`.
//!
//! State is in-process soft state (a `LazyLock<Mutex<..>>`, the same shape as the
//! rate limiters elsewhere in this crate). It dies on restart — by design;
//! clients reconnect and re-heartbeat, and presence is inherently ephemeral.
//!
//! **Invisibility is enforced server-side:** a user who reports `invisible` is
//! fanned out to friends as `offline`. Friends never receive the `invisible`
//! marker — it's the reporter's own private toggle.

use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::sse::{Event, KeepAlive, Sse},
    Json,
};
use futures_core::Stream;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::mpsc;

use crate::routes::session::require_roster_member;
use crate::AppState;

/// A heartbeat older than this with no refresh is swept to `offline`. Three
/// missed ~30s beats — long enough to ride out a slow tab, short enough that a
/// closed laptop drops off within a couple of minutes.
const STALE_AFTER: Duration = Duration::from_secs(75);
const SWEEP_INTERVAL: Duration = Duration::from_secs(30);

/// The presence vocabulary. `offline` is the absence/stale state; `invisible` is
/// a private self-state that friends see as `offline` (see `visible_to_friends`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PresenceState {
    Online,
    AtTable,
    Practicing,
    Invisible,
    Offline,
}

impl PresenceState {
    fn parse(s: &str) -> Option<PresenceState> {
        match s {
            "online" => Some(PresenceState::Online),
            "at_table" => Some(PresenceState::AtTable),
            "practicing" => Some(PresenceState::Practicing),
            "invisible" => Some(PresenceState::Invisible),
            "offline" => Some(PresenceState::Offline),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            PresenceState::Online => "online",
            PresenceState::AtTable => "at_table",
            PresenceState::Practicing => "practicing",
            PresenceState::Invisible => "invisible",
            PresenceState::Offline => "offline",
        }
    }

    /// What a FRIEND is allowed to see. `invisible` collapses to `offline` here —
    /// the one place invisibility is enforced, so a lying client can't leak it.
    fn visible_to_friends(self) -> PresenceState {
        match self {
            PresenceState::Invisible => PresenceState::Offline,
            other => other,
        }
    }
}

/// In-process presence registry. `conns` holds every open SSE sender (one per
/// tab) keyed by user then a per-connection id so a tab can remove exactly its
/// own on disconnect; `states` holds each user's current state + last heartbeat.
#[derive(Default)]
struct Registry {
    conns: HashMap<String, HashMap<u64, mpsc::UnboundedSender<String>>>,
    states: HashMap<String, (PresenceState, Instant)>,
    next_conn: u64,
}

static REG: LazyLock<Mutex<Registry>> = LazyLock::new(|| Mutex::new(Registry::default()));

fn lock() -> std::sync::MutexGuard<'static, Registry> {
    REG.lock().unwrap_or_else(|e| e.into_inner())
}

/// Push one `{ presence: { user: state } }` delta to every open connection of
/// each of `user`'s friends. `friends` is fetched by the caller (async DB) so
/// this holds the registry lock only for the non-blocking `send`s.
fn push_delta(friends: &[String], user: &str, visible: PresenceState) {
    let payload = json!({ "presence": { user: visible.as_str() } }).to_string();
    let reg = lock();
    for fid in friends {
        if let Some(conns) = reg.conns.get(fid) {
            for tx in conns.values() {
                let _ = tx.send(payload.clone());
            }
        }
    }
}

/// Recompute `user`'s friend-visible state and broadcast it to their friends.
async fn fanout(state: &AppState, user: &str) {
    let friends = match crate::routes::friends::friend_ids(&state.db, user).await {
        Ok(f) => f,
        Err(e) => {
            tracing::error!("presence fanout friend_ids failed: {e}");
            return;
        }
    };
    if friends.is_empty() {
        return;
    }
    let visible = lock()
        .states
        .get(user)
        .map(|(s, _)| s.visible_to_friends())
        .unwrap_or(PresenceState::Offline);
    push_delta(&friends, user, visible);
}

// ---- GET /api/presence/stream ----

#[derive(Debug, Deserialize)]
pub struct StreamQuery {
    pub acting_user_id: String,
}

/// Removes a connection on stream drop (tab closed / navigated away). If it was
/// the user's last open tab, flip them to `offline` and fan that out.
struct ConnGuard {
    state: AppState,
    user: String,
    conn_id: u64,
}

impl Drop for ConnGuard {
    fn drop(&mut self) {
        let now_offline = {
            let mut reg = lock();
            let last = match reg.conns.get_mut(&self.user) {
                Some(conns) => {
                    conns.remove(&self.conn_id);
                    conns.is_empty()
                }
                None => false,
            };
            if last {
                reg.conns.remove(&self.user);
                if let Some(entry) = reg.states.get_mut(&self.user) {
                    entry.0 = PresenceState::Offline;
                }
            }
            last
        };
        if now_offline {
            let state = self.state.clone();
            let user = self.user.clone();
            tokio::spawn(async move { fanout(&state, &user).await });
        }
    }
}

pub async fn presence_stream(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<StreamQuery>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, (StatusCode, String)> {
    require_roster_member(&state, &headers, &q.acting_user_id).await?;
    let user = q.acting_user_id;

    let friends = crate::routes::friends::friend_ids(&state.db, &user)
        .await
        .map_err(|e| {
            tracing::error!("presence stream friend_ids failed: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "database error".to_string(),
            )
        })?;

    // Register this tab; keep an existing state (a sibling tab may already be
    // invisible), else default online. Refresh freshness either way.
    let (conn_id, mut rx) = {
        let mut reg = lock();
        let conn_id = reg.next_conn;
        reg.next_conn += 1;
        let (tx, rx) = mpsc::unbounded_channel::<String>();
        reg.conns
            .entry(user.clone())
            .or_default()
            .insert(conn_id, tx);
        let now = Instant::now();
        reg.states
            .entry(user.clone())
            .and_modify(|e| {
                if e.0 == PresenceState::Offline {
                    e.0 = PresenceState::Online;
                }
                e.1 = now;
            })
            .or_insert((PresenceState::Online, now));
        (conn_id, rx)
    };

    // Snapshot: every friend's current friend-visible state (missing = offline).
    let snapshot = {
        let reg = lock();
        let mut map = serde_json::Map::new();
        for fid in &friends {
            let vis = reg
                .states
                .get(fid)
                .map(|(s, _)| s.visible_to_friends())
                .unwrap_or(PresenceState::Offline);
            map.insert(fid.clone(), json!(vis.as_str()));
        }
        json!({ "presence": Value::Object(map) }).to_string()
    };

    // Announce our arrival to friends who are watching.
    fanout(&state, &user).await;

    let guard = ConnGuard {
        state: state.clone(),
        user,
        conn_id,
    };
    let stream = async_stream::stream! {
        let _guard = guard; // dropped when the client disconnects → cleanup
        yield Ok(Event::default().data(snapshot));
        while let Some(msg) = rx.recv().await {
            yield Ok(Event::default().data(msg));
        }
    };

    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

// ---- POST /api/presence ----

#[derive(Debug, Deserialize)]
pub struct HeartbeatBody {
    pub acting_user_id: String,
    pub state: String,
}

pub async fn presence_heartbeat(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<HeartbeatBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    require_roster_member(&state, &headers, &body.acting_user_id).await?;
    let Some(new_state) = PresenceState::parse(&body.state) else {
        return Err((
            StatusCode::BAD_REQUEST,
            "unknown presence state".to_string(),
        ));
    };

    // Update state + freshness; only fan out when the friend-visible state
    // actually changes, so a steady 30s heartbeat isn't a steady rebroadcast.
    let changed = {
        let mut reg = lock();
        let now = Instant::now();
        match reg.states.get_mut(&body.acting_user_id) {
            Some(entry) => {
                let was = entry.0.visible_to_friends();
                entry.0 = new_state;
                entry.1 = now;
                was != new_state.visible_to_friends()
            }
            None => {
                reg.states
                    .insert(body.acting_user_id.clone(), (new_state, now));
                true
            }
        }
    };
    if changed {
        fanout(&state, &body.acting_user_id).await;
    }
    Ok(Json(json!({ "success": true })))
}

// ---- Background staleness sweep ----

/// Spawn the sweep that flips users whose heartbeat has gone stale to `offline`
/// and fans that out. Call once at startup.
pub fn spawn_sweeper(state: AppState) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(SWEEP_INTERVAL);
        loop {
            tick.tick().await;
            let now = Instant::now();
            let stale: Vec<String> = {
                let mut reg = lock();
                let mut out = Vec::new();
                for (uid, (st, seen)) in reg.states.iter_mut() {
                    if *st != PresenceState::Offline && now.duration_since(*seen) > STALE_AFTER {
                        *st = PresenceState::Offline;
                        out.push(uid.clone());
                    }
                }
                out
            };
            for uid in stale {
                fanout(&state, &uid).await;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invisible_is_offline_to_friends() {
        assert_eq!(
            PresenceState::Invisible.visible_to_friends(),
            PresenceState::Offline
        );
        // Everything else passes through unchanged.
        for s in [
            PresenceState::Online,
            PresenceState::AtTable,
            PresenceState::Practicing,
            PresenceState::Offline,
        ] {
            assert_eq!(s.visible_to_friends(), s);
        }
    }

    #[test]
    fn state_round_trips_through_the_wire_names() {
        for s in [
            PresenceState::Online,
            PresenceState::AtTable,
            PresenceState::Practicing,
            PresenceState::Invisible,
            PresenceState::Offline,
        ] {
            assert_eq!(PresenceState::parse(s.as_str()), Some(s));
        }
        assert_eq!(PresenceState::parse("bogus"), None);
    }

    // Register a listener conn for `user` in the shared registry and return its
    // receiver. Unique ids per test keep the process-wide REG from colliding.
    fn register(user: &str) -> mpsc::UnboundedReceiver<String> {
        let (tx, rx) = mpsc::unbounded_channel();
        let mut reg = lock();
        let id = reg.next_conn;
        reg.next_conn += 1;
        reg.conns
            .entry(user.to_string())
            .or_default()
            .insert(id, tx);
        rx
    }

    #[test]
    fn push_delta_reaches_every_open_connection_of_each_friend() {
        // Two friends (B has two tabs) and a stranger; a delta for A reaches both
        // of B's tabs and never the stranger.
        let mut b_tab1 = register("pt-B");
        let mut b_tab2 = register("pt-B");
        let mut stranger = register("pt-Z");

        push_delta(&["pt-B".to_string()], "pt-A", PresenceState::Online);

        let expected = r#"{"presence":{"pt-A":"online"}}"#;
        assert_eq!(b_tab1.try_recv().unwrap(), expected);
        assert_eq!(b_tab2.try_recv().unwrap(), expected);
        assert!(stranger.try_recv().is_err(), "stranger gets nothing");
    }

    #[test]
    fn invisible_fans_out_as_offline() {
        let mut friend = register("pt-F");
        // The reporter's raw state is invisible, but friends must see offline.
        push_delta(
            &["pt-F".to_string()],
            "pt-U",
            PresenceState::Invisible.visible_to_friends(),
        );
        assert_eq!(
            friend.try_recv().unwrap(),
            r#"{"presence":{"pt-U":"offline"}}"#
        );
    }
}

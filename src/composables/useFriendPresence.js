// Friend presence (Phase 3) — the client half of the SSE presence transport.
//
// One EventSource per tab to `GET /api/presence/stream`, cookie-authorized (an
// EventSource can't set the `x-api-key` header, and the presence endpoints
// authorize off the device-session cookie — see routes/presence.rs). The server
// pushes `{ presence: { <friendId>: <state> } }` — a snapshot on connect, then
// deltas — which we merge into `presenceByUserId`. A ~30s heartbeat reports OUR
// state so friends see us; the server sweeps a silent client to `offline`.
//
// Module-level singleton (repo composable pattern) so it survives route changes
// — presence must keep running while we're AT a table (`/table` is a separate
// top-level route from the lobby; MainLayout unmounts there). Lifecycle is driven
// from App.vue (always mounted) keyed on the signed-in user.
//
// States we REPORT (precedence high→low): invisible · at_table · practicing ·
// online. `invisible` is the only manual control; the server maps it to
// `offline` for friends. `at_table`/`practicing` are automatic (table socket
// open / solo-practice view).

import { ref } from 'vue'
import { apiFetch, API_URL } from '../utils/apiFetch.js'

const HEARTBEAT_MS = 30000
const BACKOFF_START_MS = 1000
const BACKOFF_MAX_MS = 30000

// Friend id → state string ('online'|'at_table'|'practicing'|'offline').
const presenceByUserId = ref({})

// Friend events pushed down the same stream — a queue App.vue renders as toasts
// (the pull-only Friends tab was invisible to a user seated at a table). Two
// kinds: { kind:'request', id, name, requestId } (Accept/Dismiss) and
// { kind:'confirmed', id, name } ("you're now friends", informational).
const toasts = ref([])

function pushToast(t) {
  if (!t.id || toasts.value.some((x) => x.id === t.id)) return
  // Cap so a burst (or a reconnect redelivery) can't pile up.
  toasts.value = [...toasts.value, t].slice(-5)
}

// Our own reported context. `invisible` is user-facing (persisted); the other
// two are set automatically by the table/solo hooks.
const invisible = ref(localStorage.getItem('bc.presenceInvisible') === '1')
const atTable = ref(false)
const practicing = ref(false)

let userId = null
let source = null
let heartbeatTimer = null
let reconnectTimer = null
let backoff = BACKOFF_START_MS

function reportedState() {
  if (invisible.value) return 'invisible'
  if (atTable.value) return 'at_table'
  if (practicing.value) return 'practicing'
  return 'online'
}

async function heartbeat() {
  if (!userId) return
  try {
    await apiFetch(`${API_URL}/presence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acting_user_id: userId, state: reportedState() }),
    })
  } catch {
    // Soft state — a missed beat just risks a transient sweep to offline, which
    // the next beat corrects.
  }
}

function openStream() {
  if (!userId || typeof EventSource === 'undefined') return
  const url = `${API_URL}/presence/stream?acting_user_id=${encodeURIComponent(userId)}`
  source = new EventSource(url, { withCredentials: true })
  source.onopen = () => {
    backoff = BACKOFF_START_MS
  }
  source.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data)
      if (data.presence && typeof data.presence === 'object') {
        presenceByUserId.value = { ...presenceByUserId.value, ...data.presence }
      }
      const req = data.friend_request
      if (req && req.id) {
        pushToast({ kind: 'request', id: req.id, name: req.from_name, requestId: req.id })
      }
      const conf = data.friend_confirmed
      if (conf && conf.user_id) {
        // No server id for a confirmation; key it by who accepted.
        pushToast({ kind: 'confirmed', id: `confirmed:${conf.user_id}`, name: conf.name })
      }
      // Table invitation (Phase 4): a friend invited us onto a seat.
      const inv = data.invitation
      if (inv && inv.id) {
        pushToast({
          kind: 'invitation',
          id: `inv:${inv.id}`,
          invitationId: inv.id,
          sessionId: inv.session_id,
          seat: inv.seat,
          name: inv.from_name,
        })
      }
      // Softened host notice that an invitee declined.
      const dec = data.invitation_declined
      if (dec) {
        pushToast({ kind: 'declined', id: `declined:${Date.now()}`, name: dec.from_name })
      }
    } catch {
      /* ignore a malformed frame */
    }
  }
  source.onerror = () => {
    // EventSource retries on its own for network blips, but a credentialed
    // cross-origin failure can leave it permanently CLOSED — so drive our own
    // capped-backoff reconnect rather than trusting the built-in one.
    if (source) {
      source.close()
      source = null
    }
    clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(openStream, backoff)
    backoff = Math.min(backoff * 2, BACKOFF_MAX_MS)
  }
}

// Start (or restart for a new user) the stream + heartbeat. Idempotent per user.
function start(id) {
  if (!id) return
  if (userId === id && source) return
  stop()
  userId = id
  openStream()
  heartbeat() // announce immediately, don't wait a full interval
  heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS)
}

function stop() {
  if (source) {
    source.close()
    source = null
  }
  clearInterval(heartbeatTimer)
  heartbeatTimer = null
  clearTimeout(reconnectTimer)
  reconnectTimer = null
  userId = null
  backoff = BACKOFF_START_MS
  presenceByUserId.value = {}
  toasts.value = []
  atTable.value = false
  practicing.value = false
}

function dismissToast(id) {
  toasts.value = toasts.value.filter((t) => t.id !== id)
}

// Local-context setters (auto-reported). Each pushes an immediate heartbeat so
// the change fans out to friends without waiting for the next interval.
function setAtTable(on) {
  if (atTable.value === on) return
  atTable.value = on
  heartbeat()
}
function setPracticing(on) {
  if (practicing.value === on) return
  practicing.value = on
  heartbeat()
}
function setInvisible(on) {
  invisible.value = on
  try {
    localStorage.setItem('bc.presenceInvisible', on ? '1' : '0')
  } catch {
    /* private mode */
  }
  heartbeat()
}

function presenceFor(id) {
  return presenceByUserId.value[id] || 'offline'
}

export function useFriendPresence() {
  return {
    presenceByUserId,
    toasts,
    dismissToast,
    invisible,
    start,
    stop,
    setAtTable,
    setPracticing,
    setInvisible,
    presenceFor,
  }
}

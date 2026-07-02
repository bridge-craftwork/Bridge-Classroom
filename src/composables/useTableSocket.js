// useTableSocket — WebSocket lifecycle for the multiplayer table service
// (bridge-table-service on the droplet, wss://tables.bridge-craftwork.com/ws).
//
// Responsibilities (transport only — game semantics live in useRemoteTable):
//   - Mint an HMAC join ticket from the Mac API (POST ${API_URL}/table-tickets).
//   - Open the WS and send {t:"hello", ticket} as the FIRST frame.
//   - Reconnect with capped exponential backoff on unexpected drops. The SAME
//     ticket is reused so the server rebinds the same seat (guest subs are
//     random per mint — re-minting would seat the guest twice).
//   - Answer {t:"ping"} with {t:"pong"}, plus a periodic client keepalive so
//     idle proxies don't drop a quiet table.
//   - Expose resync(): close + immediately reconnect. Every (re)join gets a
//     fresh redacted snapshot, so this is the sanctioned way to re-fetch state
//     the events can't carry (e.g. dummy's cards after the opening lead).
//
// Singleton pattern (module-level state) per project convention.

import { ref } from 'vue'
import { API_URL } from '../utils/apiUrl.js'

const API_KEY = import.meta.env.VITE_API_KEY || ''

// Default is the production service; override for local dev with
// VITE_TABLE_WS_URL=ws://localhost:8004/ws in .env.
const WS_URL = import.meta.env.VITE_TABLE_WS_URL || 'wss://tables.bridge-craftwork.com/ws'

// Guest tickets are cached per-tab so a page refresh rebinds the same seat
// (each guest mint gets a fresh random sub — without this, refreshing would
// occupy a second seat at the table).
const GUEST_TICKET_CACHE_KEY = 'bridgeTableGuestTicket'

// ── Module-level singleton state ───────────────────────────────────────

// idle | minting | connecting | connected | reconnecting | unavailable | error
const status = ref('idle')
const lastError = ref('')
// { name, role, expires_at } from the mint response.
const ticketInfo = ref(null)

let socket = null
let ticket = null
let identity = null // { sessionId, userId?, guestName?, bot? }
const handlers = new Set()
let backoffMs = 1000
let reconnectTimer = null
let keepaliveTimer = null
let epoch = 0 // bumped on connect()/disconnect() to invalidate stale async work

// ── Ticket minting ─────────────────────────────────────────────────────

function cachedGuestTicket({ sessionId, guestName }) {
  try {
    const raw = sessionStorage.getItem(GUEST_TICKET_CACHE_KEY)
    if (!raw) return null
    const c = JSON.parse(raw)
    if (c.sessionId !== sessionId || c.guestName !== guestName) return null
    // 60s slack so we never hand the server a ticket about to expire.
    if (!c.expires_at || c.expires_at * 1000 < Date.now() + 60_000) return null
    return c
  } catch {
    return null
  }
}

function cacheGuestTicket({ sessionId, guestName }, minted) {
  try {
    sessionStorage.setItem(GUEST_TICKET_CACHE_KEY, JSON.stringify({
      sessionId,
      guestName,
      ticket: minted.ticket,
      name: minted.name,
      role: minted.role,
      expires_at: minted.expires_at,
    }))
  } catch {
    // sessionStorage unavailable (private mode etc.) — refresh loses the seat
    // binding, which the server tolerates (table full → kibitzer).
  }
}

async function mintTicket({ sessionId, userId, guestName }) {
  if (userId) {
    // A logged-in user always mints under their user_id. Drop any per-tab
    // guest ticket so a stale guest identity can never resurface in this tab
    // (e.g. joined as a guest earlier, then logged in).
    try { sessionStorage.removeItem(GUEST_TICKET_CACHE_KEY) } catch { /* ignore */ }
  } else if (guestName) {
    const cached = cachedGuestTicket({ sessionId, guestName })
    if (cached) return cached
  }
  const body = userId
    ? { user_id: userId, session_id: sessionId }
    : { guest_name: guestName, session_id: sessionId }
  const res = await fetch(`${API_URL}/table-tickets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body),
  })
  if (res.status === 503) {
    const err = new Error('Multiplayer tables are not set up yet.')
    err.code = 'not_configured'
    throw err
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const err = new Error(text || `Ticket request failed (${res.status})`)
    err.code = 'mint_failed'
    throw err
  }
  const minted = await res.json()
  if (!userId && guestName) cacheGuestTicket({ sessionId, guestName }, minted)
  return minted
}

// ── Socket lifecycle ───────────────────────────────────────────────────

function dispatch(msg) {
  for (const fn of handlers) {
    try {
      fn(msg)
    } catch (err) {
      // A broken handler must not kill message delivery to the others.
      // eslint-disable-next-line no-console
      console.error('[tableSocket] message handler threw:', err)
    }
  }
}

function clearTimers() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null }
}

function openSocket(myEpoch) {
  if (myEpoch !== epoch) return
  status.value = status.value === 'reconnecting' ? 'reconnecting' : 'connecting'
  let ws
  try {
    ws = new WebSocket(WS_URL)
  } catch (err) {
    lastError.value = err.message || String(err)
    status.value = 'error'
    return
  }
  socket = ws

  ws.onopen = () => {
    if (myEpoch !== epoch || socket !== ws) return
    const hello = { t: 'hello', ticket }
    // Optional bot selector (?bot=random on the table route). The server
    // confirms the active mode via `bot_mode` in the welcome frame.
    if (identity?.bot) hello.bot = identity.bot
    ws.send(JSON.stringify(hello))
    status.value = 'connected'
    backoffMs = 1000
    // Keepalive: the server treats "pong" as a no-op, but the traffic keeps
    // idle proxies (Cloudflare, Caddy) from closing a quiet table.
    if (keepaliveTimer) clearInterval(keepaliveTimer)
    keepaliveTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'pong' }))
    }, 25_000)
  }

  ws.onmessage = (e) => {
    if (myEpoch !== epoch || socket !== ws) return
    let msg
    try {
      msg = JSON.parse(e.data)
    } catch {
      return
    }
    if (msg.t === 'ping') {
      ws.send(JSON.stringify({ t: 'pong' }))
      return
    }
    // A rejected/expired ticket can't be fixed by reconnecting with the same
    // one — drop the cached guest ticket and re-mint on the next attempt.
    if (msg.t === 'error' && msg.code === 'bad_ticket') {
      try { sessionStorage.removeItem(GUEST_TICKET_CACHE_KEY) } catch { /* ignore */ }
      ticket = null
    }
    dispatch(msg)
  }

  ws.onclose = () => {
    if (myEpoch !== epoch || socket !== ws) return
    if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null }
    scheduleReconnect(myEpoch)
  }

  ws.onerror = () => {
    // onclose always follows; reconnect is handled there.
  }
}

function scheduleReconnect(myEpoch, immediate = false) {
  if (myEpoch !== epoch) return
  status.value = 'reconnecting'
  const delay = immediate ? 0 : backoffMs
  backoffMs = Math.min(backoffMs * 2, 15_000)
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null
    if (myEpoch !== epoch) return
    if (!ticket) {
      // Ticket was invalidated (expired / rejected): mint a fresh one.
      try {
        const minted = await mintTicket(identity)
        if (myEpoch !== epoch) return
        ticket = minted.ticket
        ticketInfo.value = minted
      } catch (err) {
        if (myEpoch !== epoch) return
        lastError.value = err.message
        status.value = err.code === 'not_configured' ? 'unavailable' : 'error'
        return
      }
    }
    openSocket(myEpoch)
  }, delay)
}

// Tab close / navigation away: close the socket cleanly so the server frees
// the connection immediately. Without this, a dangling socket from a closed
// tab keeps auto-reconnecting and can re-occupy a seat (e.g. steal South in
// a freshly reset room) from a tab nobody is looking at.
function handlePageUnload() {
  epoch++ // invalidate pending reconnects/mints
  clearTimers()
  if (socket) {
    const ws = socket
    socket = null
    ws.onclose = null // no reconnect from an unloading page
    try { ws.close(1000, 'page unload') } catch { /* already closed */ }
  }
}

// ── Public API ─────────────────────────────────────────────────────────

// Connect (or switch) to a table session. Exactly one of userId / guestName.
// `bot` optionally selects the server's bot backend (e.g. 'random').
async function connect({ sessionId, userId = null, guestName = null, bot = null }) {
  disconnect()
  const myEpoch = ++epoch
  identity = { sessionId, userId, guestName, bot }
  // pagehide covers mobile Safari / bfcache where beforeunload doesn't fire.
  window.addEventListener('beforeunload', handlePageUnload)
  window.addEventListener('pagehide', handlePageUnload)
  lastError.value = ''
  status.value = 'minting'
  let minted
  try {
    minted = await mintTicket(identity)
  } catch (err) {
    if (myEpoch !== epoch) return false
    lastError.value = err.message
    status.value = err.code === 'not_configured' ? 'unavailable' : 'error'
    return false
  }
  if (myEpoch !== epoch) return false
  ticket = minted.ticket
  ticketInfo.value = minted
  openSocket(myEpoch)
  return true
}

function disconnect() {
  epoch++
  window.removeEventListener('beforeunload', handlePageUnload)
  window.removeEventListener('pagehide', handlePageUnload)
  clearTimers()
  if (socket) {
    try { socket.close() } catch { /* already closed */ }
    socket = null
  }
  status.value = 'idle'
}

// Close and immediately reconnect with the same ticket. Every (re)join gets
// a fresh per-viewer snapshot, so this is how the client re-fetches state
// that events can't carry (dummy's hand after the opening lead).
function resync() {
  if (!identity) return
  const myEpoch = epoch
  if (socket) {
    const ws = socket
    socket = null
    ws.onclose = null // suppress the normal backoff path
    try { ws.close() } catch { /* already closed */ }
  }
  scheduleReconnect(myEpoch, true)
}

// Send a JSON frame. Returns false (and reports nothing) if not connected —
// callers surface their own "not connected" UX off `status`.
function send(obj) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false
  socket.send(JSON.stringify(obj))
  return true
}

// Subscribe to every parsed server frame. Returns an unsubscribe function.
function onMessage(fn) {
  handlers.add(fn)
  return () => handlers.delete(fn)
}

export function useTableSocket() {
  return {
    // state
    status,
    lastError,
    ticketInfo,
    // actions
    connect,
    disconnect,
    resync,
    send,
    onMessage,
  }
}

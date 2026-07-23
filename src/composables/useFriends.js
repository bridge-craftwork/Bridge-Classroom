// Friends and friend requests (ADR-0005 Phase 2).
//
// Singleton state, per the repo's composable convention: the Friends tab and
// any future presence UI share one copy rather than each fetching its own.
//
// Two things about this API that shape the UI:
//
// 1. **Every call carries an `acting_user_id`, which the server PROVES against
//    the device-session roster** (ADR-0004 §3a). It is not a claim the client
//    gets to make — a wrong id is a 403, not a silent act-as. That's why a 401
//    here means "no durable session on this device" (the cookie was purged, or
//    this user hasn't recovered/registered on this browser) rather than "you're
//    logged out of the app" — the app itself still works from localStorage.
//
// 2. **There is no user search.** You can only befriend someone whose id you
//    already hold from a shared table, so this module deliberately exposes no
//    lookup — only `sendRequest(toUserId)`. See ADR-0005.

import { ref, computed } from 'vue'
import { apiFetch, API_URL } from '../utils/apiFetch.js'

// ---- Singleton state ----
const friends = ref([])
const incoming = ref([])
const outgoing = ref([])
const loading = ref(false)
const error = ref(null)
// True once a load has completed at least once, so the UI can tell "empty"
// apart from "not yet loaded" without flashing an empty state.
const loaded = ref(false)
// Set when the API says there's no usable session on this device. The friends
// features are unavailable until the user recovers here; the rest of the app
// is unaffected, so this is a panel-level notice, not an app-level error.
const needsSession = ref(false)

let inFlight = null

function reset() {
  friends.value = []
  incoming.value = []
  outgoing.value = []
  loaded.value = false
  error.value = null
  needsSession.value = false
}

/**
 * Unwrap a friends-API response. Distinguishes the three outcomes the UI cares
 * about: ok, no-session (401/403), and everything else.
 */
async function readJson(res) {
  if (res.status === 401 || res.status === 403) {
    needsSession.value = true
    throw new Error('no-session')
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `request failed (${res.status})`)
  }
  return res.json()
}

export function useFriends() {
  /**
   * Load friends + both request directions. Concurrent callers share one
   * request (the tab and a future presence panel can both call `load()` on
   * mount without doubling traffic).
   */
  async function load(userId) {
    if (!userId) return
    if (inFlight) return inFlight

    loading.value = true
    error.value = null

    inFlight = (async () => {
      try {
        const q = `acting_user_id=${encodeURIComponent(userId)}`
        const [friendsRes, requestsRes] = await Promise.all([
          apiFetch(`${API_URL}/friends?${q}`),
          apiFetch(`${API_URL}/friends/requests?${q}`),
        ])
        const friendsData = await readJson(friendsRes)
        const requestsData = await readJson(requestsRes)

        friends.value = friendsData.friends || []
        incoming.value = requestsData.incoming || []
        outgoing.value = requestsData.outgoing || []
        needsSession.value = false
        loaded.value = true
      } catch (e) {
        // no-session is already reflected in `needsSession`; don't also show it
        // as a hard error, since it has its own explanatory UI.
        if (e.message !== 'no-session') {
          error.value = e.message
          console.error('[useFriends] load failed:', e)
        }
      } finally {
        loading.value = false
        inFlight = null
      }
    })()

    return inFlight
  }

  /**
   * Propose a friendship. `toUserId` must come from a shared context (a table
   * roster) — there is no search endpoint that could produce it.
   *
   * Returns the server's `status`, which the caller should surface verbatim-ish:
   * `sent`, `accepted` (the other party had already asked — mutual consent, so
   * it completed immediately), or `already_friends`.
   */
  async function sendRequest(userId, toUserId) {
    error.value = null
    try {
      const res = await apiFetch(`${API_URL}/friends/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acting_user_id: userId, to_user_id: toUserId }),
      })
      if (res.status === 429) {
        throw new Error("You've sent a lot of requests recently — try again later.")
      }
      const data = await readJson(res)
      await refresh(userId)
      return data.status || 'sent'
    } catch (e) {
      if (e.message !== 'no-session') error.value = e.message
      throw e
    }
  }

  async function respond(userId, requestId, action) {
    error.value = null
    try {
      const res = await apiFetch(
        `${API_URL}/friends/requests/${encodeURIComponent(requestId)}/${action}` +
          `?acting_user_id=${encodeURIComponent(userId)}`,
        { method: 'POST' }
      )
      await readJson(res)
      await refresh(userId)
    } catch (e) {
      if (e.message !== 'no-session') error.value = e.message
      throw e
    }
  }

  const acceptRequest = (userId, requestId) => respond(userId, requestId, 'accept')
  const declineRequest = (userId, requestId) => respond(userId, requestId, 'decline')

  /**
   * Remove a friendship. Silent by design (ADR-0005 §1) — the other person is
   * not notified; the edge just disappears from both lists.
   */
  async function removeFriend(userId, otherUserId) {
    error.value = null
    try {
      const res = await apiFetch(
        `${API_URL}/friends/${encodeURIComponent(otherUserId)}` +
          `?acting_user_id=${encodeURIComponent(userId)}`,
        { method: 'DELETE' }
      )
      await readJson(res)
      await refresh(userId)
    } catch (e) {
      if (e.message !== 'no-session') error.value = e.message
      throw e
    }
  }

  /** Force a reload, bypassing the in-flight share. */
  async function refresh(userId) {
    inFlight = null
    return load(userId)
  }

  /** Is this user already a friend? Used by the at-table "Add friend" affordance. */
  function isFriend(otherUserId) {
    return friends.value.some((f) => f.user_id === otherUserId)
  }

  /** Have I already asked them, or they me? Keeps the button from re-offering. */
  function pendingWith(otherUserId) {
    if (outgoing.value.some((r) => r.user_id === otherUserId)) return 'outgoing'
    if (incoming.value.some((r) => r.user_id === otherUserId)) return 'incoming'
    return null
  }

  return {
    friends,
    incoming,
    outgoing,
    loading,
    loaded,
    error,
    needsSession,
    friendCount: computed(() => friends.value.length),
    incomingCount: computed(() => incoming.value.length),
    load,
    refresh,
    reset,
    sendRequest,
    acceptRequest,
    declineRequest,
    removeFriend,
    isFriend,
    pendingWith,
  }
}

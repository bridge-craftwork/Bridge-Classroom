// Carries an accepted table invitation from the app-wide toast (App.vue, where
// Accept mints the ticket) to TableLobbyView, which joins the served table with
// it. Module singleton so it survives the route change. The join ticket never
// travels in a URL (ADR-0006 §2) — it lives here, in memory, for one hop.

import { ref } from 'vue'

// { sessionId, ticket, name, role } | null
const pending = ref(null)

export function useInvitationJoin() {
  function set(payload) {
    pending.value = payload || null
  }
  // Consume the pending join iff it's for `sessionId` (else leave it). Returns
  // the payload or null.
  function take(sessionId) {
    if (pending.value && pending.value.sessionId === sessionId) {
      const v = pending.value
      pending.value = null
      return v
    }
    return null
  }
  return { set, take }
}

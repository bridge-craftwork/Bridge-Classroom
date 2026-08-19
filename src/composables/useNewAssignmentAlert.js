import { ref } from 'vue'

/**
 * "A new assignment landed while you were practising."
 *
 * A student sitting on a lesson page has no reason to visit the lobby, so a freshly
 * dropped assignment used to go unnoticed until they happened to go back. This marks the
 * Lobby button instead of interrupting the lesson.
 *
 * The signal is a watermark, not a push: the newest `assigned_at` among the student's OPEN
 * assignments, compared with the newest they have already seen. That is deliberately the
 * foundation rather than a live event — a push only reaches a tab that is already
 * connected, so the "was something added while I was away?" question still has to be
 * answered from the list on every load. A push (down the existing presence SSE stream)
 * would only shorten the delay, and can be added later without changing any of this.
 *
 * Kept in its own localStorage key rather than the shared `bridgePractice` blob, so a
 * write here can never clobber user or assignment state.
 */
const STORAGE_KEY = 'bridgeAssignmentSeen'

// Singleton state (shared across all component instances)
const hasNewAssignment = ref(false)

function readSeen() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

function writeSeen(map) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // Private mode / quota — the glow just won't persist across reloads.
  }
}

/** Newest assigned_at among assignments still open, as a timestamp (0 if none). */
function newestOpenAt(assignments) {
  let newest = 0
  for (const a of assignments || []) {
    if (a?.closed_at) continue
    const t = Date.parse(a?.assigned_at || '')
    if (!Number.isNaN(t) && t > newest) newest = t
  }
  return newest
}

export function useNewAssignmentAlert() {
  /**
   * Feed a freshly fetched assignment list in. Raises the flag when it contains an open
   * assignment newer than the watermark.
   *
   * The FIRST list a student is ever shown only sets the watermark — it never glows.
   * Otherwise every student would light up on their first visit for work they already
   * know about, which would teach them to ignore the signal.
   */
  function noteAssignments(userId, assignments) {
    if (!userId) return
    const newest = newestOpenAt(assignments)
    const seen = readSeen()

    if (!(userId in seen)) {
      seen[userId] = newest
      writeSeen(seen)
      hasNewAssignment.value = false
      return
    }
    if (newest > (seen[userId] || 0)) hasNewAssignment.value = true
  }

  /** They are looking at the assignment list — clear the mark and move the watermark up. */
  function markSeen(userId, assignments) {
    hasNewAssignment.value = false
    if (!userId) return
    const seen = readSeen()
    seen[userId] = Math.max(newestOpenAt(assignments), seen[userId] || 0)
    writeSeen(seen)
  }

  /** Switching users must not carry the previous student's glow. */
  function reset() {
    hasNewAssignment.value = false
  }

  return { hasNewAssignment, noteAssignments, markSeen, reset }
}

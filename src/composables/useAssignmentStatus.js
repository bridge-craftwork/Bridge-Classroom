import { ref, reactive } from 'vue'
import { API_URL } from '@/utils/apiUrl.js'

const API_KEY = import.meta.env.VITE_API_KEY || ''

// Singleton cache: { "userId::assignmentId" → { entries: [...], fetchedAt } }
// entries: AssignmentStatusEntry[] from /api/assignment-status
//   { deal_subfolder, deal_number, status, last_observation_at }
//   status ∈ { clean_correct, close_correct, corrected, failed, not_attempted }
const cache = reactive({})
const loading = ref(false)
const cacheVersion = ref(0)

const TTL_MS = 30000

/**
 * Fetch a student's per-board status for one assignment from the backend
 * rollup. The canonical source for the assignment progress bar — no
 * client-side observation query. Works for "view as" because it keys off
 * user_id (the server already derived the status; no decryption needed).
 *
 * @param {string} userId
 * @param {string} assignmentId
 * @param {boolean} [force=false] - Bypass the 30s cache
 * @returns {Promise<Array>} AssignmentStatusEntry[]
 */
async function fetchAssignmentStatus(userId, assignmentId, force = false) {
  if (!userId || !assignmentId) return []

  const cacheKey = `${userId}::${assignmentId}`
  if (!force && cache[cacheKey] && Date.now() - cache[cacheKey].fetchedAt < TTL_MS) {
    return cache[cacheKey].entries
  }

  loading.value = true
  try {
    const url = `${API_URL}/assignment-status?user_id=${encodeURIComponent(userId)}&assignment_id=${encodeURIComponent(assignmentId)}`
    const response = await fetch(url, { headers: { 'x-api-key': API_KEY } })

    if (!response.ok) {
      console.error('Failed to fetch assignment status:', response.status)
      return cache[cacheKey]?.entries || []
    }

    const data = await response.json()
    const entries = data.entries || []
    cache[cacheKey] = { entries, fetchedAt: Date.now() }
    return entries
  } catch (err) {
    console.error('Failed to fetch assignment status:', err)
    return cache[cacheKey]?.entries || []
  } finally {
    loading.value = false
  }
}

/** Synchronous read of the reactive cache (null if not fetched). */
function getCachedAssignmentStatus(userId, assignmentId) {
  return cache[`${userId}::${assignmentId}`]?.entries || null
}

/** Invalidate cache for a user (all their assignments), or everything. */
function invalidateCache(userId = null) {
  if (!userId) {
    for (const key in cache) delete cache[key]
    cacheVersion.value++
    return
  }
  const prefix = `${userId}::`
  for (const key in cache) {
    if (key.startsWith(prefix)) delete cache[key]
  }
  cacheVersion.value++
}

export function useAssignmentStatus() {
  return {
    fetchAssignmentStatus,
    getCachedAssignmentStatus,
    invalidateCache,
    cacheVersion,
    loading,
  }
}

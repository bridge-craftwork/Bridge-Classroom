import { ref, reactive } from 'vue'
import { useObservationStore } from './useObservationStore.js'
import { API_URL } from '@/utils/apiUrl.js'

const API_KEY = import.meta.env.VITE_API_KEY || ''

// Singleton cache: { "userId::subfolder" → { boards: [...], fetchedAt: timestamp } }
const cache = reactive({})
// Lesson-mastery cache: { userId → { tiers, entries, fetchedAt } }
//   tiers:   { subfolder → "Exploring"|"Learning"|"Retaining"|"Mastering" }
//   entries: full LessonMasteryEntry[] from /api/lesson-mastery (subfolder, tier,
//            total_boards, attempted_boards, silver_or_better, gold, fresh_paw, deep)
const lessonMasteryCache = reactive({})
const loading = ref(false)
const cacheVersion = ref(0)

// Cooldown: 1 hour in ms (for yellow → orange distinction)
const COOLDOWN_MS = 60 * 60 * 1000

/**
 * Fetch board status from the backend API.
 * Caches by (userId, dealSubfolder) key.
 * @param {string} userId
 * @param {string} [dealSubfolder] - If omitted, fetches all subfolders
 * @param {boolean} [force=false] - Bypass cache
 * @returns {Promise<Array>} Board status entries
 */
async function fetchBoardStatus(userId, dealSubfolder = null, force = false) {
  if (!userId) return []

  const cacheKey = `${userId}::${dealSubfolder || '__all__'}`

  // Return cached if fresh (< 30 seconds) and not forced
  if (!force && cache[cacheKey] && Date.now() - cache[cacheKey].fetchedAt < 30000) {
    return cache[cacheKey].boards
  }

  loading.value = true
  try {
    let url = `${API_URL}/board-status?user_id=${encodeURIComponent(userId)}`
    if (dealSubfolder) {
      url += `&deal_subfolder=${encodeURIComponent(dealSubfolder)}`
    }

    const response = await fetch(url, {
      headers: { 'x-api-key': API_KEY }
    })

    if (!response.ok) {
      console.error('Failed to fetch board status:', response.status)
      return cache[cacheKey]?.boards || []
    }

    const data = await response.json()
    const boards = data.boards || []

    cache[cacheKey] = { boards, fetchedAt: Date.now() }
    return boards
  } catch (err) {
    console.error('Failed to fetch board status:', err)
    return cache[cacheKey]?.boards || []
  } finally {
    loading.value = false
  }
}

/**
 * Invalidate cache for a specific user/subfolder, or all caches.
 */
function invalidateCache(userId = null, dealSubfolder = null) {
  if (!userId) {
    // Clear all
    for (const key in cache) {
      delete cache[key]
    }
    cacheVersion.value++
    return
  }

  const prefix = `${userId}::`
  for (const key in cache) {
    if (key.startsWith(prefix)) {
      if (!dealSubfolder || key === `${userId}::${dealSubfolder}` || key === `${userId}::__all__`) {
        delete cache[key]
      }
    }
  }
  cacheVersion.value++
}

/**
 * Get the display color for a board status, applying cooldown decay.
 * See CORRECTNESS_AND_MASTERY.md §5.3.
 *
 * Stored status values:
 *   - 'failed'         → red
 *   - 'corrected'      → yellow if last_error_date is within cooldown, else orange
 *   - 'close_correct'  → yellow if last_error_date is within cooldown, else orange
 *   - 'clean_correct'  → green
 *   - 'not_attempted'  → grey
 *
 * `corrected` and `close_correct` share the same color schedule but
 * are distinct stored values pedagogically.
 *
 * @param {string} status - Board status from API
 * @param {string|null} [lastErrorDate] - ISO timestamp of most recent error, or null
 * @returns {string} CSS color class name
 */
function getDisplayColor(status, lastErrorDate) {
  switch (status) {
    case 'failed':
      return 'red'
    case 'corrected':
    case 'close_correct': {
      if (!lastErrorDate) return 'orange'
      const age = Date.now() - new Date(lastErrorDate).getTime()
      return age < COOLDOWN_MS ? 'yellow' : 'orange'
    }
    case 'clean_correct':
      return 'green'
    case 'not_attempted':
    default:
      return 'grey'
  }
}

/**
 * Map max_stars to the legacy "achievement" string used by older UI
 * components. Per CORRECTNESS_AND_MASTERY.md §6.4:
 *   max_stars = 0 → no badge
 *   max_stars = 1 → silver
 *   max_stars >= 2 → gold (capped)
 *
 * Components that need richer information should read `max_stars`
 * directly from the mastery entry. This shim exists so older components
 * (BoardMasteryStrip, AccomplishmentsView, etc.) keep rendering during
 * the rollout.
 *
 * @param {number} maxStars
 * @returns {'none'|'silver'|'gold'}
 */
function achievementFromMaxStars(maxStars) {
  if (!maxStars || maxStars <= 0) return 'none'
  if (maxStars === 1) return 'silver'
  return 'gold'
}

/**
 * Compute board mastery from API data, with local pending overlay.
 * This replaces useBoardMastery's computeBoardMastery for the online path.
 *
 * @param {Array} apiBoards - Board status entries from fetchBoardStatus
 * @param {Array<number>} boardNumbers - All board numbers in the lesson
 * @returns {Array<{boardNumber, status, achievement, lastObservationAt}>}
 */
function buildBoardMastery(apiBoards, boardNumbers) {
  // Index API data by deal_number
  const byNumber = {}
  for (const b of apiBoards) {
    byNumber[b.deal_number] = b
  }

  return boardNumbers.map(bn => {
    const entry = byNumber[bn]
    if (!entry) {
      return {
        boardNumber: bn,
        status: 'grey',
        apiStatus: 'not_attempted',
        achievement: 'none',
        maxStars: 0,
        wildAchievement: null,
        wilderness: 'Tame',
        lastErrorDate: null,
        lastStarUpdate: null,
        lastObservationAt: null
      }
    }
    return {
      boardNumber: bn,
      // Display color derived from stored status + cooldown decay
      // against last_error_date. See §5.3 of the doc.
      status: getDisplayColor(entry.status, entry.last_error_date),
      // Raw §5.1 stored state, preserved so consumers can bucket by
      // spec vocabulary (e.g. distinguish close_correct from corrected).
      apiStatus: entry.status || 'not_attempted',
      // Backwards-compat string for components that still read
      // `board.achievement`. New components should read `maxStars`
      // (and `wildAchievement`) directly.
      achievement: achievementFromMaxStars(entry.max_stars),
      maxStars: entry.max_stars || 0,
      wildAchievement: entry.wild_achievement || null,
      wilderness: entry.wilderness || 'Tame',
      lastErrorDate: entry.last_error_date || null,
      lastStarUpdate: entry.last_star_update || null,
      lastObservationAt: entry.last_observation_at || null
    }
  })
}

/**
 * Merge local pending observations into board mastery results.
 * Pending observations that haven't synced yet override the API data.
 * @param {Array} mastery - Output of buildBoardMastery
 * @param {string} lessonSubfolder
 */
function mergeLocalPending(mastery, lessonSubfolder) {
  try {
    const observationStore = useObservationStore()
    const pending = observationStore.getPendingObservations()

    for (const obs of pending) {
      if (!obs.metadata) continue
      if (obs.metadata.deal_subfolder !== lessonSubfolder) continue

      const bn = obs.metadata.deal_number
      const board = mastery.find(b => b.boardNumber === bn)
      if (!board) continue

      // Local pending observation overrides the API status
      const boardResult = obs.metadata.board_result
      if (boardResult === 'failed') {
        board.status = 'red'
      } else if (boardResult === 'corrected') {
        board.status = 'yellow'
      } else if (boardResult === 'correct') {
        // Could be fresh or clean — for local display, show green
        board.status = 'green'
      } else {
        // Fallback for observations without board_result
        board.status = obs.metadata.correct ? 'green' : 'red'
      }
    }
  } catch {
    // Observation store not available
  }
}

/**
 * Read cached board status synchronously. Returns the cached array
 * (possibly empty) or null if the cache hasn't been populated for
 * this (userId, dealSubfolder). Reads the reactive cache, so calls
 * from inside a Vue `computed()` re-run when the cache changes.
 *
 * Callers must trigger `fetchBoardStatus(userId, subfolder)` (typically
 * on component mount) to populate the cache.
 *
 * @param {string} userId
 * @param {string} [dealSubfolder]
 * @returns {Array|null}
 */
function getCachedBoards(userId, dealSubfolder = null) {
  if (!userId) return null
  const cacheKey = `${userId}::${dealSubfolder || '__all__'}`
  return cache[cacheKey]?.boards || null
}

/**
 * Fetch per-lesson mastery tiers (Exploring / Learning / Retaining /
 * Mastering) for a user. Caches by userId. See
 * `documentation/CORRECTNESS_AND_MASTERY.md` §13.
 *
 * @param {string} userId
 * @param {boolean} [force=false] - Bypass cache
 * @returns {Promise<Object<string,string>>} Map subfolder → tier
 */
async function fetchLessonMastery(userId, force = false) {
  if (!userId) return {}
  const entry = lessonMasteryCache[userId]
  if (!force && entry && Date.now() - entry.fetchedAt < 30000) {
    return entry.tiers
  }

  try {
    const res = await fetch(
      `${API_URL}/lesson-mastery?user_id=${encodeURIComponent(userId)}`,
      { headers: { 'x-api-key': API_KEY } }
    )
    if (!res.ok) {
      console.error('Failed to fetch lesson mastery:', res.status)
      return lessonMasteryCache[userId]?.tiers || {}
    }
    const data = await res.json()
    const entries = data.lessons || []
    const tiers = {}
    for (const entry of entries) {
      if (entry.deal_subfolder && entry.tier) {
        tiers[entry.deal_subfolder] = entry.tier
      }
    }
    lessonMasteryCache[userId] = { tiers, entries, fetchedAt: Date.now() }
    cacheVersion.value++
    return tiers
  } catch (err) {
    console.error('Failed to fetch lesson mastery:', err)
    return lessonMasteryCache[userId]?.tiers || {}
  }
}

/**
 * Read cached lesson mastery tiers synchronously. Returns the map
 * subfolder → tier (possibly empty) or null if not yet fetched.
 *
 * @param {string} userId
 * @returns {Object<string,string>|null}
 */
function getCachedLessonTiers(userId) {
  if (!userId) return null
  return lessonMasteryCache[userId]?.tiers || null
}

/**
 * Read cached lesson-mastery entries synchronously — the full set of
 * lessons the user has touched, with attempted/total counts and tier.
 * Returns null if not yet fetched.
 *
 * @param {string} userId
 * @returns {Array|null}
 */
function getCachedLessonEntries(userId) {
  if (!userId) return null
  return lessonMasteryCache[userId]?.entries || null
}

export function useBoardStatus() {
  return {
    loading,
    cacheVersion,
    fetchBoardStatus,
    invalidateCache,
    getDisplayColor,
    buildBoardMastery,
    mergeLocalPending,
    getCachedBoards,
    fetchLessonMastery,
    getCachedLessonTiers,
    getCachedLessonEntries
  }
}

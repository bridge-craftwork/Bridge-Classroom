import { computed } from 'vue'
import { useBoardMastery } from './useBoardMastery.js'
import { useBoardStatus } from './useBoardStatus.js'
import { useAccomplishments } from './useAccomplishments.js'
import { useAppConfig } from './useAppConfig.js'
import { useUserStore } from './useUserStore.js'

const MAX_RECENT = 6

/**
 * Format a timestamp into a relative time string.
 * @param {string} timestamp - ISO8601 timestamp
 * @returns {string}
 */
function formatRelativeTime(timestamp) {
  if (!timestamp) return ''
  const diff = Date.now() - new Date(timestamp).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 14) return 'Last week'
  const weeks = Math.floor(days / 7)
  return `${weeks} weeks ago`
}

export function useRecentLessons() {
  const mastery = useBoardMastery()
  const boardStatusApi = useBoardStatus()
  const accomplishments = useAccomplishments()
  const appConfig = useAppConfig()
  const userStore = useUserStore()

  /**
   * Reactive list of recent lessons with mastery data.
   *
   * Mastery comes from the backend's `board_status` table via
   * `useBoardStatus`. The cache is populated by `ensureLessonData()`,
   * called once on mount by the consuming component. Until the cache
   * is populated, lessons show with zero-attempt boards (all grey).
   *
   * In admin "View as user" mode the lesson list is sourced from the
   * server's `/api/lesson-mastery` endpoint instead of the local
   * observation store (which holds the admin's data, not the viewed
   * user's). lastActivity is derived from the max `last_observation_at`
   * across the user's board_status rows for each lesson.
   */
  const recentLessons = computed(() => {
    const userId = userStore.effectiveUserId.value
    // Touch the cache version so the computed re-runs after invalidation.
    boardStatusApi.cacheVersion.value

    const boardCounts = mastery.boardCountCache.value

    // The lesson list comes from the server's /api/lesson-mastery rollup
    // (derived from board_status) for both self and view-as — no client-side
    // observation query. The cache is populated by ensureLessonData().
    const entries = userId ? (boardStatusApi.getCachedLessonEntries(userId) || []) : []
    const lessons = entries
      .filter(e => (e.attempted_boards || 0) > 0)
      .map(e => {
        const subfolder = e.deal_subfolder
        const cached = boardCounts[subfolder]
        let boardNumbers = cached
        if (!boardNumbers) {
          boardNumbers = []
          for (let i = 1; i <= (e.total_boards || 0); i++) boardNumbers.push(i)
        }
        // The server rollup is grouped by (collection_id, deal_subfolder), so
        // each entry already carries its own collection. Use it directly rather
        // than the single-valued subfolder→collection map, which mis-scopes a
        // subfolder shared across collections.
        return { subfolder, collectionId: e.collection_id || null, boardNumbers, lastActivity: null }
      })

    if (lessons.length === 0) return []

    const tiersByLesson = userId
      ? (boardStatusApi.getCachedLessonTiers(userId) || {})
      : {}

    const enriched = lessons.map(lesson => {
      // Collection scope must match ensureLessonData's fetch for the cache to
      // hit. Carried from the server rollup entry (see above), not the map.
      const lessonCollectionId = lesson.collectionId
      const apiBoards = userId
        ? (boardStatusApi.getCachedBoards(userId, lesson.subfolder, lessonCollectionId) || [])
        : []
      const boards = boardStatusApi.buildBoardMastery(apiBoards, lesson.boardNumbers)

      // Bucket per CORRECTNESS_AND_MASTERY.md §5.1 stored states.
      // close_correct and corrected share the orange swatch per §5.4
      // drilldown rule, so we sum them into one display bucket here.
      const stateCounts = {
        clean_correct: 0,
        close_correct: 0,
        corrected: 0,
        failed: 0,
        not_attempted: 0,
      }
      for (const b of boards) {
        const s = b.apiStatus || 'not_attempted'
        if (stateCounts[s] !== undefined) stateCounts[s]++
        else stateCounts.not_attempted++
      }
      const totalBoards = boards.length
      const triedCount = totalBoards - stateCounts.not_attempted

      // Star / paw achievement tallies for the tile badges. Stars: gold =
      // max_stars ≥ 2, silver = exactly 1. Paws: Fresh / Recent wild masteries.
      const goldStars = boards.filter(b => (b.maxStars || 0) >= 2).length
      const silverStars = boards.filter(b => (b.maxStars || 0) === 1).length
      const freshPaws = boards.filter(b => b.wildAchievement === 'Fresh').length
      const recentPaws = boards.filter(b => b.wildAchievement === 'Recent').length

      // Resume target: first untried board, or board 1 if all attempted
      const firstUntried = boards.find(b => b.apiStatus === 'not_attempted')
      const resumeDealNumber = firstUntried ? firstUntried.boardNumber : 1

      // Collection mapping (resolved above as lessonCollectionId)
      const collectionId = lessonCollectionId
      const collection = collectionId
        ? appConfig.COLLECTIONS.find(c => c.id === collectionId)
        : null

      // In view-as mode, derive lastActivity from the latest
      // last_observation_at across the user's board_status rows.
      let lastActivity = lesson.lastActivity
      if (!lastActivity) {
        for (const b of apiBoards) {
          const t = b.last_observation_at
          if (t && (!lastActivity || t > lastActivity)) lastActivity = t
        }
      }

      return {
        subfolder: lesson.subfolder,
        displayName: accomplishments.formatLessonName(lesson.subfolder),
        collectionName: collection?.name || null,
        collectionId,
        totalBoards,
        tried: triedCount,
        stateCounts,
        resumeDealNumber,
        lastActivity,
        relativeTime: lastActivity ? formatRelativeTime(lastActivity) : '',
        // Lesson mastery tier per CORRECTNESS_AND_MASTERY.md §13.
        // Null until /api/lesson-mastery has been fetched.
        tier: tiersByLesson[lesson.subfolder] || null,
        // Achievement tallies for the tile badges.
        goldStars,
        silverStars,
        freshPaws,
        recentPaws
      }
    })

    enriched.sort((a, b) => {
      if (a.lastActivity && b.lastActivity) return b.lastActivity.localeCompare(a.lastActivity)
      if (a.lastActivity) return -1
      if (b.lastActivity) return 1
      return 0
    })
    return enriched.slice(0, MAX_RECENT)
  })

  const hasRecentLessons = computed(() => recentLessons.value.length > 0)

  const totalStartedLessons = computed(() => {
    const userId = userStore.effectiveUserId.value
    // Touch the cache version so this computed reacts to fetches.
    boardStatusApi.cacheVersion.value
    const entries = userId ? (boardStatusApi.getCachedLessonEntries(userId) || []) : []
    return entries.filter(e => (e.attempted_boards || 0) > 0).length
  })

  /**
   * Populate caches the lobby needs: board-number cache (for the
   * "X of N boards mastered" count) and the `board_status` cache for
   * each lesson. Called once on mount by the consuming component and
   * re-called when the effective user changes (e.g. entering view-as).
   *
   * In view-as mode the subfolder list is sourced from the server's
   * lesson-mastery endpoint, since local observations belong to the
   * admin, not the impersonated user.
   */
  async function ensureLessonData() {
    const userId = userStore.effectiveUserId.value
    if (!userId) return

    // lesson-mastery (derived from board_status) is the source of truth for
    // which lessons the user has touched — for both self and view-as.
    await boardStatusApi.fetchLessonMastery(userId, true)
    const entries = boardStatusApi.getCachedLessonEntries(userId) || []
    // Fetch board-status per (subfolder, collection_id) so a shared subfolder's
    // two collections are cached under distinct scopes — matching the scope
    // recentLessons reads back with. Collection comes from the rollup entry.
    const scoped = entries
      .filter(e => (e.attempted_boards || 0) > 0)
      .map(e => ({ subfolder: e.deal_subfolder, collectionId: e.collection_id || null }))
    if (scoped.length === 0) return

    await mastery.fetchMissingBoardCounts(scoped.map(s => s.subfolder))
    await Promise.all(scoped.map(s =>
      boardStatusApi.fetchBoardStatus(userId, s.subfolder, false, s.collectionId)
    ))
  }

  return {
    recentLessons,
    hasRecentLessons,
    totalStartedLessons,
    // Old name kept for the existing component that calls it; functionally
    // it now also fetches board_status for each lesson.
    ensureBoardCounts: ensureLessonData,
    ensureLessonData
  }
}

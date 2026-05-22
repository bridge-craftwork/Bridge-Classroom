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
   */
  const recentLessons = computed(() => {
    const allObs = mastery.getObservations()
    if (allObs.length === 0) return []

    const lessons = mastery.extractLessonsFromObservations(allObs)
    if (lessons.length === 0) return []

    const userId = userStore.currentUserId.value
    // Touch the cache version so the computed re-runs after invalidation.
    boardStatusApi.cacheVersion.value

    const tiersByLesson = userId
      ? (boardStatusApi.getCachedLessonTiers(userId) || {})
      : {}

    const enriched = lessons.map(lesson => {
      const apiBoards = userId
        ? (boardStatusApi.getCachedBoards(userId, lesson.subfolder) || [])
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

      // Resume target: first untried board, or board 1 if all attempted
      const firstUntried = boards.find(b => b.apiStatus === 'not_attempted')
      const resumeDealNumber = firstUntried ? firstUntried.boardNumber : 1

      // Collection mapping
      const collectionId = mastery.getLessonCollection(lesson.subfolder)
      const collection = collectionId
        ? appConfig.COLLECTIONS.find(c => c.id === collectionId)
        : null

      return {
        subfolder: lesson.subfolder,
        displayName: accomplishments.formatLessonName(lesson.subfolder),
        collectionName: collection?.name || null,
        collectionId,
        totalBoards,
        tried: triedCount,
        stateCounts,
        resumeDealNumber,
        lastActivity: lesson.lastActivity,
        relativeTime: formatRelativeTime(lesson.lastActivity),
        // Lesson mastery tier per CORRECTNESS_AND_MASTERY.md §13.
        // Null until /api/lesson-mastery has been fetched.
        tier: tiersByLesson[lesson.subfolder] || null
      }
    })

    enriched.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity))
    return enriched.slice(0, MAX_RECENT)
  })

  const hasRecentLessons = computed(() => recentLessons.value.length > 0)

  const totalStartedLessons = computed(() => {
    const allObs = mastery.getObservations()
    if (allObs.length === 0) return 0
    return mastery.extractLessonsFromObservations(allObs).length
  })

  /**
   * Populate caches the lobby needs: board-number cache (for the
   * "X of N boards mastered" count) and the `board_status` cache for
   * each lesson. Called once on mount by the consuming component.
   */
  async function ensureLessonData() {
    const allObs = mastery.getObservations()
    const lessons = mastery.extractLessonsFromObservations(allObs)
    const subfolders = lessons.map(l => l.subfolder)
    if (subfolders.length === 0) return

    await mastery.fetchMissingBoardCounts(subfolders)

    const userId = userStore.currentUserId.value
    if (userId) {
      await Promise.all([
        ...subfolders.map(sf => boardStatusApi.fetchBoardStatus(userId, sf)),
        boardStatusApi.fetchLessonMastery(userId)
      ])
    }
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

import { ref } from 'vue'
import { useAccomplishments } from './useAccomplishments.js'
import { useObservationStore } from './useObservationStore.js'
import { useAppConfig } from './useAppConfig.js'

// Current status values
const STATUS = {
  GREY: 'grey',
  RED: 'red',
  YELLOW: 'yellow',
  ORANGE: 'orange',
  GREEN: 'green'
}

// Achievement values (permanent once earned)
const ACHIEVEMENT = {
  NONE: 'none',
  SILVER: 'silver',
  GOLD: 'gold'
}

// Achievement spacing: minimum days between qualifying green days
const ACHIEVEMENT_SPACING_DAYS = 6

/**
 * Get date string "YYYY-MM-DD" from a timestamp
 * @param {string} dateStr - ISO8601 timestamp
 * @returns {string}
 */
function getDateStr(dateStr) {
  return dateStr.slice(0, 10)
}

/**
 * Get the number of days between two "YYYY-MM-DD" date strings
 */
function daysBetween(dateStr1, dateStr2) {
  const d1 = new Date(dateStr1 + 'T00:00:00Z')
  const d2 = new Date(dateStr2 + 'T00:00:00Z')
  return Math.round(Math.abs(d2 - d1) / 86400000)
}

/**
 * Group observations for a single board into board attempts.
 * A board attempt is one practice session on a board.
 * The attempt is "correct" only if ALL observations in the session are correct.
 *
 * @param {Array} observations - Observations for one (subfolder, deal_number)
 * @returns {Array<{timestamp: string, correct: boolean, sessionId: string}>} sorted ascending
 */
function groupIntoBoardAttempts(observations) {
  if (observations.length === 0) return []

  const bySession = {}
  for (const obs of observations) {
    const sid = obs.session_id || obs.id || 'unknown'
    if (!bySession[sid]) {
      bySession[sid] = { observations: [], latestTimestamp: obs.timestamp }
    }
    bySession[sid].observations.push(obs)
    if (obs.timestamp > bySession[sid].latestTimestamp) {
      bySession[sid].latestTimestamp = obs.timestamp
    }
  }

  return Object.values(bySession)
    .map(group => ({
      timestamp: group.latestTimestamp,
      correct: group.observations.every(o => o.correct),
      sessionId: group.observations[0].session_id || group.observations[0].id
    }))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

// Cooldown period: failures within this window affect status
const COOLDOWN_MS = 60 * 60 * 1000 // 1 hour

/**
 * Calculate current status for a board based on its observations.
 *
 * Rules (evaluated in order):
 * 1. No observations → GREY
 * 2. Most recent not correct → RED
 * 3. Any failure within past hour → YELLOW
 * 4. Most recent success within 1hr after most recent failure → ORANGE
 * 5. Else → GREEN
 *
 * @param {Array} observations - All observations for this board, sorted ascending by timestamp
 * @returns {string} STATUS value
 */
function calculateCurrentStatus(observations) {
  if (observations.length === 0) return STATUS.GREY

  const mostRecent = observations[observations.length - 1]
  if (!mostRecent.correct) return STATUS.RED

  // Any failure within the past hour?
  const oneHourAgo = Date.now() - COOLDOWN_MS
  const hasRecentFailure = observations.some(
    o => !o.correct && new Date(o.timestamp).getTime() > oneHourAgo
  )
  if (hasRecentFailure) return STATUS.YELLOW

  // Most recent success within 1hr after most recent failure?
  const lastFailure = observations.filter(o => !o.correct).pop()
  if (!lastFailure) return STATUS.GREEN // No failures ever

  const lastFailureTime = new Date(lastFailure.timestamp).getTime()
  const mostRecentTime = new Date(mostRecent.timestamp).getTime()
  if (mostRecentTime - lastFailureTime <= COOLDOWN_MS) return STATUS.ORANGE

  return STATUS.GREEN
}

/**
 * Check if a board had a "green day" on a given date.
 * A green day means: the board was practiced AND all observations that day were correct.
 *
 * @param {Array} observations - All observations for this board
 * @param {string} dateStr - "YYYY-MM-DD"
 * @returns {boolean}
 */
function hasGreenDay(observations, dateStr) {
  const dayObs = observations.filter(o => o.timestamp.startsWith(dateStr))
  if (dayObs.length === 0) return false
  return dayObs.every(o => o.correct)
}

/**
 * Calculate achievement for a board.
 * Collects "green days" (dates where all observations were correct) and finds
 * the longest chain where each consecutive pair is at least ACHIEVEMENT_SPACING_DAYS apart.
 * Silver = chain of 2, Gold = chain of 3+.
 *
 * @param {Array} observations - All observations for this board, sorted ascending by timestamp
 * @returns {string} ACHIEVEMENT value
 */
function calculateAchievement(observations) {
  if (observations.length === 0) return ACHIEVEMENT.NONE

  // Collect all unique dates with observations
  const dateSet = new Set()
  for (const obs of observations) {
    dateSet.add(getDateStr(obs.timestamp))
  }

  // Find green days (all observations on that date were correct) and sort them
  const greenDays = [...dateSet]
    .filter(dateStr => hasGreenDay(observations, dateStr))
    .sort()

  if (greenDays.length < 2) return ACHIEVEMENT.NONE

  // Find the longest chain of green days where each pair is >= ACHIEVEMENT_SPACING_DAYS apart
  let maxChain = 1
  let currentChain = 1
  let lastQualifying = greenDays[0]

  for (let i = 1; i < greenDays.length; i++) {
    const gap = daysBetween(lastQualifying, greenDays[i])
    if (gap >= ACHIEVEMENT_SPACING_DAYS) {
      currentChain++
      lastQualifying = greenDays[i]
      if (currentChain > maxChain) maxChain = currentChain
    }
  }

  if (maxChain >= 3) return ACHIEVEMENT.GOLD
  if (maxChain >= 2) return ACHIEVEMENT.SILVER
  return ACHIEVEMENT.NONE
}

/**
 * Get all observations including local pending ones (for immediate reactivity).
 * Deduplicates by observation_id.
 */
function getAllObservationsIncludingLocal(accomplishments) {
  const synced = accomplishments.observations.value || []

  let local = []
  try {
    const observationStore = useObservationStore()
    const pending = observationStore.getPendingObservations()
    local = pending
      .filter(o => o.metadata)
      .map(o => {
        const meta = o.metadata
        return {
          id: meta.observation_id || 'local-' + Math.random().toString(36).slice(2),
          timestamp: meta.timestamp || o.queuedAt,
          skill_path: meta.skill_path,
          correct: meta.correct,
          deal_subfolder: meta.deal_subfolder,
          deal_number: meta.deal_number,
          session_id: meta.session_id,
          _local: true
        }
      })
  } catch {
    // If observation store isn't available, just use synced data
  }

  // Deduplicate: synced wins over local
  const ids = new Set(synced.map(o => o.id))
  const uniqueLocal = local.filter(o => !ids.has(o.id))

  return [...synced, ...uniqueLocal]
}

/**
 * Raw mastery computation over an arbitrary subset of observations.
 *
 * NOTE: This is **not** the canonical path for board state or
 * Silver/Gold stars — those come from the backend `board_status` table
 * via `useBoardStatus` (CORRECTNESS_AND_MASTERY.md §10). This function
 * is retained for **exercise / assignment scoring** that needs to
 * compute board outcomes over a *date-bounded slice* of observations
 * (e.g. "how is the student doing on the boards in this assignment,
 * counting only plays since assigned_at?"). The doc says those modes
 * do not contribute to board-level mastery (§8); they have their own
 * scoring, which is what this function powers.
 *
 * @param {Array} allObservations - Observations to search through (may
 *   already be filtered by date or otherwise)
 * @param {string} lessonSubfolder
 * @param {Array<number>} boardNumbers
 * @returns {Array<{boardNumber, status, achievement, attemptCount, lastAttemptTime}>}
 */
function computeBoardMastery(allObservations, lessonSubfolder, boardNumbers) {
  if (!lessonSubfolder || !boardNumbers || boardNumbers.length === 0) return []

  const lessonObs = allObservations.filter(
    o => (o.deal_subfolder || o.deal?.subfolder) === lessonSubfolder
  )

  return boardNumbers.map(bn => {
    const boardObs = lessonObs
      .filter(o => (o.deal_number ?? o.deal?.deal_number) === bn)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))

    // Group by session for attempt count display only
    const attempts = groupIntoBoardAttempts(boardObs)

    return {
      boardNumber: bn,
      status: calculateCurrentStatus(boardObs),
      achievement: calculateAchievement(boardObs),
      attemptCount: attempts.length,
      lastAttemptTime: boardObs.length > 0
        ? boardObs[boardObs.length - 1].timestamp
        : null
    }
  })
}

/**
 * Compute lesson-level achievement from board mastery results.
 * Gold if all boards have Gold, Silver if all have Silver+.
 *
 * @param {Array} boardMasteryList - Output of computeBoardMastery
 * @returns {{achievement: string}}
 */
function computeLessonAchievement(boardMasteryList) {
  if (!boardMasteryList || boardMasteryList.length === 0) {
    return { achievement: ACHIEVEMENT.NONE }
  }

  const allGold = boardMasteryList.every(b => b.achievement === ACHIEVEMENT.GOLD)
  if (allGold) return { achievement: ACHIEVEMENT.GOLD }

  const allSilverOrGold = boardMasteryList.every(
    b => b.achievement === ACHIEVEMENT.SILVER || b.achievement === ACHIEVEMENT.GOLD
  )
  if (allSilverOrGold) return { achievement: ACHIEVEMENT.SILVER }

  return { achievement: ACHIEVEMENT.NONE }
}

// Reactive cache of lesson board numbers (singleton)
const LESSON_BOARDS_KEY = 'bridgeLessonBoards'
const boardCountCache = ref(loadBoardCacheFromStorage())
const fetchesInFlight = new Set()

// Collection mapping cache (subfolder → collectionId)
const LESSON_COLLECTIONS_KEY = 'bridgeLessonCollections'
const collectionCache = ref(loadCollectionCacheFromStorage())

function loadCollectionCacheFromStorage() {
  try {
    const stored = localStorage.getItem(LESSON_COLLECTIONS_KEY)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}

function persistCollectionCache() {
  try {
    localStorage.setItem(LESSON_COLLECTIONS_KEY, JSON.stringify(collectionCache.value))
  } catch {
    // localStorage unavailable
  }
}

/**
 * Save the collection mapping for a lesson subfolder.
 * @param {string} subfolder - Lesson subfolder identifier
 * @param {string} collectionId - Collection ID (e.g. 'baker-bridge')
 */
function saveLessonCollection(subfolder, collectionId) {
  if (!subfolder || !collectionId) return
  collectionCache.value = { ...collectionCache.value, [subfolder]: collectionId }
  persistCollectionCache()
}

/**
 * Get the collection ID for a lesson subfolder, or null if unknown.
 * @param {string} subfolder
 * @returns {string|null}
 */
function getLessonCollection(subfolder) {
  return collectionCache.value[subfolder] || null
}

function loadBoardCacheFromStorage() {
  try {
    const stored = localStorage.getItem(LESSON_BOARDS_KEY)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}

function persistBoardCache() {
  try {
    localStorage.setItem(LESSON_BOARDS_KEY, JSON.stringify(boardCountCache.value))
  } catch {
    // localStorage unavailable
  }
}

/**
 * Save the board numbers for a lesson (called when a PBN is loaded for practice).
 * Updates both the reactive cache and localStorage.
 * @param {string} subfolder - Lesson subfolder identifier
 * @param {number[]} boardNumbers - All board numbers in the lesson
 */
function saveLessonBoardNumbers(subfolder, boardNumbers) {
  boardCountCache.value = { ...boardCountCache.value, [subfolder]: boardNumbers }
  persistBoardCache()
}

/**
 * Parse board numbers from raw PBN content without full parse.
 * @param {string} content - PBN file content
 * @returns {number[]} Sorted board numbers
 */
function parseBoardNumbersFromPbn(content) {
  const numbers = []
  const regex = /\[Board\s+"?(\d+)"?\]/g
  let match
  while ((match = regex.exec(content)) !== null) {
    numbers.push(parseInt(match[1], 10))
  }
  return numbers.sort((a, b) => a - b)
}

/**
 * Fetch board numbers for uncached lessons from GitHub.
 * Tries each collection's baseUrl until a PBN is found.
 * Updates the reactive cache, causing components to re-render.
 * @param {string[]} subfolders - Lesson subfolders to resolve
 */
async function fetchMissingBoardCounts(subfolders) {
  const appConfig = useAppConfig()
  const missing = subfolders.filter(
    sf => !boardCountCache.value[sf] && !fetchesInFlight.has(sf)
  )
  if (missing.length === 0) return

  for (const subfolder of missing) {
    fetchesInFlight.add(subfolder)
  }

  await Promise.all(missing.map(async (subfolder) => {
    try {
      for (const collection of appConfig.COLLECTIONS) {
        const filename = subfolder.includes('/') ? subfolder.split('/').pop() : subfolder
        const url = `${collection.baseUrl}/${filename}.pbn`
        try {
          const response = await fetch(url)
          if (!response.ok) continue
          const content = await response.text()
          const boardNumbers = parseBoardNumbersFromPbn(content)
          if (boardNumbers.length > 0) {
            saveLessonBoardNumbers(subfolder, boardNumbers)
            break
          }
        } catch {
          continue
        }
      }
    } finally {
      fetchesInFlight.delete(subfolder)
    }
  }))
}

/**
 * Extract unique lessons and their board numbers from observations.
 * Uses the reactive board cache to show all boards (including grey).
 * Falls back to 1..max(observed) if not yet cached.
 * @param {Array} observations - All observations
 * @returns {Array<{subfolder: string, boardNumbers: number[], lastActivity: string}>}
 */
function extractLessonsFromObservations(observations) {
  // Read the reactive ref so Vue tracks this dependency
  const cache = boardCountCache.value

  const lessons = {}
  for (const obs of observations) {
    const subfolder = obs.deal_subfolder || obs.deal?.subfolder
    const boardNum = obs.deal_number ?? obs.deal?.deal_number
    if (!subfolder || boardNum == null) continue
    if (!lessons[subfolder]) {
      lessons[subfolder] = { boards: new Set(), lastActivity: obs.timestamp }
    }
    lessons[subfolder].boards.add(boardNum)
    if (obs.timestamp > lessons[subfolder].lastActivity) {
      lessons[subfolder].lastActivity = obs.timestamp
    }
  }
  return Object.entries(lessons).map(([subfolder, data]) => {
    const cached = cache[subfolder]
    if (cached) {
      return {
        subfolder,
        boardNumbers: cached,
        lastActivity: data.lastActivity
      }
    }
    // Fallback: generate range 1..max from observed boards
    const maxBoard = Math.max(...data.boards)
    const allBoards = []
    for (let i = 1; i <= maxBoard; i++) allBoards.push(i)
    return {
      subfolder,
      boardNumbers: allBoards,
      lastActivity: data.lastActivity
    }
  })
}

export function useBoardMastery() {
  const accomplishments = useAccomplishments()

  /**
   * Get all observations (synced + local pending) for mastery computation.
   * Use inside computed() for reactivity.
   */
  function getObservations() {
    return getAllObservationsIncludingLocal(accomplishments)
  }

  return {
    STATUS,
    ACHIEVEMENT,
    getObservations,
    computeBoardMastery,
    computeLessonAchievement,
    extractLessonsFromObservations,
    saveLessonBoardNumbers,
    fetchMissingBoardCounts,
    boardCountCache,
    saveLessonCollection,
    getLessonCollection,
    // Exposed for testing
    groupIntoBoardAttempts,
    calculateCurrentStatus,
    calculateAchievement,
    hasGreenDay,
    daysBetween
  }
}

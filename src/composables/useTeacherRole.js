import { ref, computed } from 'vue'
import { useUserStore } from './useUserStore.js'
import { useBoardMastery } from './useBoardMastery.js'
import { useAccomplishments } from './useAccomplishments.js'
import { decryptSharingGrant, decryptObservation } from '../utils/crypto.js'
import { API_URL } from '@/utils/apiUrl.js'
import { apiFetch } from '@/utils/apiFetch.js'

// Singleton state
const isTeacher = ref(false)
const viewerId = ref(null)
const students = ref([])           // { id, first_name, last_name, email, classroom }
const studentObservations = ref({}) // Map<userId, observations[]> (drilldown only)
const studentRawObservations = ref({}) // Map<userId, rawObservations[]> (drilldown only)
const studentSummaries = ref({})    // Map<userId, StudentSummaryEntry> from /api/student-summaries
const loading = ref(false)
const error = ref(null)
const initialized = ref(false)

// Cache timestamps per student
const fetchTimestamps = {}
const CACHE_DURATION_MS = 2 * 60 * 1000 // 2 minutes

// Student key cache: Map<userId, aesKeyBase64>
const studentKeyCache = {}
// Grants cache (fetched once per session)
let grantsCache = null

/**
 * Check if the current user is a teacher (has a viewer record with grants).
 * Called after login.
 */
async function checkTeacherStatus() {
  const userStore = useUserStore()
  const currentUser = userStore.currentUser.value
  if (!currentUser || !currentUser.email) {
    isTeacher.value = false
    return
  }

  try {
    // 1. Look up viewer by email
    const viewerRes = await apiFetch(
      `${API_URL}/viewers?email=${encodeURIComponent(currentUser.email)}`
    )
    if (!viewerRes.ok) return

    const viewers = await viewerRes.json()
    const viewer = Array.isArray(viewers) ? viewers[0] : null
    if (!viewer) return

    viewerId.value = viewer.id

    // 2. Fetch grants where this viewer is grantee
    const grantsRes = await apiFetch(
      `${API_URL}/grants?grantee_id=${viewer.id}`
    )
    if (!grantsRes.ok) return

    const grantsData = await grantsRes.json()
    const grants = grantsData.grants || []

    // Filter out self-grants
    const studentIds = new Set(
      grants
        .filter(g => g.grantor_id !== currentUser.id)
        .map(g => g.grantor_id)
    )

    if (studentIds.size === 0) return

    // 3. Fetch user details
    const usersRes = await apiFetch(
      `${API_URL}/users`
    )
    if (!usersRes.ok) return

    const usersData = await usersRes.json()
    const allUsers = usersData.users || []

    // Filter out the teacher themselves (by ID or email) from the student list
    const teacherEmail = currentUser.email?.toLowerCase()
    students.value = allUsers
      .filter(u => studentIds.has(u.id) && u.id !== currentUser.id && u.email?.toLowerCase() !== teacherEmail)
      .sort((a, b) =>
        `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`)
      )

    isTeacher.value = true
    initialized.value = true

    // Sync role if server confirms teacher status but local role is still 'student'
    // Don't downgrade admin to teacher
    if (currentUser.role === 'student') {
      userStore.updateUser(currentUser.id, { role: 'teacher' })
      // Also sync to server so backend checks (e.g. create classroom) work
      try {
        await apiFetch(`${API_URL}/users/me`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: currentUser.id, action: 'become_teacher' })
        })
      } catch { /* best-effort sync */ }
    }
  } catch (err) {
    console.error('Failed to check teacher status:', err)
  }
}

/**
 * Fetch observations for a single student (cached).
 */
async function fetchStudentObservations(userId) {
  // Check cache
  const cached = studentObservations.value[userId]
  const cachedAt = fetchTimestamps[userId]
  if (cached && cachedAt && (Date.now() - cachedAt) < CACHE_DURATION_MS) {
    return cached
  }

  try {
    const res = await apiFetch(
      `${API_URL}/observations?user_id=${encodeURIComponent(userId)}&limit=10000`
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const data = await res.json()
    const rawObs = data.observations || []

    // Metadata-only for mastery computation
    const obs = rawObs.map(o => ({
      id: o.id || o.observation_id,
      timestamp: o.timestamp,
      skill_path: o.skill_path,
      correct: o.correct,
      collection_id: o.collection_id,
      deal_subfolder: o.deal_subfolder,
      deal_number: o.deal_number,
      board_result: o.board_result
    }))

    // Preserve raw observations (with encrypted_data/iv) for on-demand decryption
    studentRawObservations.value = { ...studentRawObservations.value, [userId]: rawObs }
    studentObservations.value = { ...studentObservations.value, [userId]: obs }
    fetchTimestamps[userId] = Date.now()
    return obs
  } catch (err) {
    console.error(`Failed to fetch observations for ${userId}:`, err)
    return []
  }
}

/**
 * Load observations for all students in parallel.
 */
async function loadAllStudentSummaries() {
  loading.value = true
  error.value = null

  try {
    const userIds = students.value.map(s => s.id).filter(Boolean)
    if (userIds.length === 0) {
      studentSummaries.value = {}
      return
    }

    // One bulk call to /api/student-summaries instead of N round-trips
    // per student. The endpoint reads from the `student_summary` table
    // (a denormalised cache maintained on observation insert) plus the
    // top-3 recent lessons from board_status — exactly what the
    // roster view needs. See CORRECTNESS_AND_MASTERY.md §14.
    const url = `${API_URL}/student-summaries?user_ids=${encodeURIComponent(userIds.join(','))}`
    const res = await apiFetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()

    const map = {}
    for (const entry of data.summaries || []) {
      if (entry.user_id) map[entry.user_id] = entry
    }
    studentSummaries.value = map
  } catch (err) {
    error.value = err.message
    console.error('Failed to load student summaries:', err)
  } finally {
    loading.value = false
  }
}

/**
 * Compute mastery summary for a student.
 *
 * Reads from the `studentSummaries` map, populated in one bulk call
 * by `loadAllStudentSummaries`. Yellow is intentionally 0 — that
 * shade is a per-board cooldown decay; at the roster level we lump
 * yellow into orange.
 *
 * Returns { green, blue, orange, yellow, red, grey, total, lastObservationTime }
 */
function getStudentMasterySummary(userId) {
  const summary = studentSummaries.value[userId]
  const empty = { green: 0, blue: 0, orange: 0, yellow: 0, red: 0, grey: 0, total: 0, lastObservationTime: null }
  if (!summary) return empty

  const green = summary.boards_clean_correct || 0
  const orange = (summary.boards_corrected || 0) + (summary.boards_close_correct || 0)
  const red = summary.boards_failed || 0
  const grey = summary.boards_not_attempted || 0

  return {
    green,
    blue: 0,
    orange,
    yellow: 0,
    red,
    grey,
    total: green + orange + red + grey,
    lastObservationTime: summary.last_observation_at || null
  }
}

/**
 * Get the N most recently practiced lesson names for a student.
 *
 * Reads `recent_lessons` from the bulk summary endpoint (already
 * derived server-side from `board_status.last_observation_at`).
 */
function getStudentRecentLessons(userId, limit = 3) {
  const summary = studentSummaries.value[userId]
  if (!summary || !Array.isArray(summary.recent_lessons)) return []
  const accomplishments = useAccomplishments()
  return summary.recent_lessons
    .slice(0, limit)
    .map(l => {
      // Tolerate the legacy string shape during a deploy transition.
      const subfolder = typeof l === 'string' ? l : l.subfolder
      const status = typeof l === 'string' ? 'released' : (l.status || 'released')
      return { name: accomplishments.formatLessonName(subfolder), status }
    })
}

/**
 * Format relative time from a timestamp.
 */
function formatTimeSince(timestamp) {
  if (!timestamp) return 'Never'
  const now = new Date()
  const then = new Date(timestamp)
  const diffMs = now - then
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return then.toLocaleDateString()
}

/**
 * Get the teacher's RSA private key.
 * Checks sessionStorage first (fast path), then falls back to localStorage user object.
 * @returns {string|null} Base64-encoded private key
 */
function getTeacherPrivateKey() {
  // 1. Check sessionStorage (fast path)
  try {
    const session = JSON.parse(sessionStorage.getItem('bridgeTeacherSession') || 'null')
    if (session?.privateKeyBase64) {
      if (!session.expiry || new Date(session.expiry) >= new Date()) {
        return session.privateKeyBase64
      }
    }
  } catch { /* fall through */ }

  // 2. Fall back to localStorage user object
  const userStore = useUserStore()
  const user = userStore.currentUser.value
  if (user?.viewerPrivateKey) {
    // Re-establish sessionStorage for this session
    sessionStorage.setItem('bridgeTeacherSession', JSON.stringify({
      privateKeyBase64: user.viewerPrivateKey,
      expiry: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()
    }))
    return user.viewerPrivateKey
  }

  return null
}

/**
 * Get (or derive) the student's AES secret key via sharing grants.
 * @param {string} studentUserId
 * @returns {Promise<string|null>} Base64-encoded AES key or null
 */
async function getStudentKey(studentUserId) {
  // Check cache
  if (studentKeyCache[studentUserId]) return studentKeyCache[studentUserId]

  const privateKey = getTeacherPrivateKey()
  if (!privateKey) return null

  // Fetch grants if not cached
  if (!grantsCache && viewerId.value) {
    try {
      const res = await apiFetch(
        `${API_URL}/grants?grantee_id=${viewerId.value}`
      )
      if (res.ok) {
        const data = await res.json()
        grantsCache = data.grants || []
      }
    } catch {
      return null
    }
  }

  // Find grant for this student
  const grant = (grantsCache || []).find(g => g.grantor_id === studentUserId)
  if (!grant) return null

  try {
    const aesKey = await decryptSharingGrant(grant.encrypted_payload, privateKey)
    studentKeyCache[studentUserId] = aesKey
    return aesKey
  } catch (err) {
    console.error(`Failed to decrypt grant for student ${studentUserId}:`, err)
    return null
  }
}

/**
 * Decrypt a single student observation on demand.
 * @param {string} studentUserId
 * @param {Object} rawObs - Raw observation with encrypted_data and iv
 * @returns {Promise<Object|null>} Full decrypted observation or null
 */
async function decryptStudentObservation(studentUserId, rawObs) {
  if (!rawObs.encrypted_data || !rawObs.iv) return null

  const aesKey = await getStudentKey(studentUserId)
  if (!aesKey) return null

  try {
    const decrypted = await decryptObservation(rawObs.encrypted_data, rawObs.iv, aesKey)
    return {
      ...decrypted,
      id: rawObs.id,
      timestamp: rawObs.timestamp,
      skill_path: rawObs.skill_path,
      correct: rawObs.correct,
      collection_id: rawObs.collection_id,
      deal_subfolder: rawObs.deal_subfolder,
      deal_number: rawObs.deal_number,
      board_result: rawObs.board_result,
      // Frozen wilderness of this play ('Wild'/'Tame') — drives the wild-board
      // tag in the drill-in. Clear column, present on the raw row.
      wilderness: rawObs.wilderness
    }
  } catch (err) {
    console.error('Failed to decrypt observation:', rawObs.id, err)
    return null
  }
}

/**
 * Find and decrypt an observation by matching metadata.
 * @param {string} studentUserId
 * @param {number} timestamp - Raw timestamp in ms
 * @param {number} dealNumber
 * @param {boolean} correct
 * @param {string|null} [collectionId] - Active lesson's collection. When both it
 *   and the row's collection_id are known and differ, the row belongs to another
 *   collection sharing this subfolder and is skipped. Permissive when either is
 *   null (legacy untagged rows).
 * @returns {Promise<Object|null>}
 */
async function findAndDecryptObservation(studentUserId, timestamp, dealNumber, correct, collectionId = null) {
  const rawObs = studentRawObservations.value[studentUserId] || []

  // Find matching observation by timestamp, deal_number, and collection scope
  const match = rawObs.find(o => {
    const obsTs = new Date(o.timestamp).getTime()
    if (Math.abs(obsTs - timestamp) >= 1000 || o.deal_number !== dealNumber || o.correct !== correct) return false
    if (collectionId && o.collection_id && o.collection_id !== collectionId) return false
    return true
  })

  if (!match) return null
  return decryptStudentObservation(studentUserId, match)
}

/**
 * Find and decrypt the most recent *erroring* observation for a board,
 * strictly before `beforeMs`.
 *
 * Used to drill into a `close_correct` (double-tilde ≈) grid cell: its latest
 * observation is a clean replay, so the mistake that made the board "close"
 * lives in an earlier, separate observation. `close_correct` is only assigned
 * when that error is within the recent cooldown window, so the most-recent
 * error before the clean replay is the one the teacher wants to see.
 *
 * @param {string} studentUserId
 * @param {string} dealSubfolder
 * @param {number} dealNumber
 * @param {number} beforeMs - Only consider observations strictly older than this
 * @param {string|null} [collectionId] - Active lesson's collection; skips rows
 *   from a different collection sharing this subfolder (permissive when null).
 * @returns {Promise<Object|null>}
 */
async function findAndDecryptErroringObservation(studentUserId, dealSubfolder, dealNumber, beforeMs, collectionId = null) {
  const rawObs = studentRawObservations.value[studentUserId] || []
  let best = null
  let bestTs = -Infinity
  for (const o of rawObs) {
    if (o.deal_number !== dealNumber) continue
    if (dealSubfolder && o.deal_subfolder !== dealSubfolder) continue
    if (collectionId && o.collection_id && o.collection_id !== collectionId) continue
    if (o.correct) continue // only erroring plays
    const ts = new Date(o.timestamp).getTime()
    if (ts >= beforeMs) continue
    if (ts > bestTs) { bestTs = ts; best = o }
  }
  if (!best) return null
  return decryptStudentObservation(studentUserId, best)
}

/**
 * Clear all state (called on user switch).
 */
function reset() {
  isTeacher.value = false
  viewerId.value = null
  students.value = []
  studentObservations.value = {}
  studentRawObservations.value = {}
  studentSummaries.value = {}
  loading.value = false
  error.value = null
  initialized.value = false
  grantsCache = null
  for (const key of Object.keys(studentKeyCache)) {
    delete studentKeyCache[key]
  }
  for (const key of Object.keys(fetchTimestamps)) {
    delete fetchTimestamps[key]
  }
}

export function useTeacherRole() {
  return {
    isTeacher,
    viewerId,
    students,
    studentObservations,
    studentSummaries,
    loading,
    error,
    initialized,

    checkTeacherStatus,
    fetchStudentObservations,
    loadAllStudentSummaries,
    getStudentMasterySummary,
    getStudentRecentLessons,
    formatTimeSince,
    findAndDecryptObservation,
    findAndDecryptErroringObservation,
    decryptStudentObservation,
    getStudentKey,
    getTeacherPrivateKey,
    studentRawObservations,
    reset
  }
}

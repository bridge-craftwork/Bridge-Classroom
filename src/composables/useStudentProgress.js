import { ref, computed } from 'vue'
import { useUserStore } from './useUserStore.js'
import { useObservationStore } from './useObservationStore.js'
import { decryptObservation } from '../utils/crypto.js'
import { API_URL } from '@/utils/apiUrl.js'
import { apiFetch } from '@/utils/apiFetch.js'

// Singleton state
const observations = ref([])
const decryptedObservations = ref([])
const loading = ref(false)
const error = ref(null)
const lastFetchedAt = ref(null)
const initialized = ref(false)

// Cache duration (5 minutes)
const CACHE_DURATION_MS = 5 * 60 * 1000

/**
 * Fetch observations from server for current user
 * @returns {Promise<Array>} Raw encrypted observations
 */
async function fetchObservationsFromServer(userId) {
  const response = await apiFetch(`${API_URL}/observations?user_id=${userId}&limit=10000`)

  if (!response.ok) {
    throw new Error(`Server error: ${response.status}`)
  }

  const data = await response.json()
  return data.observations || []
}

/**
 * Decrypt a single observation
 * @param {Object} encrypted - Encrypted observation from server
 * @param {string} secretKey - Student's AES secret key (base64)
 * @returns {Promise<Object|null>} Decrypted observation or null on failure
 */
async function decryptSingleObservation(encrypted, secretKey) {
  try {
    const decrypted = await decryptObservation(encrypted.encrypted_data, encrypted.iv, secretKey)
    return {
      ...decrypted,
      // Include metadata from server
      id: encrypted.id,
      timestamp: encrypted.timestamp,
      skill_path: encrypted.skill_path,
      correct: encrypted.correct,
      classroom: encrypted.classroom,
      collection_id: encrypted.collection_id,
      deal_subfolder: encrypted.deal_subfolder,
      deal_number: encrypted.deal_number,
      board_result: encrypted.board_result
    }
  } catch (err) {
    console.error('Failed to decrypt observation:', encrypted.id, err)
    return null
  }
}

/**
 * Get local pending observations as progress-compatible format
 * Uses metadata stored with encrypted observations
 * @returns {Array} Observations with metadata for display
 */
function getLocalObservations() {
  const observationStore = useObservationStore()
  const pending = observationStore.getPendingObservations()

  return pending.map(obs => {
    const meta = obs.metadata || {}
    return {
      id: meta.observation_id || 'local-' + Math.random().toString(36).slice(2),
      timestamp: meta.timestamp || obs.queuedAt,
      skill_path: meta.skill_path,
      correct: meta.correct,
      classroom: meta.classroom,
      collection_id: meta.collection_id,
      deal_subfolder: meta.deal_subfolder,
      deal_number: meta.deal_number,
      board_result: meta.board_result,
      session_id: meta.session_id,
      // Mark as local so we can identify them
      _local: true,
      _pending: true
    }
  })
}

/**
 * Fetch and decrypt all observations for current user
 * Merges server data with local pending observations
 * @param {boolean} forceRefresh - Bypass cache
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function fetchProgress(forceRefresh = false) {
  const userStore = useUserStore()
  const user = userStore.currentUser.value

  if (!user) {
    return { success: false, error: 'No authenticated user' }
  }

  // Always include local observations (they're always fresh)
  const localObs = getLocalObservations()

  // Check cache for server data
  if (!forceRefresh && lastFetchedAt.value) {
    const age = Date.now() - new Date(lastFetchedAt.value).getTime()
    if (age < CACHE_DURATION_MS && decryptedObservations.value.length > 0) {
      // Merge local with cached server data
      mergeLocalObservations(localObs)
      return { success: true, cached: true }
    }
  }

  loading.value = true
  error.value = null

  let serverDecrypted = []

  try {
    // Fetch from server
    const encrypted = await fetchObservationsFromServer(user.id)
    observations.value = encrypted

    // If we have secret key, decrypt server observations
    if (user.secretKey && encrypted.length > 0) {
      const decryptPromises = encrypted.map(obs => decryptSingleObservation(obs, user.secretKey))
      const decrypted = await Promise.all(decryptPromises)
      serverDecrypted = decrypted.filter(obs => obs !== null)
    }
  } catch (err) {
    console.error('Failed to fetch from server (will use local data):', err)
    // Don't set error if we have local data
    if (localObs.length === 0) {
      error.value = err.message
    }
  }

  // Merge server and local observations, avoiding duplicates
  const serverIds = new Set(serverDecrypted.map(obs => obs.id))
  const uniqueLocal = localObs.filter(obs => !serverIds.has(obs.id))

  decryptedObservations.value = [...serverDecrypted, ...uniqueLocal]
  lastFetchedAt.value = new Date().toISOString()

  loading.value = false
  return { success: true, count: decryptedObservations.value.length }
}

/**
 * Merge local observations with existing decrypted observations
 * @param {Array} localObs - Local pending observations
 */
function mergeLocalObservations(localObs) {
  const existingIds = new Set(decryptedObservations.value.map(obs => obs.id))
  const newLocal = localObs.filter(obs => !existingIds.has(obs.id))
  if (newLocal.length > 0) {
    decryptedObservations.value = [...decryptedObservations.value, ...newLocal]
  }
}

/**
 * Initialize the store
 */
async function initialize() {
  if (initialized.value) return

  const userStore = useUserStore()
  if (userStore.isAuthenticated.value) {
    await fetchProgress()
  }
  initialized.value = true
}

/**
 * Clear cached data
 */
function clearCache() {
  observations.value = []
  decryptedObservations.value = []
  lastFetchedAt.value = null
  initialized.value = false
}

export function useStudentProgress() {
  const hasData = computed(() => decryptedObservations.value.length > 0)

  const isLoading = computed(() => loading.value)

  const hasError = computed(() => error.value !== null)

  return {
    // State
    observations,
    decryptedObservations,
    loading,
    error,
    lastFetchedAt,
    initialized,

    // Computed
    hasData,
    isLoading,
    hasError,

    // Methods
    initialize,
    fetchProgress,
    clearCache
  }
}

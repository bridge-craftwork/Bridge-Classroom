import { ref, computed } from 'vue'
import { useUserStore } from './useUserStore.js'
import { useObservationStore } from './useObservationStore.js'
import { useAccomplishments } from './useAccomplishments.js'
import { useBoardStatus } from './useBoardStatus.js'
import { useAssignmentStatus } from './useAssignmentStatus.js'
import { logDiagnostic } from '../utils/diagnostics.js'
import { API_URL } from '@/utils/apiUrl.js'

const API_KEY = import.meta.env.VITE_API_KEY || ''

// Singleton state
const syncState = ref('idle') // 'idle', 'syncing', 'error', 'offline'
const lastSyncAt = ref(null)
const lastError = ref(null)
const retryCount = ref(0)
const isOnline = ref(navigator.onLine)
const registrationFailed = ref(false) // True when user registration has failed

// Sync configuration
const MAX_RETRIES = 5
const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 60000
const DEBOUNCE_MS = 5000

// Debounce timer
let syncDebounceTimer = null

// Guards (§C1, §C6): install the global sync triggers exactly once for the app's
// lifetime — they were previously re-added on every login/Switch User, stacking
// listeners and 5-minute intervals without bound. And serialize performSync so
// overlapping triggers (online event + debounce + interval) don't double-run.
let triggersInstalled = false
let syncInProgress = false

/**
 * Calculate exponential backoff delay
 * @param {number} attempt - Current retry attempt (0-indexed)
 * @returns {number} Delay in milliseconds
 */
function getBackoffDelay(attempt) {
  const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS)
  // Add jitter (0-25% of delay)
  return delay + Math.random() * delay * 0.25
}

/**
 * Register a user with the server
 * @param {Object} user - User object
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function registerUserWithServer(user) {
  try {
    const payload = {
      user_id: user.id,
      first_name: user.firstName || '',
      last_name: user.lastName || '',
      email: user.email || '',
      classroom: user.classrooms?.[0] || null,
      data_consent: user.dataConsent ?? true
    }

    // Include admin grant if available
    if (user.adminGrantPayload) {
      payload.admin_grant = user.adminGrantPayload
    }

    // Include secret key for email-based recovery
    // Server will encrypt with RECOVERY_SECRET before storing
    if (user.secretKey) {
      payload.secret_key = user.secretKey
    }

    const response = await fetch(`${API_URL}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const errorText = await response.text()
      logDiagnostic('server_registration_http_error', `registerUserWithServer — HTTP ${response.status} for user ${user.id} (${user.email})`, errorText)
      return { success: false, error: `Server error: ${response.status} - ${errorText}` }
    }

    const result = await response.json()

    // Check if email already exists (user should use recovery flow)
    if (result.existing_user) {
      return {
        success: false,
        error: 'email_exists',
        existingUserId: result.user_id
      }
    }

    return { success: result.success, userId: result.user_id }
  } catch (err) {
    logDiagnostic('server_registration_failed', `registerUserWithServer — fetch threw for user ${user.id} (${user.email})`, err)
    return { success: false, error: err.message }
  }
}

/**
 * Sync observations to server
 * @param {Array} observations - Array of observations to sync
 * @returns {Promise<{success: boolean, synced?: number, errors?: string[]}>}
 */
async function syncObservationsToServer(observations) {
  if (observations.length === 0) {
    return { success: true, synced: 0, errors: [] }
  }

  // Filter to only encrypted observations ready to send
  const readyToSync = observations.filter(obs => obs.encrypted)

  if (readyToSync.length === 0) {
    return { success: true, synced: 0, errors: [] }
  }

  try {
    const payload = {
      observations: readyToSync.map(obs => ({
        encrypted_data: obs.encrypted_data,
        iv: obs.iv,
        metadata: obs.metadata
      }))
    }

    const response = await fetch(`${API_URL}/observations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const errorText = await response.text()
      return { success: false, errors: [`Server error: ${response.status} - ${errorText}`] }
    }

    const result = await response.json()
    return {
      success: true,
      synced: result.stored,
      errors: result.errors || []
    }
  } catch (err) {
    console.error('Failed to sync observations:', err)
    return { success: false, errors: [err.message] }
  }
}

/**
 * Main sync function - syncs all pending data
 * @returns {Promise<{success: boolean, userRegistered?: boolean, observationsSynced?: number}>}
 */
async function performSync() {
  const userStore = useUserStore()
  const observationStore = useObservationStore()

  // Check if online
  if (!navigator.onLine) {
    syncState.value = 'offline'
    return { success: false, offline: true }
  }

  // §C6: don't run two syncs concurrently. Overlapping triggers would otherwise
  // double-POST the same batch and race on the pending-queue removal.
  if (syncInProgress) {
    return { success: true, skipped: true }
  }
  syncInProgress = true

  syncState.value = 'syncing'
  lastError.value = null

  const result = {
    success: true,
    userRegistered: false,
    observationsSynced: 0
  }

  try {
    // §C5: always sync/register the REAL signed-in user, never an admin
    // "View as user" shadow (which has no secretKey/serverRegistered and would
    // otherwise register the viewed student's id with an empty key and stall the
    // admin's own queue).
    const user = userStore.realUser.value

    // 1. Register user if not already registered
    if (user && !user.serverRegistered) {
      const regResult = await registerUserWithServer(user)
      if (regResult.success) {
        userStore.updateUser(user.id, { serverRegistered: true })
        registrationFailed.value = false
        result.userRegistered = true
        console.log('User registered with server')
      } else if (regResult.error === 'email_exists') {
        // Email already registered with different user_id - need recovery
        logDiagnostic('server_registration_email_exists', `performSync — email already registered for user ${user.id} (${user.email})`)
        // Don't try to sync observations - user doesn't exist in server DB
        syncState.value = 'error'
        lastError.value = 'Account already exists. Please use recovery.'
        registrationFailed.value = true
        return result
      } else {
        logDiagnostic('server_registration_rejected', `performSync — registration failed for user ${user.id} (${user.email})`, regResult.error)
        registrationFailed.value = true
        lastError.value = `Registration failed: ${regResult.error}`
        // Continue to try syncing - but note the error state
      }
    }

    // 2. Encrypt any unencrypted observations
    const encryptedCount = await observationStore.encryptPendingObservations()
    if (encryptedCount > 0) {
      console.log(`Encrypted ${encryptedCount} observations`)
    }

    // 3. Sync pending observations
    let hadSyncErrors = false
    if (user?.dataConsent) {
      const pending = observationStore.getPendingObservations()
      if (pending.length > 0) {
        const syncResult = await syncObservationsToServer(pending)
        // §C6: only prune the pending queue on a CLEAN full success. The server
        // returns a `stored` count (not the set of stored ids), so on a partial
        // failure a positional `slice(0, stored)` could delete the observations
        // that actually FAILED and keep ones that succeeded. When any error is
        // reported, keep everything queued — succeeded rows re-upsert harmlessly
        // (server is ON CONFLICT(id)) and failed rows get retried.
        const cleanSuccess = syncResult.success && (syncResult.errors?.length ?? 0) === 0
        if (cleanSuccess && syncResult.synced > 0) {
          // Remove synced observations
          const syncedIds = pending
            .filter(obs => obs.encrypted)
            .slice(0, syncResult.synced)
            .map(obs => obs.metadata?.observation_id)

          result.observationsSynced = syncResult.synced
          console.log(`Synced ${syncResult.synced} observations`)

          // Refresh accomplishments BEFORE removing pending so mastery strip
          // always has at least one data source (no grey flash)
          try {
            const accomplishments = useAccomplishments()
            await accomplishments.loadAccomplishments(true)
          } catch (e) {
            // Non-critical - mastery will update on next refresh
          }

          // Invalidate board status cache so next render fetches fresh data
          try {
            const boardStatus = useBoardStatus()
            boardStatus.invalidateCache(user?.id)
          } catch (e) {
            // Non-critical
          }

          // Same for the assignment-status rollup — the server recomputes it
          // synchronously on submit, so a fresh fetch reflects the new work.
          try {
            const assignmentStatus = useAssignmentStatus()
            assignmentStatus.invalidateCache(user?.id)
          } catch (e) {
            // Non-critical
          }

          observationStore.removeSyncedObservations(syncedIds)
        }

        if (!syncResult.success) {
          hadSyncErrors = true
          lastError.value = syncResult.errors?.[0] || 'Observation sync failed'
          console.warn('Observation sync failed:', syncResult.errors)
        } else if (syncResult.errors?.length > 0) {
          console.warn('Sync errors:', syncResult.errors)
        }
      }
    }

    // Set final state based on what happened
    if (registrationFailed.value || hadSyncErrors) {
      syncState.value = 'error'
    } else {
      syncState.value = 'idle'
      lastSyncAt.value = new Date().toISOString()
      retryCount.value = 0
    }
    return result
  } catch (err) {
    console.error('Sync failed:', err)
    lastError.value = err.message
    syncState.value = 'error'
    result.success = false
    return result
  } finally {
    syncInProgress = false
  }
}

/**
 * Trigger sync with debouncing
 */
function triggerSync() {
  if (syncDebounceTimer) {
    clearTimeout(syncDebounceTimer)
  }

  syncDebounceTimer = setTimeout(async () => {
    await performSync()
  }, DEBOUNCE_MS)
}

/**
 * Force immediate sync (skip debounce)
 */
async function forceSync() {
  if (syncDebounceTimer) {
    clearTimeout(syncDebounceTimer)
    syncDebounceTimer = null
  }
  return await performSync()
}

/**
 * Retry sync with exponential backoff
 */
async function retrySync() {
  if (retryCount.value >= MAX_RETRIES) {
    console.log('Max retries reached, giving up')
    syncState.value = 'error'
    return
  }

  const delay = getBackoffDelay(retryCount.value)
  retryCount.value++
  console.log(`Retrying sync in ${Math.round(delay / 1000)}s (attempt ${retryCount.value}/${MAX_RETRIES})`)

  setTimeout(async () => {
    const result = await performSync()
    if (!result.success && result.offline !== true) {
      // Retry again if failed (but not if offline)
      retrySync()
    }
  }, delay)
}

/**
 * Use sendBeacon for final sync on page unload
 */
function syncBeforeUnload() {
  const userStore = useUserStore()
  const observationStore = useObservationStore()

  // §C5: flush the real user's queue, not an admin view-as shadow.
  const user = userStore.realUser?.value
  if (!user?.dataConsent) return

  const pending = observationStore.getPendingObservations()
  const readyToSync = pending.filter(obs => obs.encrypted)

  if (readyToSync.length === 0) return

  const payload = {
    observations: readyToSync.map(obs => ({
      encrypted_data: obs.encrypted_data,
      iv: obs.iv,
      metadata: obs.metadata
    }))
  }

  // sendBeacon is fire-and-forget, works during page unload
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
  navigator.sendBeacon(`${API_URL}/observations?api_key=${API_KEY}`, blob)
  console.log('Sent beacon with', readyToSync.length, 'observations')
}

/**
 * Setup event listeners for sync triggers
 */
function setupSyncTriggers() {
  // §C1: install exactly once. initialize() runs on mount AND on every
  // handleUserReady (login / Switch User); without this guard each switch added
  // another full set of listeners + a new 5-minute interval, unbounded.
  if (triggersInstalled) return
  triggersInstalled = true

  // Online/offline detection
  window.addEventListener('online', () => {
    isOnline.value = true
    console.log('Back online, triggering sync')
    forceSync()
  })

  window.addEventListener('offline', () => {
    isOnline.value = false
    syncState.value = 'offline'
    console.log('Gone offline')
  })

  // Visibility change (tab focus)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isOnline.value) {
      console.log('Tab visible, triggering sync')
      triggerSync()
    }
  })

  // Before unload - use sendBeacon
  window.addEventListener('beforeunload', syncBeforeUnload)

  // Periodic sync (every 5 minutes when active)
  setInterval(() => {
    if (document.visibilityState === 'visible' && isOnline.value) {
      triggerSync()
      // Re-sync identity too: picks up role/name changes and, if this account
      // was merged away, runs the handoff so an already-open tab switches to
      // the keeper (and reloads) within one cycle instead of needing a manual
      // refresh.
      useUserStore().syncRole()
    }
  }, 5 * 60 * 1000)
}

/**
 * Initialize the data sync system
 */
async function initialize() {
  setupSyncTriggers()

  // Initial sync
  if (navigator.onLine) {
    await performSync()
  } else {
    syncState.value = 'offline'
  }
}

export function useDataSync() {
  // Computed properties
  const isSyncing = computed(() => syncState.value === 'syncing')
  const isOffline = computed(() => syncState.value === 'offline' || !isOnline.value)
  const hasError = computed(() => syncState.value === 'error')
  const needsSync = computed(() => {
    const observationStore = useObservationStore()
    return observationStore.pendingCount.value > 0
  })

  return {
    // State
    syncState,
    lastSyncAt,
    lastError,
    retryCount,
    isOnline,
    registrationFailed,

    // Computed
    isSyncing,
    isOffline,
    hasError,
    needsSync,

    // Methods
    initialize,
    performSync,
    triggerSync,
    forceSync,
    retrySync,
    registerUserWithServer,
    syncObservationsToServer
  }
}

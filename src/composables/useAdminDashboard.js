import { ref } from 'vue'
import { API_URL } from '@/utils/apiUrl.js'
import { apiFetch } from '@/utils/apiFetch.js'

// Singleton state
const stats = ref(null)
const popularLessons = ref([])
const database = ref(null)
const health = ref(null)
const loading = ref(false)
const error = ref(null)
const lastFetchedAt = ref(null)

const CACHE_DURATION_MS = 60 * 1000 // 1 minute for admin

/**
 * Fetch admin stats from server
 */
async function loadStats(forceRefresh = false) {
  // Check cache
  if (!forceRefresh && lastFetchedAt.value) {
    const age = Date.now() - new Date(lastFetchedAt.value).getTime()
    if (age < CACHE_DURATION_MS) {
      return { success: true, cached: true }
    }
  }

  loading.value = true
  error.value = null

  try {
    const response = await apiFetch(`${API_URL}/admin/stats`)

    if (!response.ok) {
      throw new Error(`Failed to fetch admin stats: ${response.status}`)
    }

    const data = await response.json()
    stats.value = data.stats
    popularLessons.value = data.popular_lessons || []
    database.value = data.database
    lastFetchedAt.value = new Date().toISOString()

    return { success: true }
  } catch (err) {
    console.error('Failed to load admin stats:', err)
    error.value = err.message
    return { success: false, error: err.message }
  } finally {
    loading.value = false
  }
}

/**
 * Fetch system health info
 */
async function loadHealth() {
  try {
    const response = await apiFetch(`${API_URL}/admin/health`)

    if (!response.ok) {
      throw new Error(`Failed to fetch health: ${response.status}`)
    }

    const data = await response.json()
    health.value = data.health

    return { success: true }
  } catch (err) {
    console.error('Failed to load health:', err)
    return { success: false, error: err.message }
  }
}

/**
 * Refresh all admin data
 */
async function refreshAll() {
  await Promise.all([loadStats(true), loadHealth()])
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

/**
 * Format uptime seconds to human-readable duration
 */
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)

  const parts = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  parts.push(`${mins}m`)
  return parts.join(' ')
}

export function useAdminDashboard() {
  return {
    // State
    stats,
    popularLessons,
    database,
    health,
    loading,
    error,

    // Methods
    loadStats,
    loadHealth,
    refreshAll,
    formatBytes,
    formatUptime,
  }
}

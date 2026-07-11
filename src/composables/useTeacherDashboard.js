import { ref, computed } from 'vue'
import { API_URL } from '@/utils/apiUrl.js'
import { apiFetch } from '@/utils/apiFetch.js'

// Singleton state for teacher lobby dashboard
const lobbyClassrooms = ref([])
const needsAttention = ref([])
const recentActivity = ref([])
const lobbyLoading = ref(false)
const lobbyLastFetchedAt = ref(null)
const LOBBY_CACHE_MS = 2 * 60 * 1000

/**
 * Load aggregated teacher lobby data from /api/teacher/dashboard
 * @param {string} teacherId
 * @param {boolean} forceRefresh
 */
async function loadTeacherLobbyData(teacherId, forceRefresh = false) {
  if (!forceRefresh && lobbyLastFetchedAt.value) {
    const age = Date.now() - new Date(lobbyLastFetchedAt.value).getTime()
    if (age < LOBBY_CACHE_MS) {
      return { success: true, cached: true }
    }
  }

  lobbyLoading.value = true

  try {
    const response = await apiFetch(
      `${API_URL}/teacher/dashboard?teacher_id=${encodeURIComponent(teacherId)}`
    )

    if (!response.ok) {
      throw new Error(`Failed to fetch teacher dashboard: ${response.status}`)
    }

    const data = await response.json()
    lobbyClassrooms.value = data.classrooms || []
    needsAttention.value = data.needs_attention || []
    recentActivity.value = data.recent_activity || []
    lobbyLastFetchedAt.value = new Date().toISOString()

    return { success: true }
  } catch (err) {
    console.error('Failed to load teacher lobby data:', err)
    return { success: false, error: err.message }
  } finally {
    lobbyLoading.value = false
  }
}

/**
 * Clear a dashboard panel (attention or activity)
 * @param {string} teacherId
 * @param {'attention'|'activity'} panel
 */
async function clearPanel(teacherId, panel) {
  try {
    const response = await apiFetch(`${API_URL}/teacher/dashboard/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teacher_id: teacherId, panel })
    })

    if (!response.ok) throw new Error(`Failed to clear: ${response.status}`)

    if (panel === 'attention') {
      needsAttention.value = []
    } else if (panel === 'activity') {
      recentActivity.value = []
    }

    return { success: true }
  } catch (err) {
    console.error('Failed to clear panel:', err)
    return { success: false, error: err.message }
  }
}

export function useTeacherDashboard() {
  const summaryStats = computed(() => ({
    classroomCount: lobbyClassrooms.value.length,
    openAssignmentCount: lobbyClassrooms.value.reduce((s, c) => s + (c.open_assignment_count || 0), 0),
    studentCount: lobbyClassrooms.value.reduce((s, c) => s + (c.member_count || 0), 0)
  }))

  return {
    lobbyClassrooms,
    needsAttention,
    recentActivity,
    lobbyLoading,
    summaryStats,
    loadTeacherLobbyData,
    clearPanel
  }
}

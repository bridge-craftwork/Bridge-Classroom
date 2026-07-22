import { ref, computed } from 'vue'
import { useStudentProgress } from './useStudentProgress.js'
import { useUserStore } from './useUserStore.js'
import { useTeacherRole } from './useTeacherRole.js'
import { getSkillFromPath, getCategoryFromPath, getCategoryInfo } from '../utils/skillPath.js'
import { API_URL } from '@/utils/apiUrl.js'
import { apiFetch } from '@/utils/apiFetch.js'

// Singleton state
const loading = ref(false)
const error = ref(null)
const selectedUserId = ref(null)
const observations = ref([])
const accessibleUsers = ref([]) // Users we can view (self + granted access)
const activeTab = ref('lessons') // 'lessons' | 'taxons'
const onlyWithObservations = ref(true)

// Test mode support
const useTestData = ref(false)
const testObservations = ref([])

/**
 * Enable test mode with provided test data
 * @param {Array} data - Test observations
 */
function enableTestMode(data) {
  useTestData.value = true
  testObservations.value = data
}

/**
 * Disable test mode
 */
function disableTestMode() {
  useTestData.value = false
  testObservations.value = []
}

/**
 * Get observations for the selected user
 * Returns test data if in test mode, otherwise real data
 */
function getObservations() {
  if (useTestData.value) {
    return testObservations.value
  }
  return observations.value
}

/**
 * Fetch users the current user has access to view
 */
async function fetchAccessibleUsers() {
  const userStore = useUserStore()
  const teacherRole = useTeacherRole()
  const currentUser = userStore.currentUser.value

  if (!currentUser) {
    accessibleUsers.value = []
    return
  }

  // Always include self
  const users = [{
    id: currentUser.id,
    name: `${currentUser.firstName} ${currentUser.lastName}`,
    email: currentUser.email,
    isSelf: true
  }]

  // If user has teacher/admin access, fetch other users they can view
  if (teacherRole.isTeacher.value && teacherRole.viewerId.value) {
    try {
      const response = await apiFetch(`${API_URL}/grants?grantee_id=${teacherRole.viewerId.value}`)

      if (response.ok) {
        const { grants } = await response.json()

        const usersResponse = await apiFetch(`${API_URL}/users`)

        if (usersResponse.ok) {
          const { users: allUsers } = await usersResponse.json()
          const grantorIds = new Set(grants.map(g => g.grantor_id))

          for (const user of allUsers) {
            if (grantorIds.has(user.id) && user.id !== currentUser.id) {
              users.push({
                id: user.id,
                name: `${user.first_name} ${user.last_name}`,
                email: user.email,
                isSelf: false
              })
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch accessible users:', err)
    }
  }

  accessibleUsers.value = users
}

/**
 * Load accomplishments data for the selected user
 * @param {boolean} forceRefresh - Bypass cache
 */
async function loadAccomplishments(forceRefresh = false) {
  if (useTestData.value) {
    return { success: true }
  }

  const userStore = useUserStore()
  const studentProgress = useStudentProgress()
  const currentUser = userStore.currentUser.value

  if (!currentUser) {
    error.value = 'No authenticated user'
    return { success: false, error: error.value }
  }

  loading.value = true
  error.value = null

  const viewingAs = userStore.isViewingAs.value
  const realUser = userStore.realUser.value

  try {
    // Decrypt-from-self path only when we're genuinely the logged-in user.
    // In view-as mode we hold no key for the viewed user, and an admin can
    // also inspect a selected student — both must read the server's
    // clear-text observation columns instead.
    if (!viewingAs && (!selectedUserId.value || selectedUserId.value === realUser?.id)) {
      selectedUserId.value = realUser.id
      await studentProgress.fetchProgress(forceRefresh)
      observations.value = studentProgress.decryptedObservations.value
    } else {
      // Fetch another user's clear-text observations (view-as target, or an
      // explicitly selected student). The clear-text columns (correct,
      // deal_subfolder, deal_number, assignment_id, timestamp) are enough to
      // compute mastery; the encrypted blob is not needed here.
      const targetId = viewingAs ? userStore.effectiveUserId.value : selectedUserId.value
      const response = await apiFetch(`${API_URL}/observations?user_id=${targetId}&limit=10000`)

      if (!response.ok) {
        throw new Error(`Failed to fetch observations: ${response.status}`)
      }

      const data = await response.json()
      observations.value = data.observations || []
    }

    return { success: true }
  } catch (err) {
    error.value = err.message
    return { success: false, error: err.message }
  } finally {
    loading.value = false
  }
}

/**
 * Change selected user and reload data
 * @param {string} userId - User ID to select
 */
async function selectUser(userId) {
  selectedUserId.value = userId
  await loadAccomplishments(true)
}

/**
 * Group observations by taxon (skill_path) and calculate stats.
 *
 * The only observation-derived aggregate left in this composable: the
 * Accomplishments "Taxons" tab needs per-skill correct/incorrect counts, and no
 * server rollup is keyed by skill_path yet (board-status / lesson-mastery are
 * keyed by collection+subfolder). The Lessons tab was migrated to the
 * board-status rollup (AccomplishmentsView.lessonMasteryList); this is pending a
 * taxon-level rollup on the backend.
 */
const taxonStats = computed(() => {
  const obs = getObservations()
  const groups = {}

  for (const ob of obs) {
    const skillPath = ob.skill_path || 'uncategorized/unknown'
    const category = getCategoryFromPath(skillPath)
    const skillInfo = getSkillFromPath(skillPath)

    if (!groups[skillPath]) {
      groups[skillPath] = {
        skillPath,
        category,
        categoryName: getCategoryInfo(category).name,
        skillName: skillInfo.name,
        total: 0,
        correct: 0,
        incorrect: 0,
        observations: []
      }
    }

    groups[skillPath].total++
    if (ob.correct) {
      groups[skillPath].correct++
    } else {
      groups[skillPath].incorrect++
    }
    groups[skillPath].observations.push(ob)
  }

  // Calculate percentages and sort
  const result = Object.values(groups).map(group => ({
    ...group,
    successRate: group.total > 0 ? Math.round((group.correct / group.total) * 100) : 0
  }))

  // Sort by category, then skill name
  result.sort((a, b) => {
    const catCompare = a.categoryName.localeCompare(b.categoryName)
    if (catCompare !== 0) return catCompare
    return a.skillName.localeCompare(b.skillName)
  })

  return result
})

/**
 * Filtered taxon stats (only with observations if filter enabled)
 */
const filteredTaxonStats = computed(() => {
  if (!onlyWithObservations.value) {
    return taxonStats.value
  }
  return taxonStats.value.filter(item => item.total > 0)
})

/**
 * Format lesson folder name for display
 * @param {string} folderName - Raw folder name
 * @returns {string} Formatted display name
 */
function formatLessonName(folderName) {
  if (!folderName) return 'Unknown'

  // Convert folder naming conventions to readable format
  // Examples: "2over1" -> "2 Over 1", "Stayman" -> "Stayman", "weak_twos" -> "Weak Twos"
  return folderName
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

/**
 * Check if current user can view other users
 */
const canViewOtherUsers = computed(() => {
  return accessibleUsers.value.length > 1
})

/**
 * Get selected user info
 */
const selectedUser = computed(() => {
  return accessibleUsers.value.find(u => u.id === selectedUserId.value) || null
})

/**
 * Check if we have data
 */
const hasData = computed(() => {
  return getObservations().length > 0
})

/**
 * Initialize the store
 */
async function initialize() {
  const userStore = useUserStore()
  const currentUser = userStore.currentUser.value

  if (currentUser) {
    selectedUserId.value = currentUser.id
    await fetchAccessibleUsers()
    await loadAccomplishments()
  }
}

/**
 * Clear data and reset state
 */
function reset() {
  observations.value = []
  accessibleUsers.value = []
  selectedUserId.value = null
  activeTab.value = 'lessons'
  onlyWithObservations.value = true
  error.value = null
  useTestData.value = false
  testObservations.value = []
}

export function useAccomplishments() {
  return {
    // State
    loading,
    error,
    selectedUserId,
    observations,
    accessibleUsers,
    activeTab,
    onlyWithObservations,

    // Test mode
    useTestData,
    testObservations,
    enableTestMode,
    disableTestMode,

    // Computed
    taxonStats,
    filteredTaxonStats,
    canViewOtherUsers,
    selectedUser,
    hasData,

    // Methods
    initialize,
    loadAccomplishments,
    selectUser,
    fetchAccessibleUsers,
    reset,
    formatLessonName
  }
}

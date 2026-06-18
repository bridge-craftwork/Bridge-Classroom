import { ref, computed } from 'vue'

const STORAGE_KEY = 'bridgePractice'
const UI_PREFS_KEY = 'bridgePracticeUIPrefs'

// Singleton state (shared across all component instances)
const appConfig = ref({
  teacherName: null,
  availableClassrooms: [],
  configuredAt: null
})

// UI preferences (local-only, not synced to server)
const uiPrefs = ref({
  showLoadPbnOption: false  // Hidden by default - confuses new users
})

const initialized = ref(false)

/**
 * Parse classroom ID into display name
 * e.g., 'tuesday-am' → 'Tuesday AM'
 */
function classroomIdToName(id) {
  return id
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Parse URL parameters for teacher, classrooms, and collection
 */
function parseUrlParams() {
  const params = new URLSearchParams(window.location.search)

  const teacher = params.get('teacher')
  const classroomsParam = params.get('classrooms')
  const collection = params.get('collection')

  const classrooms = classroomsParam
    ? classroomsParam.split(',').map(id => ({
        id: id.trim(),
        name: classroomIdToName(id.trim())
      }))
    : []

  return { teacher, classrooms, collection }
}

/**
 * Get current collection from URL (reactive check)
 */
function getCollectionFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return params.get('collection')
}

/**
 * Get current lesson from URL
 */
function getLessonFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return params.get('lesson')
}

/**
 * Set collection in URL without reload
 */
function setCollectionInUrl(collectionId) {
  const url = new URL(window.location.href)
  if (collectionId) {
    url.searchParams.set('collection', collectionId)
  } else {
    url.searchParams.delete('collection')
  }
  window.history.pushState({}, '', url.toString())
}

/**
 * Set lesson in URL without reload
 */
function setLessonInUrl(lessonId) {
  const url = new URL(window.location.href)
  if (lessonId) {
    url.searchParams.set('lesson', lessonId)
  } else {
    url.searchParams.delete('lesson')
    url.searchParams.delete('deal')
  }
  window.history.pushState({}, '', url.toString())
}

/**
 * Get current deal number from URL
 */
function getDealFromUrl() {
  const params = new URLSearchParams(window.location.search)
  const deal = params.get('deal')
  return deal ? parseInt(deal, 10) : null
}

/**
 * Set deal number in URL without reload
 */
function setDealInUrl(dealNumber) {
  const url = new URL(window.location.href)
  if (dealNumber && dealNumber > 1) {
    url.searchParams.set('deal', dealNumber)
  } else {
    url.searchParams.delete('deal')
  }
  window.history.replaceState({}, '', url.toString())
}

/**
 * Available lesson collections
 * Each collection specifies a tocUrl where the table of contents can be fetched
 */
const COLLECTIONS = [
  {
    id: 'baker-bridge',
    name: 'Baker Bridge',
    description: 'Classic bridge lessons covering bidding conventions and play',
    icon: '♠',
    tocUrl: 'https://raw.githubusercontent.com/Rick-Wilson/Baker-Bridge/main/Package/toc.json',
    baseUrl: 'https://raw.githubusercontent.com/Rick-Wilson/Baker-Bridge/main/Package'
  },
  {
    id: 'pbs-coaching',
    name: 'David Bailey Scenarios',
    description: 'Bidding and play-of-the-hand lessons',
    icon: '♦',
    tocUrl: 'https://raw.githubusercontent.com/ADavidBailey/Practice-Bidding-Scenarios/main/coaching-curated/toc.json',
    baseUrl: 'https://raw.githubusercontent.com/ADavidBailey/Practice-Bidding-Scenarios/main/coaching-curated'
  }
]

/**
 * Load config from localStorage
 */
function loadFromStorage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const data = JSON.parse(stored)
      if (data.appConfig) {
        appConfig.value = data.appConfig
      }
    }
  } catch (err) {
    console.error('Failed to load app config from storage:', err)
  }
}

/**
 * Load UI preferences from localStorage
 */
function loadUIPrefs() {
  try {
    const stored = localStorage.getItem(UI_PREFS_KEY)
    if (stored) {
      const data = JSON.parse(stored)
      uiPrefs.value = { ...uiPrefs.value, ...data }
    }
  } catch (err) {
    console.error('Failed to load UI prefs from storage:', err)
  }
}

/**
 * Save UI preferences to localStorage
 */
function saveUIPrefs() {
  try {
    localStorage.setItem(UI_PREFS_KEY, JSON.stringify(uiPrefs.value))
  } catch (err) {
    console.error('Failed to save UI prefs to storage:', err)
  }
}

/**
 * Set a UI preference
 */
function setUIPref(key, value) {
  uiPrefs.value[key] = value
  saveUIPrefs()
}

/**
 * Save config to localStorage (merged with existing data)
 */
function saveToStorage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    const data = stored ? JSON.parse(stored) : {}
    data.appConfig = appConfig.value
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch (err) {
    console.error('Failed to save app config to storage:', err)
  }
}

/**
 * Merge new classrooms with existing ones (no duplicates)
 */
function mergeClassrooms(existing, incoming) {
  const existingIds = new Set(existing.map(c => c.id))
  const merged = [...existing]

  for (const classroom of incoming) {
    if (!existingIds.has(classroom.id)) {
      merged.push(classroom)
    }
  }

  return merged
}

/**
 * Initialize from URL parameters (silently merge with existing config)
 */
function initializeFromUrl() {
  if (initialized.value) return

  // Load existing config first
  loadFromStorage()
  loadUIPrefs()

  // Parse URL parameters
  const { teacher, classrooms } = parseUrlParams()

  // Merge new data
  if (teacher || classrooms.length > 0) {
    // Update teacher name if not already set
    if (teacher && !appConfig.value.teacherName) {
      appConfig.value.teacherName = teacher
    }

    // Merge classrooms (keep existing, add new)
    if (classrooms.length > 0) {
      appConfig.value.availableClassrooms = mergeClassrooms(
        appConfig.value.availableClassrooms || [],
        classrooms
      )
    }

    // Update timestamp
    if (!appConfig.value.configuredAt) {
      appConfig.value.configuredAt = new Date().toISOString()
    }

    saveToStorage()
  }

  initialized.value = true
}

/**
 * Get full storage data (for debugging or export)
 */
function getStorageData() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

/**
 * Clear all app config (for testing or reset)
 */
function clearConfig() {
  appConfig.value = {
    teacherName: null,
    availableClassrooms: [],
    configuredAt: null
  }
  saveToStorage()
  initialized.value = false
}

export function useAppConfig() {
  // Computed properties
  const isAdHoc = computed(() => {
    return appConfig.value.availableClassrooms.length === 0
  })

  const hasMultipleClassrooms = computed(() => {
    return appConfig.value.availableClassrooms.length > 1
  })

  const hasSingleClassroom = computed(() => {
    return appConfig.value.availableClassrooms.length === 1
  })

  const singleClassroom = computed(() => {
    if (hasSingleClassroom.value) {
      return appConfig.value.availableClassrooms[0]
    }
    return null
  })

  const teacherName = computed(() => appConfig.value.teacherName)
  const availableClassrooms = computed(() => appConfig.value.availableClassrooms)
  const showLoadPbnOption = computed(() => uiPrefs.value.showLoadPbnOption)

  return {
    // State
    appConfig,
    initialized,
    uiPrefs,

    // Computed
    isAdHoc,
    hasMultipleClassrooms,
    hasSingleClassroom,
    singleClassroom,
    teacherName,
    availableClassrooms,
    showLoadPbnOption,

    // Methods
    initializeFromUrl,
    loadFromStorage,
    saveToStorage,
    clearConfig,
    getStorageData,
    getCollectionFromUrl,
    setCollectionInUrl,
    getLessonFromUrl,
    setLessonInUrl,
    getDealFromUrl,
    setDealInUrl,
    setUIPref,

    // Constants
    COLLECTIONS,

    // Utilities (exported for testing)
    parseUrlParams,
    classroomIdToName,
    mergeClassrooms
  }
}

<template>
  <!-- Loading state -->
  <div v-if="visible && loading" class="lesson-browser-loading">
    <div class="loading-spinner"></div>
    <p>Loading lessons...</p>
  </div>

  <!-- Error state (failed to load TOC) -->
  <div v-else-if="visible && tocError" class="lesson-browser-error">
    <p>{{ tocError }}</p>
    <button @click="fetchToc" class="retry-btn">Retry</button>
  </div>

  <!-- Modal mode (when not inline) -->
  <div v-else-if="visible && !inline && toc" class="modal-overlay" @click.self="$emit('close')">
    <div class="lesson-browser">
      <div class="browser-header">
        <h2>{{ toc.name }}</h2>
        <button class="close-btn" @click="$emit('close')">&times;</button>
      </div>

      <div class="browser-content">
        <div
          v-for="grp in displayGroups"
          :key="grp.key"
          class="group-section"
        >
          <button
            v-if="grp.group"
            class="group-header"
            :class="{ expanded: expandedGroups.includes(grp.group) }"
            @click="toggleGroup(grp.group)"
          >
            <span class="expand-icon">{{ expandedGroups.includes(grp.group) ? '▼' : '▶' }}</span>
            <span class="group-name">{{ grp.group }}</span>
            <span class="category-count">{{ grp.categories.length }} sections</span>
          </button>

          <div v-show="!grp.group || expandedGroups.includes(grp.group)" class="group-body">
            <div
              v-for="category in grp.categories"
              :key="category.id"
              class="category-section"
            >
              <button
                class="category-header"
                :class="{ expanded: expandedCategories.includes(category.id) }"
                @click="toggleCategory(category.id)"
              >
                <span class="expand-icon">{{ expandedCategories.includes(category.id) ? '▼' : '▶' }}</span>
                <span class="category-name">{{ category.name }}</span>
                <span class="category-count">{{ category.lessons.length }} lessons</span>
              </button>

              <div v-if="expandedCategories.includes(category.id)" class="lesson-list">
                <button
                  v-for="lesson in category.lessons"
                  :key="lesson.id"
                  class="lesson-item"
                  :class="{ loading: loadingLesson === lesson.id }"
                  @click="selectLesson(lesson, category)"
                >
                  <span class="lesson-name">{{ lesson.name }}</span>
                  <span class="lesson-description">{{ lesson.description }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="error" class="error-message">
        {{ error }}
      </div>
    </div>
  </div>

  <!-- Inline mode (embedded in page) -->
  <div v-else-if="visible && inline && toc" class="lesson-browser-inline">
    <div class="browser-content-inline">
      <div
        v-for="grp in displayGroups"
        :key="grp.key"
        class="group-section"
      >
        <button
          v-if="grp.group"
          class="group-header"
          :class="{ expanded: expandedGroups.includes(grp.group) }"
          @click="toggleGroup(grp.group)"
        >
          <span class="expand-icon">{{ expandedGroups.includes(grp.group) ? '▼' : '▶' }}</span>
          <span class="group-name">{{ grp.group }}</span>
          <span class="category-count">{{ grp.categories.length }} sections</span>
        </button>

        <div v-show="!grp.group || expandedGroups.includes(grp.group)" class="group-body">
          <div
            v-for="category in grp.categories"
            :key="category.id"
            class="category-section"
          >
            <button
              class="category-header"
              :class="{ expanded: expandedCategories.includes(category.id) }"
              @click="toggleCategory(category.id)"
            >
              <span class="expand-icon">{{ expandedCategories.includes(category.id) ? '▼' : '▶' }}</span>
              <span class="category-name">{{ category.name }}</span>
              <span class="category-count">{{ category.lessons.length }} lessons</span>
            </button>

            <div v-if="expandedCategories.includes(category.id)" class="lesson-list">
              <button
                v-for="lesson in category.lessons"
                :key="lesson.id"
                class="lesson-item"
                :class="{ loading: loadingLesson === lesson.id }"
                @click="selectLesson(lesson, category)"
              >
                <span class="lesson-name">{{ lesson.name }}</span>
                <span class="lesson-description">{{ lesson.description }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="error" class="error-message-inline">
      {{ error }}
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, computed } from 'vue'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  inline: {
    type: Boolean,
    default: false
  },
  collection: {
    type: Object,
    default: null
    // Expected shape: { tocUrl, baseUrl }
  }
})

const emit = defineEmits(['close', 'load'])

// TOC data fetched from collection
const toc = ref(null)
const tocError = ref(null)
const loading = ref(false)

// UI state
const expandedCategories = ref([])
const expandedGroups = ref([])
const loadingLesson = ref(null)
const error = ref(null)

// Group categories by their optional `group` field (e.g. Bid / Play / Defend),
// preserving toc order. Categories with no group fall into a single ungrouped
// bucket that renders flat (backward-compatible with group-less collections).
const displayGroups = computed(() => {
  const cats = toc.value?.categories || []
  const order = []
  const byKey = new Map()
  for (const c of cats) {
    const g = c.group || null
    const key = g || '__ungrouped__'
    if (!byKey.has(key)) {
      const entry = { group: g, key, categories: [] }
      byKey.set(key, entry)
      order.push(entry)
    }
    byKey.get(key).categories.push(c)
  }
  return order
})

function toggleGroup(group) {
  const idx = expandedGroups.value.indexOf(group)
  if (idx >= 0) expandedGroups.value.splice(idx, 1)
  else expandedGroups.value.push(group)
}

// Fetch TOC when component becomes visible or collection changes
watch(
  () => [props.visible, props.collection],
  ([visible, collection]) => {
    if (visible && collection && !toc.value) {
      fetchToc()
    }
  },
  { immediate: true }
)

async function fetchToc() {
  if (!props.collection?.tocUrl) {
    tocError.value = 'No collection specified'
    return
  }

  loading.value = true
  tocError.value = null

  try {
    const response = await fetch(props.collection.tocUrl)
    if (!response.ok) {
      throw new Error(`Failed to load: ${response.statusText}`)
    }
    toc.value = await response.json()
  } catch (err) {
    console.error('Error fetching TOC:', err)
    tocError.value = `Could not load lesson catalog. ${err.message}`
  } finally {
    loading.value = false
  }
}

function toggleCategory(categoryId) {
  const idx = expandedCategories.value.indexOf(categoryId)
  if (idx >= 0) {
    expandedCategories.value.splice(idx, 1)
  } else {
    expandedCategories.value.push(categoryId)
  }
}

/**
 * Convert lesson ID to filename
 * e.g., 'Bidpractice/Set1' -> 'Set1'
 */
function getFilename(lessonId) {
  if (lessonId.includes('/')) {
    return lessonId.split('/').pop()
  }
  return lessonId
}

async function selectLesson(lesson, category) {
  error.value = null
  loadingLesson.value = lesson.id

  try {
    const baseUrl = props.collection?.baseUrl || ''
    const filename = getFilename(lesson.id)
    const url = `${baseUrl}/${filename}.pbn`

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to load lesson: ${response.statusText}`)
    }

    const content = await response.text()

    // Emit the loaded content along with metadata
    emit('load', {
      subfolder: lesson.id,
      name: lesson.name,
      category: category.name,
      content
    })

    // Only emit close for modal mode
    if (!props.inline) {
      emit('close')
    }
  } catch (err) {
    console.error('Error loading lesson:', err)
    error.value = `Could not load "${lesson.name}". The lesson may not be available yet.`
  } finally {
    loadingLesson.value = null
  }
}
</script>

<style scoped>
/* Loading and error states */
.lesson-browser-loading,
.lesson-browser-error {
  text-align: center;
  padding: 40px;
  background: white;
  border-radius: 8px;
  max-width: 400px;
  margin: 0 auto;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #f0f0f0;
  border-top-color: #667eea;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.retry-btn {
  margin-top: 16px;
  padding: 8px 16px;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.retry-btn:hover {
  background: #5a6fd6;
}

/* Modal overlay styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.lesson-browser {
  background: white;
  border-radius: 12px;
  width: 100%;
  max-width: 600px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.browser-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #eee;
}

.browser-header h2 {
  margin: 0;
  font-size: 20px;
  color: #333;
}

.close-btn {
  background: none;
  border: none;
  font-size: 28px;
  color: #999;
  cursor: pointer;
  line-height: 1;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.close-btn:hover {
  background: #f0f0f0;
  color: #333;
}

.browser-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

/* Inline mode styles */
.lesson-browser-inline {
  background: white;
  border-radius: 8px;
  width: 100%;
  max-width: 700px;
  margin: 0 auto;
}

.browser-content-inline {
  padding: 8px 0;
}

/* Shared styles for both modes */
/* Bid / Play / Defend top-level groups */
.group-section {
  border-bottom: 1px solid #e6e6e6;
}

.group-section:last-child {
  border-bottom: none;
}

.group-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 15px 20px;
  background: #eef2ff;
  border: none;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s;
}

.group-header:hover,
.group-header.expanded {
  background: #e2e8ff;
}

.group-name {
  flex: 1;
  font-weight: 700;
  color: #2a2a3a;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-size: 14px;
}

/* Indent the category rows nested under a group */
.group-body .category-header {
  padding-left: 32px;
}

.category-section {
  border-bottom: 1px solid #f0f0f0;
}

.category-section:last-child {
  border-bottom: none;
}

.category-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  font-size: 15px;
  transition: background 0.15s;
}

.category-header:hover {
  background: #f8f8f8;
}

.category-header.expanded {
  background: #f5f5f5;
}

.expand-icon {
  font-size: 10px;
  color: #666;
  width: 12px;
}

.category-name {
  flex: 1;
  font-weight: 600;
  color: #333;
}

.category-count {
  font-size: 13px;
  color: #888;
}

.lesson-list {
  background: #fafafa;
  padding: 8px 20px 8px 44px;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px 16px;
}

.lesson-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 12px;
  background: none;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s;
}

.lesson-item:hover {
  background: #e8f4fd;
}

.lesson-item.loading {
  opacity: 0.6;
  cursor: wait;
}

.lesson-name {
  font-size: 14px;
  font-weight: 500;
  color: #1976d2;
}

.lesson-description {
  font-size: 12px;
  color: #666;
  line-height: 1.3;
}

.error-message,
.error-message-inline {
  padding: 12px 20px;
  background: #fff3f3;
  color: #d32f2f;
  font-size: 13px;
  border-top: 1px solid #ffcdd2;
}

.error-message-inline {
  border-radius: 0 0 8px 8px;
}

@media (max-width: 600px) {
  .lesson-browser {
    max-height: 90vh;
  }

  .browser-header {
    padding: 12px 16px;
  }

  .browser-header h2 {
    font-size: 18px;
  }

  .category-header {
    padding: 12px 16px;
    font-size: 14px;
  }

  .lesson-list {
    grid-template-columns: 1fr;
    padding: 4px 16px 4px 36px;
  }

  .lesson-item {
    padding: 8px;
  }
}
</style>

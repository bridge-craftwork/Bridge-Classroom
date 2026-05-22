<template>
  <div class="accomplishments-view">
    <header class="view-header">
      <h2>Accomplishments</h2>
      <button class="close-btn" @click="$emit('close')">&times;</button>
    </header>

    <!-- User selector (if can view other users) -->
    <div v-if="accomplishments.canViewOtherUsers.value" class="user-selector">
      <label for="user-select">Viewing:</label>
      <select
        id="user-select"
        :value="accomplishments.selectedUserId.value"
        @change="onUserChange($event.target.value)"
      >
        <option
          v-for="user in accomplishments.accessibleUsers.value"
          :key="user.id"
          :value="user.id"
        >
          {{ user.name }}{{ user.isSelf ? ' (You)' : '' }}
        </option>
      </select>
    </div>

    <!-- Loading state -->
    <div v-if="accomplishments.loading.value" class="loading-state">
      <div class="spinner"></div>
      <p>Loading accomplishments...</p>
    </div>

    <!-- Error state -->
    <div v-else-if="accomplishments.error.value" class="error-state">
      <p>Failed to load: {{ accomplishments.error.value }}</p>
      <button @click="refresh">Try Again</button>
    </div>

    <!-- No data state -->
    <div v-else-if="!accomplishments.hasData.value" class="empty-state">
      <h3>No Practice Data Yet</h3>
      <p>Complete some practice deals to see your accomplishments here!</p>
      <button class="primary-btn" @click="$emit('close')">Start Practicing</button>
    </div>

    <!-- Main content -->
    <div v-else class="view-content">
      <!-- Tabs -->
      <div class="controls-row">
        <div class="tabs">
          <button
            class="tab-btn"
            :class="{ active: accomplishments.activeTab.value === 'lessons' }"
            @click="accomplishments.activeTab.value = 'lessons'"
          >
            Lessons
          </button>
          <button
            class="tab-btn"
            :class="{ active: accomplishments.activeTab.value === 'taxons' }"
            @click="accomplishments.activeTab.value = 'taxons'"
          >
            Taxons
          </button>
        </div>
      </div>

      <!-- Lessons tab: mastery strips -->
      <div v-if="accomplishments.activeTab.value === 'lessons'" class="tab-content">
        <div v-if="lessonMasteryList.length === 0" class="no-data">
          No lesson data available yet.
        </div>
        <div v-else class="lesson-list">
          <div v-for="lesson in lessonMasteryList" :key="lesson.subfolder" class="lesson-row">
            <div class="lesson-header">
              <span class="lesson-name">{{ formatLessonName(lesson.subfolder) }}</span>
              <span
                v-if="lesson.achievement !== 'none'"
                :class="['achievement-badge', lesson.achievement]"
              >
                &#9733; {{ lesson.achievement === 'gold' ? 'Gold' : 'Silver' }}
              </span>
            </div>
            <BoardMasteryStrip
              :boardNumbers="lesson.boardNumbers"
              :lessonSubfolder="lesson.subfolder"
              :currentIndex="-1"
              :alignLeft="true"
              :userId="accomplishments.selectedUserId.value"
              @goto="(boardIndex) => onBoardClick(lesson.subfolder, lesson.boardNumbers[boardIndex])"
            />
          </div>
        </div>
      </div>

      <!-- Taxons tab: skill cards -->
      <div v-if="accomplishments.activeTab.value === 'taxons'" class="tab-content">
        <div v-if="accomplishments.filteredTaxonStats.value.length === 0" class="no-data">
          No skill data available yet.
        </div>
        <div v-else class="taxon-list">
          <div v-for="taxon in accomplishments.filteredTaxonStats.value" :key="taxon.skillPath" class="taxon-card">
            <div class="taxon-header">
              <span class="taxon-category">{{ taxon.categoryName }}</span>
              <span class="taxon-name">{{ taxon.skillName }}</span>
            </div>
            <div class="taxon-counts">
              <span class="taxon-stat correct">{{ taxon.correct }}</span>
              <span class="taxon-stat incorrect">{{ taxon.incorrect }}</span>
              <span class="taxon-stat total">{{ taxon.total }} total</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="view-actions">
        <button class="secondary-btn" @click="refresh">
          Refresh
        </button>
        <button class="primary-btn" @click="$emit('close')">
          Done
        </button>
      </div>
    </div>

    <!-- Test mode indicator -->
    <div v-if="accomplishments.useTestData.value" class="test-mode-banner">
      Test Mode - Using Generated Data
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, watch } from 'vue'
import { useAccomplishments } from '../composables/useAccomplishments.js'
import { useBoardMastery } from '../composables/useBoardMastery.js'
import { useBoardStatus } from '../composables/useBoardStatus.js'
import { useUserStore } from '../composables/useUserStore.js'
import { generateBoardMasteryTestData } from '../utils/boardMasteryTestData.js'
import BoardMasteryStrip from './BoardMasteryStrip.vue'

const emit = defineEmits(['close', 'navigate-to-deal'])

const accomplishments = useAccomplishments()
const mastery = useBoardMastery()
const boardStatusApi = useBoardStatus()
const userStore = useUserStore()

// Check URL for test mode flag
const urlParams = new URLSearchParams(window.location.search)
const testParam = urlParams.get('test')

onMounted(async () => {
  if (testParam === 'mastery' || testParam === 'accomplishments') {
    accomplishments.enableTestMode(generateBoardMasteryTestData())
  } else {
    await accomplishments.initialize()
  }
})

async function refresh() {
  await accomplishments.loadAccomplishments(true)
}

async function onUserChange(userId) {
  await accomplishments.selectUser(userId)
}

/**
 * Handle clicking a board circle — navigate to that deal
 */
function onBoardClick(subfolder, dealNumber) {
  emit('navigate-to-deal', { subfolder, dealNumber })
}

/**
 * All lessons with mastery data, sorted alphabetically.
 * Mastery comes from the backend `board_status` cache via
 * useBoardStatus. The watcher below populates that cache.
 */
const lessonMasteryList = computed(() => {
  const observations = mastery.getObservations()
  const lessons = mastery.extractLessonsFromObservations(observations)
  const userId = userStore.effectiveUserId.value

  // Touch the cache version so this computed re-runs when fetches land.
  boardStatusApi.cacheVersion.value

  return lessons
    .map(lesson => {
      const apiBoards = userId
        ? (boardStatusApi.getCachedBoards(userId, lesson.subfolder) || [])
        : []
      const boardMasteryResults = boardStatusApi.buildBoardMastery(
        apiBoards,
        lesson.boardNumbers
      )
      const lessonAchievement = mastery.computeLessonAchievement(boardMasteryResults)
      return {
        ...lesson,
        achievement: lessonAchievement.achievement
      }
    })
    .sort((a, b) => formatLessonName(a.subfolder).localeCompare(formatLessonName(b.subfolder)))
})

// Populate caches the lessons depend on: board-number cache and the
// API `board_status` cache. Fires on mount and whenever the lesson set
// changes (e.g. after switching users).
watch(lessonMasteryList, async (lessons) => {
  if (lessons.length === 0) return
  const subfolders = lessons.map(l => l.subfolder)
  mastery.fetchMissingBoardCounts(subfolders)
  const userId = userStore.effectiveUserId.value
  if (userId) {
    await Promise.all(
      subfolders.map(sf => boardStatusApi.fetchBoardStatus(userId, sf))
    )
  }
}, { immediate: true })

function formatLessonName(folderName) {
  return accomplishments.formatLessonName(folderName)
}
</script>

<style scoped>
.accomplishments-view {
  background: white;
  border-radius: 12px;
  max-width: 700px;
  width: 100%;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  position: relative;
}

.view-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #eee;
  flex-shrink: 0;
}

.view-header h2 {
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
  padding: 0;
  line-height: 1;
}

.close-btn:hover {
  color: #333;
}

.user-selector {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  background: #f8f8f8;
  border-bottom: 1px solid #eee;
}

.user-selector label {
  font-size: 14px;
  color: #666;
}

.user-selector select {
  flex: 1;
  max-width: 300px;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  background: white;
}

.loading-state,
.error-state,
.empty-state {
  padding: 60px 20px;
  text-align: center;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #e0e0e0;
  border-top-color: #667eea;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 16px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.error-state {
  color: #d32f2f;
}

.error-state button {
  margin-top: 16px;
  padding: 8px 16px;
  background: #d32f2f;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.empty-state h3 {
  color: #666;
  margin-bottom: 8px;
}

.empty-state p {
  color: #999;
  margin-bottom: 20px;
}

.view-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

.controls-row {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 12px 20px;
  border-bottom: 1px solid #eee;
  background: #fafafa;
  flex-shrink: 0;
}

.tabs {
  display: flex;
  gap: 4px;
}

.tab-btn {
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: #666;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.2s;
}

.tab-btn:hover {
  background: #e8e8e8;
}

.tab-btn.active {
  background: #667eea;
  color: white;
}

.tab-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.no-data {
  text-align: center;
  color: #999;
  padding: 40px 20px;
}

/* Lesson mastery list */
.lesson-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.lesson-row {
  background: #fafafa;
  border-radius: 8px;
  padding: 10px 12px;
}

.lesson-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.lesson-name {
  font-weight: 600;
  font-size: 14px;
  color: #333;
}

.achievement-badge {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 12px;
}

.achievement-badge.gold {
  background: linear-gradient(135deg, #ffd700, #ffb300);
  color: #5d4037;
}

.achievement-badge.silver {
  background: linear-gradient(135deg, #e0e0e0, #bdbdbd);
  color: #424242;
}

/* Taxon list */
.taxon-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.taxon-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: #fafafa;
  border-radius: 8px;
}

.taxon-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.taxon-category {
  font-size: 11px;
  text-transform: uppercase;
  color: #999;
  letter-spacing: 0.3px;
}

.taxon-name {
  font-weight: 500;
  font-size: 14px;
  color: #333;
}

.taxon-counts {
  display: flex;
  gap: 10px;
  align-items: center;
}

.taxon-stat {
  font-size: 14px;
  font-weight: 600;
}

.taxon-stat.correct {
  color: #4caf50;
}

.taxon-stat.incorrect {
  color: #ef5350;
}

.taxon-stat.total {
  color: #999;
  font-weight: 400;
  font-size: 13px;
}

/* Actions */
.view-actions {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid #eee;
  flex-shrink: 0;
}

.primary-btn,
.secondary-btn {
  flex: 1;
  padding: 12px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.primary-btn {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
}

.primary-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.secondary-btn {
  background: white;
  color: #667eea;
  border: 1px solid #667eea;
}

.secondary-btn:hover {
  background: #f5f7ff;
}

.test-mode-banner {
  position: absolute;
  top: 50px;
  left: 0;
  right: 0;
  background: #ff9800;
  color: white;
  text-align: center;
  padding: 4px 8px;
  font-size: 12px;
  font-weight: 500;
}

/* Responsive adjustments */
@media (max-width: 600px) {
  .accomplishments-view {
    max-height: 100vh;
    border-radius: 0;
  }

  .controls-row {
    padding: 8px 12px;
  }
}
</style>

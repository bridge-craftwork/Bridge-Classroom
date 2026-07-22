<template>
  <div class="accomplishments-view">
    <header class="view-header">
      <h2>Accomplishments</h2>
      <span
        v-if="totalFreshPaws + totalRecentPaws > 0"
        class="paw-total"
        :title="`Wild-board masteries: ${totalFreshPaws} fresh, ${totalRecentPaws} recent. Earned by playing a board clean under the 25%/jungle randomization — the strongest mastery signal.`"
      >
        <PawIcon class="paw-total-icon" />
        <strong>{{ totalFreshPaws + totalRecentPaws }}</strong>
        wild {{ totalFreshPaws + totalRecentPaws === 1 ? 'mastery' : 'masteries' }}
      </span>
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
          <div v-for="lesson in lessonMasteryList" :key="`${lesson.collectionId || ''}::${lesson.subfolder}`" class="lesson-row">
            <div class="lesson-header">
              <span class="lesson-name">{{ formatLessonName(lesson.subfolder) }}</span>
              <span v-if="lesson.collectionName" class="lesson-collection">{{ lesson.collectionName }}</span>
              <span
                v-if="lesson.achievement !== 'none'"
                :class="['achievement-badge', lesson.achievement]"
              >
                &#9733; {{ lesson.achievement === 'gold' ? 'Gold' : 'Silver' }}
              </span>
              <span
                v-if="lesson.freshPaws + lesson.recentPaws > 0"
                class="paw-badge"
                :title="`${lesson.freshPaws} fresh + ${lesson.recentPaws} recent wild-board ${lesson.freshPaws + lesson.recentPaws === 1 ? 'mastery' : 'masteries'} in this lesson`"
              >
                <PawIcon :tier="lesson.freshPaws > 0 ? 'Fresh' : 'Recent'" class="paw-badge-icon" />
                {{ lesson.freshPaws + lesson.recentPaws }}
              </span>
            </div>
            <BoardMasteryStrip
              :boardNumbers="lesson.boardNumbers"
              :lessonSubfolder="lesson.subfolder"
              :collectionId="lesson.collectionId"
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
import { useAppConfig } from '../composables/useAppConfig.js'
import { generateBoardMasteryTestData } from '../utils/boardMasteryTestData.js'
import BoardMasteryStrip from './BoardMasteryStrip.vue'
import PawIcon from './PawIcon.vue'

const emit = defineEmits(['close', 'navigate-to-deal'])

const accomplishments = useAccomplishments()
const mastery = useBoardMastery()
const boardStatusApi = useBoardStatus()
const userStore = useUserStore()
const appConfig = useAppConfig()

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
 *
 * The lesson list is sourced from the server's /lesson-mastery rollup — grouped
 * by (collection_id, deal_subfolder) — NOT by iterating observations. board_status
 * already knows every lesson the user has touched and which collection it belongs
 * to, so a subfolder shared across two collections is two distinct lessons here
 * (each its own row). Per-board colour/achievement then comes from the
 * collection-scoped board_status cache. The watcher below populates both caches.
 */
const lessonMasteryList = computed(() => {
  const userId = userStore.effectiveUserId.value
  // Touch the cache version so this computed re-runs when fetches land.
  boardStatusApi.cacheVersion.value

  const boardCounts = mastery.boardCountCache.value
  const entries = userId
    ? (boardStatusApi.getCachedLessonEntries(userId) || []).filter(e => (e.attempted_boards || 0) > 0)
    : []

  return entries
    .map(e => {
      const subfolder = e.deal_subfolder
      const collectionId = e.collection_id || null
      let boardNumbers = boardCounts[subfolder]
      if (!boardNumbers) {
        boardNumbers = []
        for (let i = 1; i <= (e.total_boards || 0); i++) boardNumbers.push(i)
      }
      const apiBoards = boardStatusApi.getCachedBoards(userId, subfolder, collectionId) || []
      const boardMasteryResults = boardStatusApi.buildBoardMastery(apiBoards, boardNumbers)
      const lessonAchievement = mastery.computeLessonAchievement(boardMasteryResults)
      // Wild-mastery paws for this lesson: clean_correct on a Wild board.
      // Fresh = earned on a cold board (the strongest signal); Recent = within
      // the spacing window. Already carried per board by buildBoardMastery.
      const freshPaws = boardMasteryResults.filter(b => b.wildAchievement === 'Fresh').length
      const recentPaws = boardMasteryResults.filter(b => b.wildAchievement === 'Recent').length
      const collection = collectionId ? appConfig.COLLECTIONS.find(c => c.id === collectionId) : null
      return {
        subfolder,
        collectionId,
        collectionName: collection?.name || null,
        boardNumbers,
        achievement: lessonAchievement.achievement,
        freshPaws,
        recentPaws
      }
    })
    .sort((a, b) => formatLessonName(a.subfolder).localeCompare(formatLessonName(b.subfolder)))
})

// Total paws across all lessons — surfaced in the header so the milestone is
// visible at a glance, not buried per-lesson.
const totalFreshPaws = computed(() => lessonMasteryList.value.reduce((n, l) => n + (l.freshPaws || 0), 0))
const totalRecentPaws = computed(() => lessonMasteryList.value.reduce((n, l) => n + (l.recentPaws || 0), 0))

// Populate the caches the lesson list depends on: the /lesson-mastery rollup
// (the source of the lesson list — see lessonMasteryList), the board-number
// cache, and the collection-scoped board_status cache. Fires on mount and
// whenever the effective user changes (e.g. entering view-as / switching users).
async function ensureLessonData() {
  const userId = userStore.effectiveUserId.value
  if (!userId) return
  await boardStatusApi.fetchLessonMastery(userId, true)
  // Fetch board_status per (subfolder, collection_id) so a shared subfolder's
  // two collections cache under distinct scopes — matching the scope
  // lessonMasteryList reads back with.
  const scoped = (boardStatusApi.getCachedLessonEntries(userId) || [])
    .filter(e => (e.attempted_boards || 0) > 0)
    .map(e => ({ subfolder: e.deal_subfolder, collectionId: e.collection_id || null }))
  if (scoped.length === 0) return
  await mastery.fetchMissingBoardCounts(scoped.map(s => s.subfolder))
  await Promise.all(scoped.map(s =>
    boardStatusApi.fetchBoardStatus(userId, s.subfolder, false, s.collectionId)
  ))
}
watch(() => userStore.effectiveUserId.value, ensureLessonData, { immediate: true })

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
  margin: auto;
  max-height: 90dvh;
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

/* Total wild-mastery chip in the header — sits next to the title, pushes the
   close button to the right. */
.paw-total {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: 12px;
  margin-right: auto;
  padding: 3px 12px;
  border-radius: 20px;
  background: #d1fae5;
  color: #047857;
  border: 1px solid #6ee7b7;
  font-size: 13px;
  font-weight: 500;
}
.paw-total strong { font-weight: 700; }
.paw-total-icon { width: 17px; height: 17px; }

/* Per-lesson paw badge next to the gold/silver star badge. The paw glyph
   carries the tier color (gold = has a Fresh paw); the pill stays neutral. */
.paw-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 8px;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  background: #f3f4f6;
  color: #4b5563;
  border: 1px solid #e5e7eb;
}
.paw-badge-icon { width: 13px; height: 13px; }

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

/* Collection label — distinguishes two rows that share a subfolder name but
   belong to different collections. */
.lesson-collection {
  font-size: 11px;
  font-weight: 600;
  color: #667eea;
  background: #eef0fb;
  padding: 1px 8px;
  border-radius: 10px;
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
    max-height: 100dvh;
    border-radius: 0;
  }

  .controls-row {
    padding: 8px 12px;
  }
}
</style>

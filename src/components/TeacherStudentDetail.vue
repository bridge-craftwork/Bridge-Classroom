<template>
  <div class="teacher-student-detail">
    <header class="detail-header">
      <button class="back-btn" @click="$emit('back')">&larr; Students</button>
      <div class="student-info">
        <div class="avatar">{{ initials }}</div>
        <div>
          <h2>{{ studentName }}</h2>
          <span class="last-active">Last active: {{ lastActiveText }}</span>
        </div>
      </div>
    </header>

    <!-- Loading -->
    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <p>Loading student data...</p>
    </div>

    <!-- Content -->
    <div v-else class="detail-content">
      <!-- Tabs -->
      <div class="tab-bar">
        <button
          v-for="tab in tabs" :key="tab.id"
          class="tab-btn"
          :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id"
        >{{ tab.label }}</button>
      </div>

      <!-- Progress tab -->
      <div v-if="activeTab === 'progress'" class="tab-content">
        <StudentProgressPanel
          :observations="observations"
          :studentName="props.studentName"
          :studentId="props.studentId"
        />
      </div>

      <!-- Lesson Mastery tab -->
      <div v-else-if="activeTab === 'mastery'" class="tab-content">
        <!-- Summary stats -->
        <div v-if="summary.total > 0" class="stats-row">
          <!-- Highest attainment first: wilds outrank stars. Gold wild (Fresh)
               → green wild (Recent) → gold star → silver star → status counts. -->
          <div v-if="achievementCounts.freshWilds" class="stat stat-wild"><PawIcon tier="Fresh" class="chip-paw" />{{ achievementCounts.freshWilds }} Fresh</div>
          <div v-if="achievementCounts.recentWilds" class="stat stat-wild"><PawIcon tier="Recent" class="chip-paw" />{{ achievementCounts.recentWilds }} Recent</div>
          <div v-if="achievementCounts.goldStars" class="stat stat-star"><span class="chip-star gold">★</span>{{ achievementCounts.goldStars }} Gold star</div>
          <div v-if="achievementCounts.silverStars" class="stat stat-star"><span class="chip-star silver">★</span>{{ achievementCounts.silverStars }} Silver star</div>
          <div class="stat stat-green">{{ summary.green }} Green</div>
          <div v-if="summary.blue" class="stat stat-blue">{{ summary.blue }} Blue</div>
          <div v-if="summary.orange" class="stat stat-orange">{{ summary.orange }} Orange</div>
          <div v-if="summary.yellow" class="stat stat-yellow">{{ summary.yellow }} Yellow</div>
          <div v-if="summary.red" class="stat stat-red">{{ summary.red }} Red</div>
          <div v-if="summary.grey" class="stat stat-grey">{{ summary.grey }} Grey</div>
        </div>

        <div v-if="lessonMasteryList.length === 0" class="no-data">
          No lesson data available yet.
        </div>
        <div v-else class="lesson-list">
          <div v-for="lesson in lessonMasteryList" :key="`${lesson.collectionId || ''}::${lesson.subfolder}`" class="lesson-row">
            <div class="lesson-header">
              <button class="lesson-name lesson-link" @click="emit('navigate-to-lesson', lesson.subfolder)">{{ formatLessonName(lesson.subfolder) }}</button>
              <span v-if="lesson.collectionName" class="lesson-collection">{{ lesson.collectionName }}</span>
              <span
                v-if="lesson.achievement !== 'none'"
                :class="['achievement-badge', lesson.achievement]"
              >
                &#9733; {{ lesson.achievement === 'gold' ? 'Gold' : 'Silver' }}
              </span>
            </div>
            <div class="mastery-strip">
              <div
                v-for="board in lesson.boardMastery"
                :key="board.boardNumber"
                class="board-circle board-clickable"
                :class="'status-' + board.status"
                :title="getTooltip(board)"
                @click="emit('navigate-to-lesson', lesson.subfolder, board.boardNumber)"
              >
                <span
                  v-if="board.achievement === 'gold'"
                  class="medal gold-medal"
                >&#9733;</span>
                <span
                  v-else-if="board.achievement === 'silver'"
                  class="medal silver-medal"
                >&#9733;</span>
                <!-- Wild-mastery paw (from the board_status rollup), bottom-right
                     so it never collides with the top-right star. -->
                <PawIcon
                  v-if="board.wildAchievement"
                  class="paw-mark"
                  :tier="board.wildAchievement"
                />
                <span class="board-num">{{ board.boardNumber }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="observation-total">{{ observations.length }} observations</div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, watch } from 'vue'
import { useTeacherRole } from '../composables/useTeacherRole.js'
import { useBoardMastery } from '../composables/useBoardMastery.js'
import { useBoardStatus } from '../composables/useBoardStatus.js'
import { useAppConfig } from '../composables/useAppConfig.js'
import PawIcon from './PawIcon.vue'
import { useAccomplishments } from '../composables/useAccomplishments.js'
import StudentProgressPanel from './StudentProgressPanel.vue'

const props = defineProps({
  studentId: { type: String, required: true },
  studentName: { type: String, required: true }
})

const emit = defineEmits(['back', 'navigate-to-lesson'])

const teacherRole = useTeacherRole()
const mastery = useBoardMastery()
const boardStatusApi = useBoardStatus()
const appConfig = useAppConfig()
const accomplishments = useAccomplishments()
const loading = ref(false)
const activeTab = ref('progress')
const apiBoardStatus = ref([])
const tabs = [
  { id: 'progress', label: 'Progress' },
  { id: 'mastery', label: 'Lesson Mastery' },
]

const initials = computed(() => {
  const parts = props.studentName.split(' ')
  return parts.map(p => p[0] || '').join('').toUpperCase()
})

onMounted(async () => {
  // Ensure we have this student's observations
  const obs = teacherRole.studentObservations.value[props.studentId]
  if (!obs) {
    loading.value = true
    await teacherRole.fetchStudentObservations(props.studentId)
    loading.value = false
  }
  // Fetch board status from API for this student
  try {
    apiBoardStatus.value = await boardStatusApi.fetchBoardStatus(props.studentId)
  } catch {
    // Fall back to local computation
  }
})

const observations = computed(() => {
  return teacherRole.studentObservations.value[props.studentId] || []
})

const summary = computed(() => {
  return teacherRole.getStudentMasterySummary(props.studentId)
})

// Star / wild-mastery tallies for the summary row, from the board_status rollup
// (no observation query). Shown highest-attainment first.
const achievementCounts = computed(() => {
  let goldStars = 0, silverStars = 0, freshWilds = 0, recentWilds = 0
  for (const b of apiBoardStatus.value) {
    const ms = b.max_stars || 0
    if (ms >= 2) goldStars++
    else if (ms === 1) silverStars++
    if (b.wild_achievement === 'Fresh') freshWilds++
    else if (b.wild_achievement === 'Recent') recentWilds++
  }
  return { goldStars, silverStars, freshWilds, recentWilds }
})

const lastActiveText = computed(() => {
  return teacherRole.formatTimeSince(summary.value.lastObservationTime)
})

/**
 * Lesson mastery strips. The lesson list is derived directly from the student's
 * board_status rollup (fetched unscoped in onMounted) — grouped by
 * (collection_id, deal_subfolder), the lesson's real identity — NOT by iterating
 * observations. A subfolder shared across two collections is two distinct
 * lessons, each its own row. board_status is the single source of truth
 * (CORRECTNESS_AND_MASTERY.md §10).
 */
const lessonMasteryList = computed(() => {
  const rows = apiBoardStatus.value
  if (rows.length === 0) return []

  const boardCounts = mastery.boardCountCache.value

  const groups = {}
  for (const b of rows) {
    const collectionId = b.collection_id || null
    const key = `${collectionId || ''}::${b.deal_subfolder}`
    if (!groups[key]) groups[key] = { subfolder: b.deal_subfolder, collectionId, rows: [] }
    groups[key].rows.push(b)
  }

  return Object.values(groups)
    .map(g => {
      // Prefer the full board-number list (cached) so untried boards show grey;
      // fall back to just the boards the student has rows for.
      const boardNumbers = boardCounts[g.subfolder]
        || g.rows.map(b => b.deal_number).sort((a, b) => a - b)
      const boardMasteryResults = boardStatusApi.buildBoardMastery(g.rows, boardNumbers)
      const lessonAchievement = mastery.computeLessonAchievement(boardMasteryResults)
      const collection = g.collectionId
        ? appConfig.COLLECTIONS.find(c => c.id === g.collectionId)
        : null
      return {
        subfolder: g.subfolder,
        collectionId: g.collectionId,
        collectionName: collection?.name || null,
        boardNumbers,
        boardMastery: boardMasteryResults,
        achievement: lessonAchievement.achievement
      }
    })
    .sort((a, b) => formatLessonName(a.subfolder).localeCompare(formatLessonName(b.subfolder)))
})

// Fetch board counts for any uncached lessons
watch(lessonMasteryList, (lessons) => {
  mastery.fetchMissingBoardCounts(lessons.map(l => l.subfolder))
}, { immediate: true })

function formatLessonName(folderName) {
  return accomplishments.formatLessonName(folderName)
}

function getTooltip(board) {
  const statusLabels = {
    grey: 'Not attempted',
    red: 'Failed',
    yellow: 'Corrected (recent)',
    orange: 'Corrected \u2014 ready to retry',
    blue: 'Correct (try again after cooldown)',
    green: 'Clean correct'
  }
  const medal = board.achievement === 'gold' ? ' | Gold star'
    : board.achievement === 'silver' ? ' | Silver star' : ''
  const paw = board.wildAchievement === 'Fresh' ? ' | 🐾 Fresh paw (clean on a cold wild board)'
    : board.wildAchievement === 'Recent' ? ' | 🐾 Recent paw (clean on a wild board)' : ''
  return `Board ${board.boardNumber}: ${statusLabels[board.status] || board.status}${medal}${paw}`
}
</script>

<style scoped>
.teacher-student-detail {
  max-width: 800px;
  margin: 0 auto;
  padding: 0 20px;
}

.detail-header {
  margin-bottom: 24px;
}

.back-btn {
  background: none;
  border: none;
  color: #667eea;
  font-size: 14px;
  cursor: pointer;
  padding: 4px 0;
  margin-bottom: 12px;
  display: inline-block;
}

.back-btn:hover {
  color: #5a6fd6;
}

.student-info {
  display: flex;
  align-items: center;
  gap: 14px;
}

.avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 600;
  flex-shrink: 0;
}

.student-info h2 {
  margin: 0;
  font-size: 20px;
  color: #333;
}

.last-active {
  font-size: 13px;
  color: #999;
}

/* Loading */
.loading-state {
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
  to { transform: rotate(360deg); }
}

/* Stats row */
.stats-row {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.stat {
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
}

.stat-green { background: #e8f5e9; color: #2e7d32; }
.stat-blue { background: #e3f2fd; color: #1565c0; }
.stat-orange { background: #fff3e0; color: #e65100; }
.stat-yellow { background: #fffde7; color: #f57f17; }
.stat-red { background: #ffebee; color: #c62828; }
.stat-grey { background: #f5f5f5; color: #757575; }

/* Achievement chips (wilds + stars) — icon + count, neutral pill. */
.stat-wild, .stat-star {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #f3f4f6;
  color: #374151;
}
.chip-paw { width: 16px; height: 16px; }
.chip-star { line-height: 1; font-size: 16px; }
.chip-star.gold { color: #eab308; }
.chip-star.silver { color: #9ca3af; }

/* Tabs */
.tab-bar {
  display: flex;
  gap: 0;
  border-bottom: 2px solid #eee;
  margin-bottom: 20px;
}

.tab-btn {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  padding: 10px 18px;
  font-size: 14px;
  font-weight: 500;
  color: #999;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}

.tab-btn:hover {
  color: #555;
}

.tab-btn.active {
  color: #667eea;
  border-bottom-color: #667eea;
  font-weight: 600;
}

.tab-content {
  min-height: 200px;
}

.no-data {
  text-align: center;
  color: #999;
  padding: 20px;
}

/* Lesson mastery */
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

.lesson-link {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  text-decoration: none;
}

.lesson-link:hover {
  text-decoration: underline;
  color: #667eea;
}

.lesson-name {
  font-weight: 600;
  font-size: 14px;
  color: #333;
}

/* Collection label — distinguishes two rows sharing a subfolder name across
   different collections. */
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

/* Mastery strip (inline circles, same visual as BoardMasteryStrip) */
.mastery-strip {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.board-circle {
  position: relative;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  user-select: none;
}

.board-clickable {
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}

.board-clickable:hover {
  transform: scale(1.15);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
}

.status-grey { background: #ccc; color: #666; }
.status-red { background: #ef5350; color: white; }
.status-yellow { background: #ffeb3b; color: #333; }
.status-orange { background: #ff9800; color: white; }
.status-blue { background: #42a5f5; color: white; }
.status-green { background: #4caf50; color: white; }

.medal {
  position: absolute;
  top: -6px;
  right: -6px;
  font-size: 14px;
  z-index: 1;
  line-height: 1;
}

.gold-medal {
  color: #ffd700;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.3));
}

.silver-medal {
  color: #e8e8e8;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
}

/* Wild-mastery paw glyph (PawIcon owns fill/outline); this just positions and
   sizes it in the circle's bottom-right corner (star owns top-right). */
.paw-mark {
  position: absolute;
  bottom: -6px;
  right: -6px;
  width: 16px;
  height: 16px;
  z-index: 1;
}

.board-num {
  position: relative;
  z-index: 0;
}

.observation-total {
  text-align: center;
  font-size: 12px;
  color: #999;
  margin-top: 12px;
}

/* Responsive */
@media (max-width: 600px) {
  .teacher-student-detail {
    padding: 0 12px;
  }

  .board-circle {
    width: 28px;
    height: 28px;
    font-size: 11px;
  }

  .medal {
    font-size: 12px;
    top: -5px;
    right: -5px;
  }
}
</style>

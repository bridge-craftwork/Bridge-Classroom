<template>
  <div v-if="loading" class="assignment-panel">
    <h3 class="section-title">My Assignments</h3>
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Loading assignments...</p>
    </div>
  </div>

  <div v-else-if="assignments.length === 0" class="assignment-panel">
    <h3 class="section-title">My Assignments</h3>
    <div class="empty-state">
      <p class="empty-title">No assignments yet</p>
      <p class="empty-desc">Your teacher will assign exercises here.</p>
    </div>
  </div>

  <div v-else-if="activeAssignments.length > 0" class="assignment-panel">
    <div class="section-header">
      <h3 class="section-title">My Assignments</h3>
      <button
        v-if="assignments.length > activeAssignments.length"
        class="view-all-link"
        @click="showAllModal = true"
      >
        All assignments &rarr;
      </button>
    </div>

    <div class="assignment-cards">
      <div
        v-for="a in activeAssignments"
        :key="a.id"
        class="assignment-card"
        :class="statusClass(a)"
        @click="$emit('select-assignment', a)"
      >
        <div class="card-top">
          <div class="card-titles">
            <span class="exercise-name">{{ a.exercise_name }}</span>
            <div class="card-meta">
              <span v-if="a.classroom_name" class="meta-item classroom-name">{{ a.classroom_name }}</span>
              <span v-if="a.due_at" class="meta-item" :class="dueClass(a)">{{ dueText(a) }}</span>
            </div>
          </div>
          <div class="card-right">
            <span v-if="a.due_at && !isComplete(a)" class="due-badge" :class="dueClass(a)">
              {{ dueBadgeText(a) }}
            </span>
            <button
              class="action-btn"
              @click.stop="$emit('select-assignment', a)"
            >
              {{ actionLabel(a) }}
            </button>
          </div>
        </div>

        <div class="mastery-section">
          <div class="mastery-bar">
            <template v-if="getMastery(a)">
              <div
                v-for="seg in masterySegments(a)" :key="seg.label"
                class="segment"
                :style="{ width: seg.pct, backgroundColor: seg.color }"
                :title="`${seg.label}: ${seg.count}`"
              ></div>
            </template>
            <div
              v-else
              class="segment fallback"
              :style="{ width: progressPercent(a) + '%' }"
            ></div>
          </div>
          <span class="board-label">{{ a.total_boards }} board{{ a.total_boards !== 1 ? 's' : '' }}</span>
        </div>
      </div>
    </div>

    <!-- All Assignments Modal -->
    <div v-if="showAllModal" class="modal-overlay" @click.self="showAllModal = false">
      <div class="modal-content">
        <div class="modal-header">
          <h3>All Assignments</h3>
          <button class="modal-close" @click="showAllModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="assignment-cards">
            <div
              v-for="a in assignments"
              :key="a.id"
              class="assignment-card"
              :class="statusClass(a)"
              @click="$emit('select-assignment', a); showAllModal = false"
            >
              <div class="card-top">
                <div class="card-titles">
                  <span class="exercise-name">{{ a.exercise_name }}</span>
                  <div class="card-meta">
                    <span v-if="a.classroom_name" class="meta-item classroom-name">{{ a.classroom_name }}</span>
                    <span v-if="a.due_at" class="meta-item" :class="dueClass(a)">{{ dueText(a) }}</span>
                  </div>
                </div>
                <div class="card-right">
                  <button
                    class="action-btn"
                    @click.stop="$emit('select-assignment', a); showAllModal = false"
                  >
                    {{ actionLabel(a) }}
                  </button>
                </div>
              </div>

              <div class="mastery-section">
                <div class="mastery-bar">
                  <template v-if="getMastery(a)">
                    <div
                      v-for="seg in masterySegments(a)" :key="seg.label"
                      class="segment"
                      :style="{ width: seg.pct, backgroundColor: seg.color }"
                      :title="`${seg.label}: ${seg.count}`"
                    ></div>
                  </template>
                  <div
                    v-else
                    class="segment fallback"
                    :style="{ width: progressPercent(a) + '%' }"
                  ></div>
                </div>
                <span class="board-label">{{ a.total_boards }} board{{ a.total_boards !== 1 ? 's' : '' }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useAssignments } from '../../composables/useAssignments.js'
import { useBoardMastery } from '../../composables/useBoardMastery.js'
import { STATUS_COLORS } from '../../utils/studentProgressData.js'

const ACTIVE_WINDOW_DAYS = 7

const props = defineProps({
  assignments: {
    type: Array,
    default: () => []
  },
  loading: {
    type: Boolean,
    default: false
  }
})

defineEmits(['select-assignment'])

const assignmentStore = useAssignments()
const mastery = useBoardMastery()
const masteryMap = ref({})
const showAllModal = ref(false)

// Filter to active assignments: no due date, due in future, or due within past 7 days
const activeAssignments = computed(() => {
  const now = new Date()
  const cutoff = new Date(now.getTime() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  return props.assignments.filter(a => {
    if (!a.due_at) return true
    return parseDueDate(a.due_at) >= cutoff
  })
})

// Fetch exercise boards and compute mastery for each assignment
watch(() => props.assignments, async (assignments) => {
  if (!assignments || assignments.length === 0) return

  for (const a of assignments) {
    if (masteryMap.value[a.id]) continue

    try {
      const boards = await assignmentStore.fetchExerciseBoards(a.exercise_id)
      if (!boards || boards.length === 0) continue

      const allObs = mastery.getObservations()

      // Only count observations made after the assignment was created
      const cutoff = a.assigned_at
      const filteredObs = cutoff ? allObs.filter(o => o.timestamp >= cutoff) : allObs

      const bySubfolder = {}
      for (const b of boards) {
        if (!bySubfolder[b.deal_subfolder]) bySubfolder[b.deal_subfolder] = []
        bySubfolder[b.deal_subfolder].push(b.deal_number)
      }

      // Bucket per CORRECTNESS_AND_MASTERY.md §5. computeBoardMastery
      // returns live-tile colors; we collapse to the §5.4 drilldown
      // palette (yellow → orange) for a static summary bar.
      const buckets = { clean_correct: 0, close_correct: 0, failed: 0, not_attempted: 0 }
      for (const [subfolder, boardNumbers] of Object.entries(bySubfolder)) {
        const boardMastery = mastery.computeBoardMastery(filteredObs, subfolder, boardNumbers)
        for (const b of boardMastery) {
          if (b.status === 'green') buckets.clean_correct++
          else if (b.status === 'red') buckets.failed++
          else if (b.status === 'grey') buckets.not_attempted++
          else buckets.close_correct++  // yellow + orange both render as "close" here
        }
      }

      masteryMap.value = {
        ...masteryMap.value,
        [a.id]: { ...buckets, total: boards.length }
      }
    } catch {
      // Mastery data unavailable — fallback to simple progress bar
    }
  }
}, { immediate: true })

function getMastery(assignment) {
  return masteryMap.value[assignment.id] || null
}

// Bar segments per CORRECTNESS_AND_MASTERY.md §5, matching the
// vocabulary used by RecentLessons and StudentProgressPanel. The
// assignment view buckets close_correct + corrected together (yellow
// collapses to orange per the §5.4 drilldown rule).
function masterySegments(assignment) {
  const m = getMastery(assignment)
  if (!m || m.total === 0) return []
  const segments = [
    { count: m.clean_correct,  color: STATUS_COLORS.clean_correct, label: 'Clean correct' },
    { count: m.close_correct,  color: STATUS_COLORS.close_correct, label: 'Corrected / close' },
    { count: m.failed,         color: STATUS_COLORS.failed,        label: 'Failed' },
    { count: m.not_attempted,  color: STATUS_COLORS.not_attempted, label: 'Not attempted' },
  ].filter(s => s.count > 0)
  const sum = segments.reduce((s, seg) => s + seg.count, 0) || 1
  segments.forEach(s => { s.pct = `${(s.count / sum * 100).toFixed(1)}%` })
  return segments
}

function progressPercent(assignment) {
  if (!assignment.total_boards) return 0
  return Math.round((assignment.attempted_boards / assignment.total_boards) * 100)
}

function statusClass(assignment) {
  if (assignment.attempted_boards >= assignment.total_boards && assignment.total_boards > 0) {
    return 'complete'
  }
  if (assignment.due_at && parseDueDate(assignment.due_at) < new Date() && assignment.attempted_boards < assignment.total_boards) {
    return 'overdue'
  }
  if (assignment.attempted_boards > 0) {
    return 'in-progress'
  }
  return 'new'
}

function actionLabel(assignment) {
  const cls = statusClass(assignment)
  if (cls === 'complete') return 'Redo'
  if (cls === 'in-progress' || cls === 'overdue') return 'Resume'
  return 'Start'
}

function isComplete(assignment) {
  return assignment.attempted_boards >= assignment.total_boards && assignment.total_boards > 0
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function getWeekStart(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  d.setDate(d.getDate() - d.getDay())
  return d
}

function parseDueDate(due) {
  // Parse date-only strings (YYYY-MM-DD) as local dates, not UTC
  const parts = String(due).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return parts ? new Date(+parts[1], +parts[2] - 1, +parts[3]) : new Date(due)
}

function formatDueDate(due) {
  const now = new Date()
  const dueDate = parseDueDate(due)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dueDay = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate())
  const diffDays = Math.round((dueDay - today) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'

  const thisWeekStart = getWeekStart(now)
  const lastWeekStart = new Date(thisWeekStart)
  lastWeekStart.setDate(lastWeekStart.getDate() - 7)
  const nextWeekStart = new Date(thisWeekStart)
  nextWeekStart.setDate(nextWeekStart.getDate() + 7)

  const dueDayTime = dueDay.getTime()
  if (dueDayTime >= thisWeekStart.getTime() && dueDayTime < nextWeekStart.getTime()) {
    return DAY_NAMES[dueDate.getDay()]
  }
  if (dueDayTime >= lastWeekStart.getTime() && dueDayTime < thisWeekStart.getTime()) {
    return `last ${DAY_NAMES[dueDate.getDay()]}`
  }
  if (dueDate.getFullYear() === now.getFullYear()) {
    return `${SHORT_MONTHS[dueDate.getMonth()]} ${dueDate.getDate()}`
  }
  return `${dueDate.getDate()}-${SHORT_MONTHS[dueDate.getMonth()]}-${dueDate.getFullYear()}`
}

function dueText(assignment) {
  if (!assignment.due_at) return isComplete(assignment) ? 'Completed' : null
  const dateStr = formatDueDate(assignment.due_at)
  if (isComplete(assignment)) return `Due ${dateStr} · Completed`
  return 'Due ' + dateStr
}

function dueBadgeText(assignment) {
  if (!assignment.due_at) return ''
  const due = parseDueDate(assignment.due_at)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (due < today) return 'OVERDUE'
  return ('Due ' + formatDueDate(assignment.due_at)).toUpperCase()
}

function dueClass(assignment) {
  if (!assignment.due_at) return ''
  if (isComplete(assignment)) return ''
  const due = parseDueDate(assignment.due_at)
  const now = new Date()
  const diffDays = Math.ceil((due - now) / (1000 * 60 * 60 * 24))
  if (diffDays < 0) return 'overdue'
  if (diffDays <= 1) return 'urgent'
  if (diffDays <= 3) return 'soon'
  return ''
}
</script>

<style scoped>
.assignment-panel {
  margin-bottom: 32px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.section-title {
  font-family: var(--font-heading, 'Source Serif 4', serif);
  font-size: 20px;
  color: var(--green-dark, #2d6a4f);
  margin: 0;
}

.view-all-link {
  background: none;
  border: none;
  color: var(--green-dark, #2d6a4f);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  padding: 4px 0;
}

.view-all-link:hover {
  text-decoration: underline;
}

.loading-state,
.empty-state {
  padding: 32px 20px;
  text-align: center;
  background: white;
  border-radius: var(--radius-card, 10px);
  border: 1px solid var(--card-border, #e0ddd7);
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #e0e0e0;
  border-top-color: #667eea;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 12px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.empty-title {
  font-weight: 500;
  color: var(--text-primary, #1a1a1a);
  margin-bottom: 4px;
}

.empty-desc {
  color: var(--text-secondary, #6b7280);
  font-size: 14px;
}

.assignment-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.assignment-card {
  background: white;
  border-radius: var(--radius-card, 10px);
  border: 1px solid var(--card-border, #e0ddd7);
  border-left: 4px solid #90caf9;
  padding: 16px 20px;
  cursor: pointer;
  transition: all 0.2s;
}

.assignment-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.assignment-card.in-progress {
  border-left-color: #ff9800;
}

.assignment-card.complete {
  border-left-color: #4caf50;
}

.assignment-card.overdue {
  border-left-color: #ef5350;
}

.card-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}

.card-titles {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.exercise-name {
  font-family: var(--font-heading, 'Source Serif 4', serif);
  font-weight: 600;
  font-size: 17px;
  color: var(--text-primary, #1a1a1a);
  line-height: 1.2;
}

.card-meta {
  display: flex;
  gap: 12px;
  font-size: 13px;
  color: var(--text-secondary, #6b7280);
}

.classroom-name {
  color: var(--green-dark, #2d6a4f);
  font-weight: 500;
}

.meta-item.overdue {
  color: #c62828;
  font-weight: 500;
}

.meta-item.urgent {
  color: #e65100;
  font-weight: 500;
}

.meta-item.soon {
  color: #f57f17;
}

.card-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  flex-shrink: 0;
}

.due-badge {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.5px;
  padding: 3px 10px;
  border-radius: 10px;
  background: #fef3c7;
  color: #92400e;
  white-space: nowrap;
}

.due-badge.overdue {
  background: #fee2e2;
  color: #991b1b;
}

.due-badge.urgent {
  background: #fee2e2;
  color: #991b1b;
}

.due-badge.soon {
  background: #fef3c7;
  color: #92400e;
}

.action-btn {
  padding: 6px 16px;
  font-size: 13px;
  font-weight: 600;
  color: white;
  background: var(--green-dark, #2d6a4f);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;
  white-space: nowrap;
}

.action-btn:hover {
  background: var(--green-mid, #40916c);
}

.mastery-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mastery-bar {
  display: flex;
  height: 8px;
  background: var(--card-border, #e0ddd7);
  border-radius: 4px;
  overflow: hidden;
  gap: 1px;
}

.segment {
  height: 100%;
  transition: width 0.3s ease;
}

.segment.fallback {
  background: #4caf50;
}

.board-label {
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
}

/* Modal styles */
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

.modal-content {
  background: var(--bg-warm, #f5f5f5);
  border-radius: var(--radius-card, 12px);
  max-width: 800px;
  width: 100%;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid var(--card-border, #e0ddd7);
}

.modal-header h3 {
  font-family: var(--font-heading, 'Source Serif 4', serif);
  font-size: 20px;
  color: var(--green-dark, #2d6a4f);
  margin: 0;
}

.modal-close {
  background: none;
  border: none;
  font-size: 24px;
  color: var(--text-secondary, #6b7280);
  cursor: pointer;
  padding: 4px 8px;
  line-height: 1;
}

.modal-close:hover {
  color: var(--text-primary, #1a1a1a);
}

.modal-body {
  padding: 20px 24px;
  overflow-y: auto;
}

@media (max-width: 600px) {
  .assignment-cards {
    grid-template-columns: 1fr;
  }

  .modal-content {
    max-height: 90vh;
  }
}
</style>

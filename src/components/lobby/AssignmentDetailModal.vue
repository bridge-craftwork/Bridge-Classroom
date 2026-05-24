<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content">
      <div class="modal-body">
        <!-- Loading -->
        <div v-if="loading" class="loading-state">
          <div class="spinner"></div>
          <p>Loading assignment details...</p>
        </div>

        <!-- Error -->
        <div v-else-if="error" class="error-state">
          <p class="error-text">{{ error }}</p>
          <button class="btn btn-secondary" @click="$emit('close')">Close</button>
        </div>

        <!-- Content -->
        <template v-else-if="assignment">
          <div class="modal-header">
            <div>
              <h2>{{ assignment.exercise_name }}</h2>
              <div class="assignment-meta">
                <span class="meta-item">{{ assignment.total_boards }} {{ assignment.total_boards === 1 ? 'board' : 'boards' }}</span>
                <span v-if="assignment.due_at" class="meta-item">Due {{ formatDate(assignment.due_at) }}</span>
                <span v-if="assignment.classroom_name" class="meta-item">{{ assignment.classroom_name }}</span>
              </div>
            </div>
            <button class="close-btn" @click="$emit('close')" aria-label="Close">&times;</button>
          </div>

          <!-- Grid (issue #7) -->
          <div v-if="rows.length && boards.length" class="grid-wrapper">
            <table class="grid-table">
              <thead>
                <tr>
                  <th class="col-name">Student</th>
                  <th v-for="(b, i) in boards" :key="boardKey(b)" class="col-board" :title="boardTooltip(b)">
                    {{ boardLabel(b, i) }}
                  </th>
                  <th class="col-score">Score</th>
                  <th class="col-duration" title="Active time on this assignment (sum of per-board time spent)">Time</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in rows" :key="row.student.student_id">
                  <td class="col-name">{{ row.student.first_name }} {{ row.student.last_name }}</td>
                  <td
                    v-for="b in boards" :key="boardKey(b)"
                    class="col-board cell"
                  >
                    <button
                      v-if="row.byBoard[boardKey(b)]"
                      class="cell-btn"
                      :style="{ backgroundColor: cellColor(row.byBoard[boardKey(b)].status) }"
                      :title="cellTooltip(row.student, b, row.byBoard[boardKey(b)])"
                      @click="openCell(row.student, row.byBoard[boardKey(b)], $event)"
                    >{{ cellGlyph(row.byBoard[boardKey(b)].status) }}</button>
                    <span v-else class="cell-empty" :title="`Not attempted by ${row.student.first_name}`">·</span>
                  </td>
                  <td class="col-score">
                    <span class="score-text">{{ row.correctCount }}/{{ row.attemptedCount }}</span>
                    <span v-if="row.attemptedCount > 0" class="accuracy-text" :class="accuracyClass(row)">{{ Math.round(row.correctCount / row.attemptedCount * 100) }}%</span>
                  </td>
                  <td class="col-duration">
                    <span v-if="row.student.active_duration_sec > 0" class="duration-text">
                      {{ formatDuration(row.student.active_duration_sec) }}
                    </span>
                    <span v-else class="duration-empty">—</span>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr class="pass-row">
                  <td class="col-name pass-label">Pass rate</td>
                  <td v-for="b in boards" :key="boardKey(b)" class="col-board pass-cell" :title="boardPassTooltip(b)">
                    <span v-if="boardStats(b).attempted > 0" :class="passClass(boardStats(b))">{{ Math.round(boardStats(b).clean / boardStats(b).attempted * 100) }}%</span>
                    <span v-else class="pass-empty">—</span>
                  </td>
                  <td class="col-score"></td>
                  <td class="col-duration"></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <!-- No students -->
          <div v-else class="empty-state">
            <p>No students assigned yet.</p>
          </div>

          <!-- Cell-click error banner (dismissed when clicking a
               different cell or when one succeeds) -->
          <div v-if="cellError" class="cell-error-banner" role="alert">
            {{ cellError }}
            <button class="cell-error-close" @click="cellError = null" aria-label="Dismiss">&times;</button>
          </div>

          <!-- Summary -->
          <div v-if="summary" class="summary-row">
            <span>{{ summary.completed }}/{{ summary.total }} students completed</span>
            <span v-if="summary.avgAccuracy !== null">{{ summary.avgAccuracy }}% avg accuracy</span>
            <span class="legend">
              <span class="legend-item"><span class="legend-dot" :style="{ backgroundColor: cellColor('clean_correct') }"></span>Clean</span>
              <span class="legend-item"><span class="legend-dot" :style="{ backgroundColor: cellColor('corrected') }"></span>Corrected / close</span>
              <span class="legend-item"><span class="legend-dot" :style="{ backgroundColor: cellColor('failed') }"></span>Failed</span>
              <span class="legend-item"><span class="legend-dot legend-empty">·</span>Not attempted</span>
            </span>
          </div>
        </template>
      </div>
    </div>

    <!-- Floating non-modal observation viewers (issue #7). Lives outside
         .modal-content so the grid stays visible behind. -->
    <ObservationPopupManager ref="popupManager" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useAssignments } from '../../composables/useAssignments.js'
import { useTeacherRole } from '../../composables/useTeacherRole.js'
import { STATUS_COLORS } from '../../utils/studentProgressData.js'
import ObservationPopupManager from '../ObservationPopupManager.vue'

const props = defineProps({
  assignmentId: { type: String, required: true }
})

defineEmits(['close'])

const assignments = useAssignments()
const teacherRole = useTeacherRole()
const loading = ref(true)
const error = ref(null)
const popupManager = ref(null)
// Transient error from openCell so failed decryption is visible to
// the teacher instead of silently console.warn'd.
const cellError = ref(null)

const assignment = computed(() => assignments.currentAssignment.value)
const boards = computed(() => assignment.value?.boards || [])
const cells = computed(() => assignment.value?.cells || [])

// Decide whether to qualify each board with its lesson prefix. If
// every board in the exercise is from the same lesson, just show the
// deal_number. If lessons are mixed, prepend a 2-letter abbreviation
// so the teacher can tell them apart at a glance.
const isMixedLesson = computed(() => {
  const subfolders = new Set(boards.value.map(b => b.deal_subfolder))
  return subfolders.size > 1
})

function boardKey(b) {
  return `${b.deal_subfolder}:${b.deal_number}`
}

function boardLabel(b, i) {
  if (!isMixedLesson.value) return String(i + 1)
  const prefix = (b.deal_subfolder || '?').slice(0, 1).toUpperCase()
  return `${prefix}${b.deal_number}`
}

function boardTooltip(b) {
  return `${b.deal_subfolder} #${b.deal_number}`
}

// Rows: one per student, with per-board cells indexed by boardKey.
const rows = computed(() => {
  const progress = assignment.value?.student_progress || []
  const byStudent = new Map()
  for (const c of cells.value) {
    if (!byStudent.has(c.student_id)) byStudent.set(c.student_id, {})
    byStudent.get(c.student_id)[boardKey(c)] = c
  }

  return progress.map(s => {
    const byBoard = byStudent.get(s.student_id) || {}
    let cleanCount = 0
    let correctCount = 0
    let attemptedCount = 0
    for (const k in byBoard) {
      const cell = byBoard[k]
      attemptedCount++
      if (cell.status === 'clean_correct') cleanCount++
      if (cell.correct) correctCount++
    }
    return {
      student: s,
      byBoard,
      cleanCount,
      correctCount,
      attemptedCount,
    }
  })
})

// Per-board pass rate footer (issue #7 difficulty hint).
function boardStats(b) {
  const key = boardKey(b)
  let attempted = 0
  let clean = 0
  for (const c of cells.value) {
    if (boardKey(c) !== key) continue
    attempted++
    if (c.status === 'clean_correct') clean++
  }
  return { attempted, clean }
}

function boardPassTooltip(b) {
  const s = boardStats(b)
  if (s.attempted === 0) return `${boardTooltip(b)}: not attempted by anyone`
  return `${boardTooltip(b)}: ${s.clean}/${s.attempted} clean_correct`
}

function passClass({ clean, attempted }) {
  if (attempted === 0) return ''
  const pct = clean / attempted
  if (pct >= 0.75) return 'pass-high'
  if (pct >= 0.50) return 'pass-mid'
  return 'pass-low'
}

// Status → color, taking the §5.4 drilldown shortcut (close_correct
// and corrected both render orange). STATUS_COLORS already encodes
// this convention; this wrapper just defaults unknowns to grey.
function cellColor(status) {
  return STATUS_COLORS[status] || STATUS_COLORS.not_attempted
}

function cellGlyph(status) {
  switch (status) {
    case 'clean_correct': return '✓'
    case 'corrected':     return '~'
    case 'close_correct': return '≈'
    case 'failed':        return '✗'
    default:              return ''
  }
}

function cellTooltip(student, board, cell) {
  const status = cell.status || 'unknown'
  const ts = formatTimestamp(cell.timestamp)
  return `${student.first_name} ${student.last_name} · ${boardTooltip(board)} · ${status} · ${ts}`
}

async function openCell(student, cell, event) {
  if (!popupManager.value) return
  cellError.value = null
  // Capture the click position upfront — `await` below means by the
  // time openObservation runs the event has been recycled.
  const clickPos = event
    ? { clientX: event.clientX, clientY: event.clientY }
    : null

  // findAndDecryptObservation reads from a per-student observation
  // cache populated by fetchStudentObservations(). In the
  // StudentProgressPanel context the parent loads those observations
  // eagerly; in the AssignmentDetailModal we don't, so do it lazily
  // on first click for this student. The composable caches by user_id
  // for 5 minutes so repeated clicks are cheap.
  await teacherRole.fetchStudentObservations(student.student_id)

  const rawTs = new Date(cell.timestamp).getTime()
  const decrypted = await teacherRole.findAndDecryptObservation(
    student.student_id,
    rawTs,
    cell.deal_number,
    cell.correct,
  )
  if (decrypted) {
    popupManager.value.openObservation(decrypted, clickPos)
  } else {
    // Most common cause: the student hasn't granted observation
    // viewing to this teacher (no decryption key path). Surface it
    // so the click doesn't appear to do nothing.
    cellError.value = `Could not load this observation. ${student.first_name} may not have granted viewing access yet.`
    console.warn('Observation decryption failed — fetched observations did not include the cell, or no decryption grant')
  }
}

const summary = computed(() => {
  const progress = assignment.value?.student_progress
  if (!progress || progress.length === 0) return null

  const total = progress.length
  const completed = progress.filter(s => s.attempted_boards >= s.total_boards).length
  const studentsWithAttempts = progress.filter(s => s.attempted_boards > 0)
  let avgAccuracy = null
  if (studentsWithAttempts.length > 0) {
    const sum = studentsWithAttempts.reduce((acc, s) => {
      return acc + (s.correct_boards / s.attempted_boards) * 100
    }, 0)
    avgAccuracy = Math.round(sum / studentsWithAttempts.length)
  }

  return { total, completed, avgAccuracy }
})

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatTimestamp(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatDuration(sec) {
  if (sec == null || sec <= 0) return '—'
  if (sec < 60) return `${sec}s`
  const mins = Math.round(sec / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const remMins = mins % 60
  return remMins ? `${hours}h${remMins}m` : `${hours}h`
}

function accuracyClass(row) {
  if (row.attemptedCount === 0) return ''
  const pct = row.correctCount / row.attemptedCount
  if (pct >= 0.80) return 'accuracy-high'
  if (pct >= 0.50) return 'accuracy-mid'
  return 'accuracy-low'
}

onMounted(async () => {
  const result = await assignments.fetchAssignmentDetail(props.assignmentId)
  if (!result?.success) {
    error.value = assignments.error.value || 'Failed to load assignment details'
  }
  loading.value = false
})
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  z-index: 2000;
  padding: 40px 20px;
  overflow-y: auto;
}

.modal-content {
  background: white;
  border-radius: var(--radius-card, 10px);
  max-width: 1100px;
  width: 100%;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.2);
}

.modal-body {
  padding: 28px 32px;
}

.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
  gap: 16px;
}

.modal-header h2 {
  font-family: var(--font-heading, 'Source Serif 4', serif);
  font-size: 22px;
  color: var(--green-dark, #2d6a4f);
  margin: 0;
}

.assignment-meta {
  display: flex;
  gap: 14px;
  margin-top: 6px;
  font-size: 13px;
  color: var(--text-secondary, #6b7280);
}

.meta-item {
  white-space: nowrap;
}

.close-btn {
  background: none;
  border: none;
  font-size: 26px;
  color: var(--text-muted, #9ca3af);
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}

.close-btn:hover {
  color: var(--text-primary, #1a1a1a);
}

/* Grid */
.grid-wrapper {
  overflow-x: auto;
  border: 1px solid var(--card-border, #e0ddd7);
  border-radius: 6px;
}

.grid-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.grid-table thead th,
.grid-table tfoot td {
  background: #fafafa;
  font-weight: 500;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted, #9ca3af);
  padding: 8px 6px;
  border-bottom: 1px solid var(--card-border, #e0ddd7);
}

.grid-table tfoot td {
  border-bottom: none;
  border-top: 1px solid var(--card-border, #e0ddd7);
}

.grid-table tbody td {
  padding: 6px;
  border-bottom: 1px solid #f3f4f6;
  color: var(--text-primary, #1a1a1a);
  vertical-align: middle;
}

.grid-table tbody tr:last-child td {
  border-bottom: none;
}

.col-name {
  text-align: left;
  white-space: nowrap;
  padding-left: 12px !important;
  min-width: 140px;
}

.col-board {
  text-align: center;
  width: 36px;
  min-width: 36px;
}

.col-score {
  text-align: right;
  padding-right: 12px !important;
  white-space: nowrap;
  min-width: 90px;
}

.col-duration {
  text-align: right;
  padding-right: 12px !important;
  white-space: nowrap;
  min-width: 50px;
}

.duration-text {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
}

.duration-empty {
  color: var(--text-muted, #d1d5db);
}

.cell-error-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  padding: 8px 12px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  color: #b91c1c;
  font-size: 13px;
}

.cell-error-close {
  background: none;
  border: none;
  font-size: 18px;
  color: inherit;
  cursor: pointer;
  padding: 0 4px;
}

/* Cells */
.cell {
  padding: 4px !important;
}

.cell-btn {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 600;
  color: white;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-body, 'DM Sans', sans-serif);
  transition: transform 0.12s, box-shadow 0.12s;
}

.cell-btn:hover {
  transform: scale(1.1);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
}

.cell-empty {
  display: inline-block;
  width: 26px;
  height: 26px;
  line-height: 26px;
  text-align: center;
  color: var(--text-muted, #9ca3af);
  font-size: 18px;
  user-select: none;
}

/* Per-row score column */
.score-text {
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}

.accuracy-text {
  font-size: 11px;
  margin-left: 6px;
  font-weight: 500;
}

.accuracy-high { color: var(--green-mid, #40916c); }
.accuracy-mid { color: #d97706; }
.accuracy-low { color: var(--red, #ef4444); }

/* Pass rate footer */
.pass-row td {
  font-variant-numeric: tabular-nums;
}

.pass-label {
  text-align: left;
  padding-left: 12px !important;
}

.pass-cell {
  text-align: center;
  font-size: 11px !important;
  font-weight: 500;
}

.pass-high { color: var(--green-mid, #40916c); }
.pass-mid  { color: #d97706; }
.pass-low  { color: var(--red, #ef4444); }
.pass-empty { color: var(--text-muted, #d1d5db); }

/* Summary */
.summary-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--card-border, #e0ddd7);
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
  flex-wrap: wrap;
  gap: 12px;
}

.legend {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  display: inline-block;
}

.legend-empty {
  background: transparent;
  text-align: center;
  color: var(--text-muted, #9ca3af);
  line-height: 10px;
  font-size: 12px;
}

/* States */
.loading-state {
  text-align: center;
  padding: 40px 20px;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #e0e0e0;
  border-top-color: #2d6a4f;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 12px;
}

@keyframes spin { to { transform: rotate(360deg); } }

.empty-state {
  text-align: center;
  padding: 24px;
  color: var(--text-muted, #9ca3af);
}

.error-state {
  text-align: center;
  padding: 24px;
}

.error-text {
  color: var(--red, #ef4444);
  margin-bottom: 16px;
}

.btn {
  padding: 10px 20px;
  border-radius: var(--radius-button, 6px);
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
  font-family: var(--font-body, 'DM Sans', sans-serif);
}

.btn-secondary {
  background: #f3f4f6;
  color: var(--text-primary, #1a1a1a);
}

.btn-secondary:hover {
  background: #e5e7eb;
}
</style>

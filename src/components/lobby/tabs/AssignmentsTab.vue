<template>
  <div class="assignments-tab">
    <div class="actions-row">
      <button class="action-btn assign" @click="showAssignModal = true">
        + New Assignment
      </button>
    </div>

    <div v-if="loading && !assignments.length" class="loading-state">
      <div class="spinner"></div>
      <p>Loading assignments...</p>
    </div>

    <div v-else-if="!assignments.length" class="empty-state">
      <p class="empty-title">No open assignments</p>
      <p class="empty-desc">Click <strong>+ New Assignment</strong> to assign an exercise to a classroom.</p>
    </div>

    <div v-else class="assignment-list">
      <div
        v-for="a in sortedAssignments"
        :key="a.id"
        class="assignment-row"
        :class="{ closed: a.closed_at }"
        @click="selectedAssignmentId = a.id"
      >
        <div class="assignment-body">
          <div class="assignment-top">
            <div class="assignment-main">
              <span class="assignment-name">
                {{ a.exercise_name }}
                <span v-if="a.closed_at" class="closed-badge">Closed</span>
              </span>
              <!--
                Individual assignments don't have a classroom_name; the
                backend supplies student_name so the row shows
                "Terry Lee" instead of an empty subtitle (issue #7).
              -->
              <span v-if="assignmentSubtitle(a)" class="assignment-subtitle">
                {{ assignmentSubtitle(a) }}
              </span>
            </div>
            <div class="assignment-meta">
              <span class="assignment-boards">{{ a.total_boards }} {{ a.total_boards === 1 ? 'board' : 'boards' }}</span>
              <span v-if="a.due_at" class="assignment-due" :class="{ overdue: isOverdue(a) && !a.closed_at }">
                Due {{ formatDate(a.due_at) }}
              </span>
              <span v-else class="assignment-due no-due">No due date</span>
              <button
                class="close-toggle"
                :class="{ reopen: a.closed_at }"
                :disabled="busyId === a.id"
                @click.stop="toggleClosed(a)"
              >
                {{ a.closed_at ? 'Reopen' : 'Close' }}
              </button>
            </div>
          </div>
          <AssignmentStatChips :assignment="a" />
        </div>
        <span class="view-arrow">&#x203A;</span>
      </div>
    </div>

    <AssignmentCreateModal
      v-if="showAssignModal"
      @close="showAssignModal = false"
      @assignment-created="handleAssignmentCreated"
    />

    <AssignmentDetailModal
      v-if="selectedAssignmentId"
      :assignment-id="selectedAssignmentId"
      @close="selectedAssignmentId = null"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useUserStore } from '../../../composables/useUserStore.js'
import { useAssignments } from '../../../composables/useAssignments.js'
import AssignmentCreateModal from '../AssignmentCreateModal.vue'
import AssignmentDetailModal from '../AssignmentDetailModal.vue'
import AssignmentStatChips from '../AssignmentStatChips.vue'

const userStore = useUserStore()
const assignmentStore = useAssignments()

const showAssignModal = ref(false)
const selectedAssignmentId = ref(null)
const busyId = ref(null)

const assignments = computed(() => assignmentStore.teacherAssignments.value)
const loading = computed(() => assignmentStore.loading.value)

// Open assignments first, closed (archived) sink to the bottom. Array.sort is
// stable, so within each group the server's assigned_at-DESC order is kept.
const sortedAssignments = computed(() =>
  [...assignments.value].sort((a, b) => (a.closed_at ? 1 : 0) - (b.closed_at ? 1 : 0))
)

async function toggleClosed(a) {
  busyId.value = a.id
  try {
    await assignmentStore.setAssignmentClosed(a.id, !a.closed_at)
  } finally {
    busyId.value = null
  }
}

// Classroom assignments show the classroom name; individual assignments
// show the targeted student's name (the backend denormalizes it onto
// the row). Per the screenshot in issue #7, an empty subtitle line on
// individual assignments is a regression worth fixing.
function assignmentSubtitle(a) {
  return a.classroom_name || a.student_name || ''
}

// Parse date-only strings (YYYY-MM-DD) as LOCAL dates, not UTC. `new Date('2026-06-15')`
// parses as UTC midnight, which renders as the previous day in western timezones —
// the off-by-one that made "due Jun 15" show as "Jun 14". Mirrors parseDueDate in
// AssignmentPanel.vue so the teacher and student views agree.
function parseDueDate(due) {
  const parts = String(due).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return parts ? new Date(+parts[1], +parts[2] - 1, +parts[3]) : new Date(due)
}

function isOverdue(a) {
  if (!a.due_at) return false
  // Due "Jun 15" means end of Jun 15: not overdue until the due calendar day has passed.
  const diffDays = Math.ceil((parseDueDate(a.due_at) - new Date()) / (1000 * 60 * 60 * 24))
  return diffDays < 0
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  return parseDueDate(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function loadAssignments() {
  const user = userStore.currentUser.value
  if (user) {
    assignmentStore.fetchTeacherAssignments(user.id)
  }
}

function handleAssignmentCreated() {
  showAssignModal.value = false
  loadAssignments()
}

onMounted(loadAssignments)
</script>

<style scoped>
.assignments-tab {
  padding: 8px 0;
}

.actions-row {
  display: flex;
  justify-content: flex-start;
  margin-bottom: 20px;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  border-radius: var(--radius-button, 6px);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
  font-family: var(--font-body, 'DM Sans', sans-serif);
}

.action-btn.assign {
  background: #e3f2fd;
  color: #1565c0;
}

.action-btn.assign:hover {
  background: #bbdefb;
}

.loading-state {
  text-align: center;
  padding: 60px 20px;
}

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid #e0e0e0;
  border-top-color: #2d6a4f;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 12px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.empty-state {
  text-align: center;
  padding: 32px;
  background: white;
  border-radius: var(--radius-card, 10px);
  border: 1px dashed var(--card-border, #e0ddd7);
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

.assignment-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.assignment-row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  background: white;
  border: 1px solid var(--card-border, #e0ddd7);
  border-radius: var(--radius-card, 10px);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.assignment-row:hover {
  background: #f9fafb;
  border-color: var(--green-mid, #40916c);
}

.assignment-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.assignment-top {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: baseline;
  gap: 16px;
}

.assignment-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.assignment-name {
  font-weight: 500;
  color: var(--text-primary, #1a1a1a);
}

.assignment-subtitle {
  font-size: 13px;
  color: var(--text-secondary, #6b7280);
}

.assignment-meta {
  display: flex;
  gap: 12px;
  align-items: center;
  font-size: 13px;
  color: var(--text-secondary, #6b7280);
  white-space: nowrap;
}

.assignment-due.overdue {
  color: #c62828;
  font-weight: 500;
}

.assignment-due.no-due {
  color: #9ca3af;
  font-style: italic;
}

/* Closed (archived) assignments: dimmed, badged, sunk to the bottom. Still
   clickable to review results. */
.assignment-row.closed {
  background: #f7f7f6;
  opacity: 0.72;
}

.assignment-row.closed:hover {
  opacity: 1;
}

.closed-badge {
  display: inline-block;
  margin-left: 8px;
  padding: 1px 7px;
  border-radius: 999px;
  background: #e5e7eb;
  color: #6b7280;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  vertical-align: middle;
}

.close-toggle {
  border: 1px solid var(--card-border, #e0ddd7);
  background: white;
  color: var(--text-secondary, #6b7280);
  padding: 3px 12px;
  border-radius: var(--radius-button, 6px);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  font-family: var(--font-body, 'DM Sans', sans-serif);
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.close-toggle:hover {
  background: #fff5f5;
  border-color: #f0b4b4;
  color: #c0392b;
}

.close-toggle.reopen:hover {
  background: #eef7f1;
  border-color: var(--green-mid, #40916c);
  color: var(--green-dark, #2d6a4f);
}

.close-toggle:disabled {
  opacity: 0.5;
  cursor: default;
}

.view-arrow {
  font-size: 20px;
  color: #c0c5cc;
}
</style>

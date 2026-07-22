<script setup>
import { computed } from 'vue'
import { useAssignmentStore } from '../composables/useAssignmentStore.js'

const assignmentStore = useAssignmentStore()

// Computed
const assignment = computed(() => assignmentStore.currentAssignment.value)
const isActive = computed(() => assignmentStore.hasActiveAssignment.value)
const progress = computed(() => assignmentStore.assignmentProgress.value)
const isComplete = computed(() => assignmentStore.isAssignmentComplete.value)
const inAssignmentMode = computed(() => assignmentStore.inAssignmentMode.value)

// Parse date-only strings (YYYY-MM-DD) as LOCAL dates, not UTC — `new Date('2026-06-15')`
// is UTC midnight, which renders as the previous day in western timezones (off-by-one).
function parseDueDate(due) {
  const parts = String(due).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return parts ? new Date(+parts[1], +parts[2] - 1, +parts[3]) : new Date(due)
}

const daysUntilDue = computed(() => {
  if (!assignment.value?.dueDate) return null

  const due = parseDueDate(assignment.value.dueDate)
  const now = new Date()
  const diff = Math.ceil((due - now) / (1000 * 60 * 60 * 24))

  return diff
})

const dueText = computed(() => {
  if (daysUntilDue.value === null) return null
  if (daysUntilDue.value < 0) return isComplete.value ? 'Completed' : 'Overdue'
  if (daysUntilDue.value === 0) return 'Due today'
  if (daysUntilDue.value === 1) return 'Due tomorrow'
  return `Due in ${daysUntilDue.value} days`
})

const dueClass = computed(() => {
  if (daysUntilDue.value === null) return ''
  if (isComplete.value) return ''
  if (daysUntilDue.value < 0) return 'overdue'
  if (daysUntilDue.value <= 1) return 'urgent'
  if (daysUntilDue.value <= 3) return 'soon'
  return ''
})

// Methods
function handleExit() {
  assignmentStore.exitAssignmentMode()
}

function handleReturn() {
  assignmentStore.returnToAssignmentMode()
}
</script>

<template>
  <!-- Active assignment banner (in assignment mode) -->
  <div v-if="isActive && inAssignmentMode" class="assignment-banner" :class="{ complete: isComplete }">
    <div class="banner-content">
      <div class="assignment-info">
        <div class="assignment-title">
          <span class="assignment-label">Assignment:</span>
          <span class="assignment-name">{{ assignment?.name }}</span>
        </div>

        <div class="assignment-meta">
          <span class="progress-text">
            {{ progress.completed }} of {{ progress.total }} deals ({{ progress.percent }}%)
          </span>
          <span v-if="dueText" class="due-text" :class="dueClass">
            {{ dueText }}
          </span>
        </div>
      </div>

      <div class="progress-bar">
        <div
          class="progress-fill"
          :style="{ width: `${progress.percent}%` }"
          :class="{ complete: isComplete }"
        ></div>
      </div>

      <button
        class="exit-btn"
        @click="handleExit"
        title="Practice freely without assignment tracking"
      >
        Free Practice
      </button>
    </div>

    <div v-if="isComplete" class="complete-badge">
      Complete!
    </div>
  </div>

  <!-- Return to assignment button (when not in assignment mode but assignment exists) -->
  <div
    v-else-if="assignment && !inAssignmentMode"
    class="return-banner"
    @click="handleReturn"
  >
    <span class="return-icon">&#8592;</span>
    <span class="return-text">
      Return to assignment: {{ assignment?.name }} ({{ progress.percent }}% complete)
    </span>
  </div>
</template>

<style scoped>
.assignment-banner {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 16px;
  position: relative;
  overflow: hidden;
}

.assignment-banner.complete {
  background: linear-gradient(135deg, #4caf50 0%, #2e7d32 100%);
}

.banner-content {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.assignment-info {
  flex: 1 1 200px;
  /* A flex item defaults to min-width:auto, which refuses to shrink below its
     content and lets long assignment names overflow into the row below. */
  min-width: 0;
}

.assignment-title {
  display: flex;
  align-items: center;
  gap: 8px;
  /* Wrap instead of overflowing when the name is long or the banner is narrow
     (bug-artifacts #32: "Assignment: NMF 1 of 3" collided with the meta row). */
  flex-wrap: wrap;
  row-gap: 2px;
  margin-bottom: 4px;
  min-width: 0;
}

.assignment-label {
  font-size: 12px;
  opacity: 0.9;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.assignment-name {
  font-weight: 600;
  font-size: 15px;
  /* Break rather than force the row wider than its container. */
  overflow-wrap: anywhere;
}

.assignment-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  /* Let the progress text and due chip wrap onto their own line instead of
     colliding with the title above on narrow/squeezed banners. */
  flex-wrap: wrap;
  row-gap: 4px;
  font-size: 13px;
  opacity: 0.9;
  min-width: 0;
}

.due-text {
  padding: 2px 8px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  font-size: 12px;
}

.due-text.urgent {
  background: rgba(255, 193, 7, 0.4);
}

.due-text.overdue {
  background: rgba(244, 67, 54, 0.4);
}

.progress-bar {
  flex: 0 0 120px;
  height: 8px;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: white;
  border-radius: 4px;
  transition: width 0.3s ease;
}

.progress-fill.complete {
  background: #c8e6c9;
}

.exit-btn {
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 4px;
  color: white;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s;
  white-space: nowrap;
}

.exit-btn:hover {
  background: rgba(255, 255, 255, 0.3);
}

.complete-badge {
  position: absolute;
  top: 8px;
  right: 12px;
  background: white;
  color: #2e7d32;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}

/* Return banner */
.return-banner {
  background: #f5f5f5;
  border: 1px solid #e0e0e0;
  border-left: 4px solid #667eea;
  padding: 10px 14px;
  border-radius: 4px;
  margin-bottom: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  transition: background 0.2s;
}

.return-banner:hover {
  background: #eeeeee;
}

.return-icon {
  font-size: 18px;
  color: #667eea;
}

.return-text {
  font-size: 14px;
  color: #555;
}

@media (max-width: 500px) {
  .banner-content {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .progress-bar {
    flex: 0 0 8px;
    width: 100%;
  }

  .exit-btn {
    align-self: flex-start;
  }

  .complete-badge {
    position: static;
    align-self: flex-start;
    margin-top: 8px;
  }
}
</style>

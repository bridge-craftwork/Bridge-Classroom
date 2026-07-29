<template>
  <div class="recent-activity">
    <div class="panel-header">
      <h3 class="panel-title">Recent Activity</h3>
      <button v-if="events.length" class="clear-btn" @click="$emit('clear')">Clear</button>
    </div>
    <div v-if="!events.length" class="empty-state">
      No recent activity.
    </div>
    <div v-else class="activity-list">
      <div
        v-for="(event, i) in events"
        :key="i"
        class="activity-item"
      >
        <span class="event-icon" :class="event.type">{{ iconFor(event.type) }}</span>
        <div class="event-content">
          <span class="event-text">{{ describeEvent(event) }}</span>
          <span class="event-time">{{ formatTimeSince(event.timestamp) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useAnonymizer } from '../../composables/useAnonymizer.js'

defineProps({
  events: { type: Array, default: () => [] }
})

defineEmits(['clear'])

const anon = useAnonymizer()

// Prefer the split name fields (issue #334) so anonymization matches the
// rosters; fall back to the pre-joined student_name for older backends.
function studentLabel(event) {
  if (event.student_first_name != null || event.student_last_name != null) {
    return anon.displayFullName({
      first_name: event.student_first_name || '',
      last_name: event.student_last_name || ''
    })
  }
  return event.student_name
}

function iconFor(type) {
  switch (type) {
    case 'assignment_completed': return '\u2714' // check mark
    case 'student_joined': return '\u2795' // plus
    default: return '\u2022'
  }
}

function describeEvent(event) {
  switch (event.type) {
    case 'assignment_completed':
      return `${studentLabel(event)} completed ${event.exercise_name}`
    case 'student_joined':
      return `${studentLabel(event)} joined ${event.classroom_name}`
    default:
      return ''
  }
}

function formatTimeSince(timestamp) {
  if (!timestamp) return ''
  const diff = Date.now() - new Date(timestamp).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
</script>

<style scoped>
.recent-activity {
  background: white;
  border-radius: var(--radius-card, 10px);
  border: 1px solid var(--card-border, #e0ddd7);
  padding: 20px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.panel-title {
  font-family: var(--font-heading, 'Source Serif 4', serif);
  font-size: 18px;
  color: var(--green-dark, #2d6a4f);
  margin: 0;
}

.clear-btn {
  padding: 4px 12px;
  background: none;
  border: 1px solid var(--card-border, #e0ddd7);
  border-radius: var(--radius-button, 6px);
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
  cursor: pointer;
  font-family: var(--font-body, 'DM Sans', sans-serif);
  transition: all 0.2s;
}

.clear-btn:hover {
  background: #f3f4f6;
  color: var(--text-primary, #1a1a1a);
}

.empty-state {
  color: var(--text-muted, #9ca3af);
  font-size: 14px;
  text-align: center;
  padding: 16px;
}

.activity-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.activity-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-button, 6px);
  font-size: 13px;
}

.activity-item:hover {
  background: #f8f9fa;
}

.event-icon {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: white;
}

.event-icon.assignment_completed {
  background: #4caf50;
}

.event-icon.student_joined {
  background: #1565c0;
}

.event-content {
  flex: 1;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}

.event-text {
  color: var(--text-primary, #1a1a1a);
  line-height: 1.3;
}

.event-time {
  color: var(--text-muted, #9ca3af);
  font-size: 12px;
  white-space: nowrap;
  flex-shrink: 0;
}
</style>

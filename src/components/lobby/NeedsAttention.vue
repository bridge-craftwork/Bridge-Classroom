<template>
  <div class="needs-attention">
    <div class="panel-header">
      <h3 class="panel-title">Needs Attention</h3>
      <button v-if="items.length" class="clear-btn" @click="$emit('clear')">Clear</button>
    </div>
    <div v-if="!items.length" class="empty-state">
      All caught up! No items need attention.
    </div>
    <div v-else class="attention-list">
      <div
        v-for="(item, i) in items"
        :key="i"
        class="attention-item"
        :class="item.type"
      >
        <span class="item-icon">{{ iconFor(item.type) }}</span>
        <span class="item-text">{{ describeItem(item) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useAnonymizer } from '../../composables/useAnonymizer.js'

defineProps({
  items: { type: Array, default: () => [] }
})

defineEmits(['clear'])

const anon = useAnonymizer()

// The dashboard endpoint sends split names (student_first_name/last_name) so we
// can anonymize consistently with the rosters; fall back to the pre-joined
// student_name if talking to an older backend build.
function studentLabel(item) {
  if (item.student_first_name != null || item.student_last_name != null) {
    return anon.displayFullName({
      first_name: item.student_first_name || '',
      last_name: item.student_last_name || ''
    })
  }
  return item.student_name
}

function iconFor(type) {
  switch (type) {
    case 'due_soon': return '\u23F0' // alarm clock
    case 'low_score': return '\u26A0' // warning
    default: return '\u2022'
  }
}

function describeItem(item) {
  switch (item.type) {
    case 'due_soon': {
      const daysLeft = daysUntil(item.due_at)
      const dayStr = daysLeft <= 1 ? 'tomorrow' : `in ${daysLeft} days`
      return `${item.exercise_name} due ${dayStr} \u2014 ${item.lagging_count} of ${item.total_students} students haven't finished`
    }
    case 'low_score':
      return `${studentLabel(item)} scored ${item.accuracy_pct}% on ${item.exercise_name} in ${item.classroom_name}`
    default:
      return ''
  }
}

function daysUntil(dateStr) {
  if (!dateStr) return 0
  // Parse date-only strings as local dates (not UTC) to avoid off-by-one
  const parts = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const due = parts
    ? new Date(+parts[1], +parts[2] - 1, +parts[3])
    : new Date(dateStr)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.max(0, Math.round((due - today) / (1000 * 60 * 60 * 24)))
}
</script>

<style scoped>
.needs-attention {
  background: white;
  border-radius: var(--radius-card, 10px);
  border: 1px solid var(--card-border, #e0ddd7);
  padding: 20px;
  margin-bottom: 16px;
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

.attention-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.attention-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-button, 6px);
  font-size: 13px;
  line-height: 1.4;
}

.attention-item.due_soon {
  background: #fff8e1;
  border-left: 3px solid #ff9800;
}

.attention-item.low_score {
  background: #fff3f3;
  border-left: 3px solid #ef5350;
}

.item-icon {
  flex-shrink: 0;
  font-size: 14px;
}

.item-text {
  color: var(--text-primary, #1a1a1a);
}
</style>

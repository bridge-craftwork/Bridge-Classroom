<template>
  <div class="stats-row">
    <div class="stat-card" style="border-top-color: #2d6a4f">
      <div class="stat-number">{{ stats?.total_users ?? '—' }}</div>
      <div class="stat-label">Total Users</div>
      <button
        v-if="newUsersLine"
        type="button"
        class="stat-sub"
        :class="{ open: expanded }"
        :aria-expanded="expanded"
        @click="$emit('toggle')"
      >{{ newUsersLine }} <span class="caret" aria-hidden="true">{{ expanded ? '▾' : '▸' }}</span></button>
    </div>
    <div class="stat-card" style="border-top-color: #1565c0">
      <div class="stat-number">{{ stats?.active_7d ?? '—' }}</div>
      <div class="stat-label">Active (7d)</div>
    </div>
    <div class="stat-card" style="border-top-color: #7b1fa2">
      <div class="stat-number">{{ formatNumber(stats?.observation_count_7d) }}</div>
      <div class="stat-label">Observations (7d)</div>
    </div>
    <div class="stat-card" style="border-top-color: #e65100">
      <div class="stat-number">{{ stats?.active_today ?? '—' }}</div>
      <div class="stat-label">Active Today</div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  stats: { type: Object, default: null },
  // Whether the new-users roster (owned by AdminLobby) is expanded — drives the caret.
  expanded: { type: Boolean, default: false }
})
defineEmits(['toggle'])

// Sub-line under Total Users. Shows nothing if no new users this week.
// Shows "N New Today" only when every new user this week registered today;
// otherwise "N New this Week".
const newUsersLine = computed(() => {
  const week = props.stats?.new_users_7d ?? 0
  if (week <= 0) return ''
  const today = props.stats?.new_users_today ?? 0
  if (today > 0 && today === week) {
    return `${today} New Today`
  }
  return `${week} New this Week`
})

function formatNumber(n) {
  if (n == null) return '—'
  return n.toLocaleString()
}
</script>

<style scoped>
.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.stat-card {
  background: white;
  border-radius: var(--radius-card, 10px);
  border: 1px solid var(--card-border, #e0ddd7);
  border-top: 3px solid;
  padding: 20px;
  text-align: center;
}

.stat-number {
  font-family: var(--font-heading, 'Source Serif 4', serif);
  font-size: 32px;
  font-weight: 700;
  color: var(--text-primary, #1a1a1a);
  margin-bottom: 4px;
}

.stat-label {
  font-size: 13px;
  color: var(--text-secondary, #6b7280);
  font-weight: 500;
}

.stat-sub {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  padding: 2px 8px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: none;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  color: #2d6a4f;
  cursor: pointer;
}
.stat-sub:hover { background: rgba(45, 106, 79, 0.08); }
.stat-sub.open { background: rgba(45, 106, 79, 0.12); border-color: rgba(45, 106, 79, 0.25); }
.stat-sub .caret { font-size: 9px; }

@media (max-width: 600px) {
  .stats-row {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>

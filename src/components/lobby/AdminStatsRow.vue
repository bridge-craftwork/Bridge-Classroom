<template>
  <div class="stats-row">
    <div class="stat-card" style="border-top-color: #2d6a4f">
      <div class="stat-number">{{ stats?.total_users ?? '—' }}</div>
      <div class="stat-label">Total Users</div>
      <div v-if="newUsersLine" class="stat-sub" :class="{ 'has-names': newUsersTooltip }" :title="newUsersTooltip">{{ newUsersLine }}</div>
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
  stats: { type: Object, default: null }
})

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

// Native tooltip listing the new users' names (newest first). The backend
// returns the week's names; that set also covers the "New Today" case, since
// that label only shows when every new user this week registered today.
const newUsersTooltip = computed(() => {
  const names = props.stats?.new_users_7d_names
  if (!Array.isArray(names) || names.length === 0) return ''
  return names.join('\n')
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
  margin-top: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #2d6a4f;
}

.stat-sub.has-names {
  cursor: help;
  text-decoration: underline dotted;
  text-underline-offset: 2px;
}

@media (max-width: 600px) {
  .stats-row {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>

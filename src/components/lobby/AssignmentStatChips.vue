<template>
  <div class="stat-chips">
    <!-- Participation -->
    <div class="chip" :title="participationTooltip">
      <span class="chip-label">Participation</span>
      <span class="chip-bar-track">
        <span class="chip-bar-fill" :style="{ width: participationPct + '%' }"></span>
      </span>
      <span class="chip-value">{{ assignment.student_count_attempted }}/{{ assignment.student_count }}</span>
    </div>

    <!-- Clean-correct rate distribution -->
    <div class="chip" :title="cleanRateTooltip">
      <span class="chip-label">Clean rate</span>
      <svg :width="chartWidth" :height="chartHeight" class="chip-chart">
        <line :x1="0" :y1="midY" :x2="chartWidth" :y2="midY" stroke="#e5e7eb" stroke-width="1" />
        <template v-if="cleanRateBox">
          <!-- Whisker -->
          <line :x1="rateX(cleanRateBox.min)" :y1="midY" :x2="rateX(cleanRateBox.max)" :y2="midY" stroke="#6b7280" stroke-width="1" />
          <!-- Whisker caps -->
          <line :x1="rateX(cleanRateBox.min)" :y1="midY - 4" :x2="rateX(cleanRateBox.min)" :y2="midY + 4" stroke="#6b7280" stroke-width="1" />
          <line :x1="rateX(cleanRateBox.max)" :y1="midY - 4" :x2="rateX(cleanRateBox.max)" :y2="midY + 4" stroke="#6b7280" stroke-width="1" />
          <!-- Box -->
          <rect :x="rateX(cleanRateBox.q1)" :y="midY - 5" :width="Math.max(1, rateX(cleanRateBox.q3) - rateX(cleanRateBox.q1))" :height="10" :fill="cleanRateColor.fill" :stroke="cleanRateColor.stroke" stroke-width="1" />
          <!-- Median -->
          <line :x1="rateX(cleanRateBox.median)" :y1="midY - 6" :x2="rateX(cleanRateBox.median)" :y2="midY + 6" stroke="#2d6a4f" stroke-width="2" />
        </template>
        <text v-else :x="chartWidth / 2" :y="midY + 4" text-anchor="middle" font-size="10" fill="#9ca3af">no data</text>
      </svg>
      <span class="chip-value">{{ cleanRateMedianLabel }}</span>
    </div>

    <!-- Active duration distribution -->
    <div class="chip" :title="durationTooltip">
      <span class="chip-label">Duration</span>
      <svg :width="chartWidth" :height="chartHeight" class="chip-chart">
        <line :x1="0" :y1="midY" :x2="chartWidth" :y2="midY" stroke="#e5e7eb" stroke-width="1" />
        <template v-if="durationBox">
          <line :x1="durX(durationBox.min)" :y1="midY" :x2="durX(durationBox.max)" :y2="midY" stroke="#6b7280" stroke-width="1" />
          <line :x1="durX(durationBox.min)" :y1="midY - 4" :x2="durX(durationBox.min)" :y2="midY + 4" stroke="#6b7280" stroke-width="1" />
          <line :x1="durX(durationBox.max)" :y1="midY - 4" :x2="durX(durationBox.max)" :y2="midY + 4" stroke="#6b7280" stroke-width="1" />
          <rect :x="durX(durationBox.q1)" :y="midY - 5" :width="Math.max(1, durX(durationBox.q3) - durX(durationBox.q1))" :height="10" :fill="durationColor.fill" :stroke="durationColor.stroke" stroke-width="1" />
          <line :x1="durX(durationBox.median)" :y1="midY - 6" :x2="durX(durationBox.median)" :y2="midY + 6" stroke="#1d4f80" stroke-width="2" />
        </template>
        <text v-else :x="chartWidth / 2" :y="midY + 4" text-anchor="middle" font-size="10" fill="#9ca3af">no data</text>
      </svg>
      <span class="chip-value">{{ durationMedianLabel }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { formatDurationMs } from '../../utils/formatDuration.js'

const props = defineProps({
  assignment: { type: Object, required: true },
})

const chartWidth = 90
const chartHeight = 18
const midY = chartHeight / 2

// Linear interpolation for sorted-array quantiles. Standard R-7 method.
function quantile(sorted, q) {
  if (!sorted.length) return null
  if (sorted.length === 1) return sorted[0]
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos), hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

function boxStats(sorted) {
  if (!sorted || sorted.length === 0) return null
  return {
    min: sorted[0],
    q1: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    q3: quantile(sorted, 0.75),
    max: sorted[sorted.length - 1],
    count: sorted.length,
  }
}

const participationPct = computed(() => {
  const a = props.assignment
  if (!a.student_count) return 0
  return Math.round((a.student_count_attempted / a.student_count) * 100)
})

const participationTooltip = computed(() => {
  const a = props.assignment
  return `${a.student_count_attempted} of ${a.student_count} student${a.student_count === 1 ? '' : 's'} have played at least one board (${participationPct.value}%)`
})

// Red / yellow / green fills for "how good is this box" at a glance.
const GOODNESS = {
  good:    { fill: '#a7d4b9', stroke: '#40916c' },
  ok:      { fill: '#fbe0b8', stroke: '#d97706' },
  bad:     { fill: '#f6c6ca', stroke: '#e5484d' },
  neutral: { fill: '#e5e7eb', stroke: '#9ca3af' },
}

const cleanRateBox = computed(() => boxStats(props.assignment.clean_rates))

// Clean rate: higher is better. Thresholds mirror the per-student accuracy
// classes (≥75% green, ≥50% amber, else red), keyed off the median.
const cleanRateColor = computed(() => {
  const box = cleanRateBox.value
  if (!box) return GOODNESS.neutral
  if (box.median >= 0.75) return GOODNESS.good
  if (box.median >= 0.50) return GOODNESS.ok
  return GOODNESS.bad
})

const cleanRateMedianLabel = computed(() => {
  const box = cleanRateBox.value
  if (!box) return '—'
  return Math.round(box.median * 100) + '%'
})

const cleanRateTooltip = computed(() => {
  const box = cleanRateBox.value
  if (!box) return 'Per-student clean-correct rate (no plays yet)'
  return `Clean-correct boards ÷ attempted boards, per student (n=${box.count}). ` +
         `min ${Math.round(box.min * 100)}% · Q1 ${Math.round(box.q1 * 100)}% · ` +
         `median ${Math.round(box.median * 100)}% · Q3 ${Math.round(box.q3 * 100)}% · ` +
         `max ${Math.round(box.max * 100)}%`
})

// Rate axis is fixed 0..1 (0..100%)
function rateX(v) {
  return v * chartWidth
}

const durationBox = computed(() => boxStats(props.assignment.active_durations_ms))

// Duration goodness is anchored on the ~15-minute homework design target
// (median of the ≥80%-completers): ≤15 min green, ≤30 min amber, longer red.
// Tunable — bump if your assignments are intentionally longer.
const DURATION_GOOD_MS = 15 * 60_000
const DURATION_OK_MS = 30 * 60_000
const durationColor = computed(() => {
  const box = durationBox.value
  if (!box) return GOODNESS.neutral
  if (box.median <= DURATION_GOOD_MS) return GOODNESS.good
  if (box.median <= DURATION_OK_MS) return GOODNESS.ok
  return GOODNESS.bad
})

// Duration axis scales to the longest student's duration (rounded up to
// a clean upper bound so the boxplot is readable). All in ms.
const durationMaxMs = computed(() => {
  const b = durationBox.value
  if (!b) return 1
  const max = b.max || 1
  if (max < 60_000) return 60_000       // < 1 min → 1 min
  if (max < 300_000) return 300_000     // < 5 min → 5 min
  if (max < 600_000) return 600_000     // < 10 min → 10 min
  if (max < 1_800_000) return 1_800_000 // < 30 min → 30 min
  if (max < 3_600_000) return 3_600_000 // < 1 hr → 1 hr
  return Math.ceil(max / 1_800_000) * 1_800_000
})

function durX(v) {
  return (v / durationMaxMs.value) * chartWidth
}

const durationMedianLabel = computed(() => {
  const box = durationBox.value
  if (!box) return '—'
  return formatDurationMs(box.median)
})

const durationTooltip = computed(() => {
  const box = durationBox.value
  if (!box) return 'Per-student active time (no plays yet)'
  return `Per-student active time on the assignment (n=${box.count}). ` +
         `min ${formatDurationMs(box.min)} · Q1 ${formatDurationMs(box.q1)} · ` +
         `median ${formatDurationMs(box.median)} · Q3 ${formatDurationMs(box.q3)} · ` +
         `max ${formatDurationMs(box.max)}. Axis max ${formatDurationMs(durationMaxMs.value)}.`
})
</script>

<style scoped>
.stat-chips {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  align-items: center;
  margin-top: 6px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-secondary, #6b7280);
  white-space: nowrap;
}

.chip-label {
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 500;
  color: var(--text-muted, #9ca3af);
}

.chip-bar-track {
  display: inline-block;
  width: 90px;
  height: 8px;
  background: #f3f4f6;
  border-radius: 4px;
  overflow: hidden;
  position: relative;
}

.chip-bar-fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--green-mid, #40916c);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.chip-chart {
  display: block;
}

.chip-value {
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  color: var(--text-primary, #1a1a1a);
  min-width: 32px;
  text-align: right;
}
</style>

<template>
  <div class="details-overlay" @click.self="$emit('close')">
    <div class="details-panel" @click.stop>
      <!-- Header -->
      <div class="details-header">
        <div>
          <h2 class="details-title">{{ lesson.name }}</h2>
          <p class="details-subtitle">
            {{ lesson.tried }} boards &middot; {{ lesson.totalAttempts }} attempts
          </p>
        </div>
        <button class="details-close-btn" @click="$emit('close')">&#10005; close</button>
      </div>

      <!-- Scatterplot chart -->
      <svg :viewBox="`0 0 ${svgW} ${svgH}`" width="100%" :height="svgH" class="details-chart">
        <!-- Alternating row backgrounds -->
        <rect
          v-for="(dn, i) in boardNums" :key="'bg-' + dn"
          :x="PAD.l" :y="PAD.t + i * BOARD_H"
          :width="CHART_W" :height="BOARD_H"
          :fill="i % 2 === 0 ? '#ffffff' : '#f9fafb'"
        />

        <!-- Board labels on Y axis, with star (\u00a76) and paw (\u00a77) badges -->
        <g v-for="(dn, i) in boardNums" :key="'label-' + dn">
          <rect
            :x="2" :y="PAD.t + i * BOARD_H + 3"
            :width="Y_LABEL_W - 14" :height="BOARD_H - 6"
            rx="3"
            :fill="boardLabelColor(dn)"
            :fill-opacity="hasBoardData(dn) ? 0.12 : 0.05"
          />
          <!-- Star badge (max_stars \u2265 1) -->
          <text
            v-if="starColor(dn)"
            :x="8"
            :y="PAD.t + i * BOARD_H + BOARD_H / 2 + 5"
            font-size="14"
            :fill="starColor(dn)"
            style="font-family: serif"
          >
            &#9733;
            <title>{{ badgeTooltip(dn) }}</title>
          </text>
          <!-- Paw badge (wild_achievement) -->
          <circle
            v-if="pawColor(dn)"
            :cx="22"
            :cy="PAD.t + i * BOARD_H + BOARD_H / 2"
            r="4"
            :fill="pawColor(dn)"
            stroke="#fff" stroke-width="1"
          >
            <title>{{ badgeTooltip(dn) }}</title>
          </circle>
          <text
            :x="Y_LABEL_W - 16"
            :y="PAD.t + i * BOARD_H + BOARD_H / 2 + 4"
            text-anchor="end" font-size="13"
            :fill="boardLabelColor(dn)"
            font-family="monospace"
          >
            Board {{ dn }}{{ hasBoardData(dn) ? '' : ' \u2014' }}
          </text>
        </g>

        <!-- Vertical grid lines -->
        <line
          v-for="(t, i) in ticks" :key="'grid-' + i"
          :x1="t.x" :y1="PAD.t" :x2="t.x" :y2="PAD.t + chartH"
          stroke="#e5e7eb" stroke-width="1"
          :stroke-dasharray="(i === 0 || i === ticks.length - 1) ? 'none' : '3,4'"
        />

        <!-- X axis labels -->
        <text
          v-for="(t, i) in ticks" :key="'tick-' + i"
          :x="t.x" :y="PAD.t + chartH + 14"
          text-anchor="middle" font-size="9"
          fill="#6b7280" font-family="monospace"
        >
          {{ t.label }}
        </text>

        <!-- Dots — render in y order so green draws on top -->
        <circle
          v-for="(p, i) in sortedDots" :key="'dot-' + i"
          :cx="p.px" :cy="p.py"
          :r="DOT_R"
          :fill="dotColor(p.y)"
          stroke="#fff" stroke-width="1.5"
          opacity="0.92"
          class="obs-dot"
          @click.stop="emit('dot-click', { rawTs: p.rawTs, dealNum: p.dealNum, correct: p.correct, event: $event })"
        >
          <title>Board {{ p.dealNum }} &middot; {{ p.correct ? 'Correct' : 'Incorrect' }} &middot; {{ formatTime(p.rawTs) }}</title>
        </circle>
      </svg>

      <!-- Stats + Activity bar chart -->
      <div v-if="activityData" class="details-activity">
        <div class="stats-row">
          <div class="stat-item" v-for="s in statsItems" :key="s.label">
            <div class="stat-value">{{ s.value }}</div>
            <div class="stat-label">{{ s.label }}</div>
          </div>
        </div>
        <svg width="100%" :viewBox="`0 0 ${activityData.barW} ${ACTIVITY_BAR_H}`" class="activity-chart">
          <rect
            v-for="bar in activityData.bars" :key="bar.dayKey"
            :x="bar.x" :y="ACTIVITY_BAR_H - bar.h"
            :width="bar.w" :height="bar.h"
            fill="#3b82f6" opacity="0.7" rx="1"
          >
            <title>{{ bar.dateLabel }}: {{ bar.count }} observations</title>
          </rect>
        </svg>
        <div class="activity-dates">
          <span>{{ activityData.firstLabel }}</span>
          <span>{{ activityData.lastLabel }}</span>
        </div>
      </div>

      <!-- Legend -->
      <div class="details-legend">
        <span v-for="l in legend" :key="l.label" class="legend-item">
          <span class="legend-dot" :style="{ backgroundColor: l.color }"></span>
          {{ l.label }}
        </span>
      </div>
      <div v-if="badgeLegend.length" class="details-legend badge-legend">
        <span v-for="l in badgeLegend" :key="l.label" class="legend-item">
          <span
            v-if="l.kind === 'star'"
            class="legend-star"
            :style="{ color: l.color }"
          >&#9733;</span>
          <span
            v-else
            class="legend-dot legend-paw"
            :style="{ backgroundColor: l.color }"
          ></span>
          {{ l.label }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { yColor as dotColor, STATUS_COLORS } from '../utils/studentProgressData.js'

const props = defineProps({
  lesson: { type: Object, required: true },
  rawData: { type: Array, required: true },
})

const emit = defineEmits(['close', 'dot-click'])

const DOT_R = 7
const OVERLAP = 0.30
const Y_LABEL_W = 110
const PAD = { t: 16, r: 20, b: 40, l: Y_LABEL_W }
const CHART_W = 560
const BOARD_H = 28
const ACTIVITY_BAR_H = 40
const ONE_HOUR = 3600000
const DAY = 86400000

const boardNums = computed(() => {
  const attemptedNums = new Set(props.lesson.boardLines.map(bl => bl.dealNum))
  const total = props.lesson.totalBoards ?? Math.max(...attemptedNums)
  return Array.from({ length: total }, (_, i) => i + 1)
})

const chartH = computed(() => boardNums.value.length * BOARD_H)
const svgW = computed(() => CHART_W + PAD.l + PAD.r)
const svgH = computed(() => chartH.value + PAD.t + PAD.b)

const attemptedSet = computed(() => new Set(props.lesson.boardLines.map(bl => bl.dealNum)))

function hasBoardData(dn) {
  return attemptedSet.value.has(dn)
}

function boardLabelColor(dn) {
  const bl = props.lesson.boardLines.find(b => b.dealNum === dn)
  if (!bl) return '#d1d5db'
  return STATUS_COLORS[bl.status] || '#6b7280'
}

// Star badge color per CORRECTNESS_AND_MASTERY.md §6.4: silver at
// max_stars = 1, gold at max_stars ≥ 2. Returns null when no badge.
function starColor(dn) {
  const bl = props.lesson.boardLines.find(b => b.dealNum === dn)
  if (!bl || !bl.maxStars) return null
  return bl.maxStars >= 2 ? '#d4a900' : '#9ca3af'
}

// Paw badge color per §7.1: yellow for Recent (any other obs within
// the 6-day spacing window before the wild clean_correct), green for
// Fresh (cold board at time of the wild clean_correct).
function pawColor(dn) {
  const bl = props.lesson.boardLines.find(b => b.dealNum === dn)
  if (!bl || !bl.wildAchievement) return null
  return bl.wildAchievement === 'Fresh' ? '#10b981' : '#f5cd47'
}

function badgeTooltip(dn) {
  const bl = props.lesson.boardLines.find(b => b.dealNum === dn)
  if (!bl) return ''
  const parts = []
  if (bl.maxStars === 1) parts.push('Silver star')
  if (bl.maxStars >= 2) parts.push('Gold star')
  if (bl.wildAchievement === 'Recent') parts.push('Recent paw')
  if (bl.wildAchievement === 'Fresh') parts.push('Fresh paw')
  return parts.join(' · ')
}

// Build positioned dots with collision spreading
const positionedDots = computed(() => {
  const lessonRaw = props.rawData.filter(r => r.skill_path === props.lesson.path)
  const nums = boardNums.value

  const allPts = lessonRaw.map(r => {
    const ts = new Date(r.timestamp).getTime()
    const dealNum = r.deal_number
    const boardIdx = nums.indexOf(dealNum)
    return { rawTs: ts, dealNum, boardIdx, correct: r.correct, board_result: r.board_result, y: r.correct ? 1.0 : 0.0 }
  })

  // Refine y values using board_result (preferred) with heuristic fallback
  const byDeal = {}
  allPts.forEach(pt => {
    if (!byDeal[pt.dealNum]) byDeal[pt.dealNum] = []
    byDeal[pt.dealNum].push(pt)
  })
  for (const dealPts of Object.values(byDeal)) {
    dealPts.sort((a, b) => a.rawTs - b.rawTs)
    dealPts.forEach((pt, i) => {
      if (pt.board_result === 'corrected') { pt.y = 0.5; return }
      if (pt.board_result === 'failed') { pt.y = 0.0; return }

      if (pt.correct) {
        const recentFail = dealPts.slice(0, i).reverse()
          .find(p => (p.board_result ? p.board_result !== 'correct' : !p.correct) && (pt.rawTs - p.rawTs) < ONE_HOUR)
        pt.y = recentFail ? 0.75 : 1.0
      } else {
        const nextSuccess = dealPts.slice(i + 1)
          .find(p => p.correct && (p.rawTs - pt.rawTs) < ONE_HOUR)
        pt.y = nextSuccess ? 0.5 : 0.0
      }
    })
  }

  if (allPts.length === 0) return []

  // X range padded to day boundaries
  const allX = allPts.map(p => p.rawTs)
  const xMin = Math.min(...allX)
  const xMaxRaw = Math.max(...allX)
  const xMinPadded = Math.floor(xMin / DAY) * DAY
  const xMax = (Math.floor(xMaxRaw / DAY) + 1) * DAY - 1
  const xRange = xMax - xMinPadded || 1

  const toX = (p) => PAD.l + (p.rawTs - xMinPadded) / xRange * CHART_W
  const toY = (boardIdx) => PAD.t + boardIdx * BOARD_H + BOARD_H / 2

  const STEP = DOT_R * 2 * (1 - OVERLAP)
  const V_STEP = DOT_R * 2 * (1 - OVERLAP)

  const pts = allPts.map(p => ({ ...p, px: toX(p), py: toY(p.boardIdx) }))

  // PASS 1: Vertical nudge for same-time duplicates
  nums.forEach(dn => {
    const rowPts = pts.filter(p => p.dealNum === dn)
    const tsGroups = {}
    rowPts.forEach(pt => {
      const key = pt.rawTs
      if (!tsGroups[key]) tsGroups[key] = []
      tsGroups[key].push(pt)
    })
    Object.values(tsGroups).forEach(grp => {
      if (grp.length < 2) return
      const basePy = grp[0].py
      grp.forEach((pt, i) => {
        pt.py = basePy + (i - (grp.length - 1) / 2) * V_STEP
      })
    })
  })

  // PASS 2: Horizontal spread for overlapping clusters
  nums.forEach(dn => {
    const rowPts = pts.filter(p => p.dealNum === dn).sort((a, b) => a.px - b.px)
    const clusters = []
    let i = 0
    while (i < rowPts.length) {
      let j = i
      while (j + 1 < rowPts.length && rowPts[j + 1].px - rowPts[i].px < STEP) j++
      clusters.push({ start: i, end: j })
      i = j + 1
    }
    clusters.forEach((cl, clIdx) => {
      const count = cl.end - cl.start + 1
      if (count === 1) return
      const totalW = (count - 1) * STEP
      let anchorLeft
      if (clIdx === 0) {
        anchorLeft = rowPts[cl.start].px
      } else if (clIdx === clusters.length - 1) {
        anchorLeft = rowPts[cl.end].px - totalW
      } else {
        anchorLeft = (rowPts[cl.start].px + rowPts[cl.end].px) / 2 - totalW / 2
      }
      for (let k = 0; k < count; k++) {
        rowPts[cl.start + k].px = anchorLeft + k * STEP
      }
    })
  })

  return pts
})

const sortedDots = computed(() => {
  return [...positionedDots.value].sort((a, b) => a.y - b.y)
})

// X-axis ticks
const ticks = computed(() => {
  const pts = positionedDots.value
  if (pts.length === 0) return []

  const allX = pts.map(p => p.rawTs)
  const xMin = Math.min(...allX)
  const xMaxRaw = Math.max(...allX)
  const xMinPadded = Math.floor(xMin / DAY) * DAY
  const xMax = (Math.floor(xMaxRaw / DAY) + 1) * DAY - 1
  const xRange = xMax - xMinPadded || 1

  const tickCount = 5
  return Array.from({ length: tickCount }, (_, i) => {
    const frac = i / (tickCount - 1)
    const ts = new Date(xMinPadded + frac * xRange)
    return {
      x: PAD.l + frac * CHART_W,
      label: ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
             ' ' + ts.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
    }
  })
})

// Activity bar chart data
const activityData = computed(() => {
  const pts = positionedDots.value
  if (pts.length === 0) return null

  const dayBuckets = {}
  pts.forEach(p => {
    const dayKey = Math.floor(p.rawTs / DAY)
    dayBuckets[dayKey] = (dayBuckets[dayKey] || 0) + 1
  })
  const dayKeys = Object.keys(dayBuckets).map(Number).sort()
  if (dayKeys.length === 0) return null

  const firstDay = dayKeys[0]
  const lastDay = dayKeys[dayKeys.length - 1]
  const spanDays = lastDay - firstDay + 1
  const maxCount = Math.max(...Object.values(dayBuckets))
  const barWidth = Math.max(2, (CHART_W / spanDays) - 1)

  const bars = dayKeys.map(dk => ({
    dayKey: dk,
    x: ((dk - firstDay) / spanDays) * CHART_W,
    h: (dayBuckets[dk] / maxCount) * ACTIVITY_BAR_H,
    w: barWidth,
    count: dayBuckets[dk],
    dateLabel: new Date(dk * DAY).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }))

  return {
    bars,
    barW: CHART_W,
    firstLabel: new Date(firstDay * DAY).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    lastLabel: new Date(lastDay * DAY).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }
})

const statsItems = computed(() => {
  const pts = positionedDots.value
  const dayBuckets = {}
  pts.forEach(p => {
    const dayKey = Math.floor(p.rawTs / DAY)
    dayBuckets[dayKey] = true
  })
  return [
    { label: 'Days active', value: Object.keys(dayBuckets).length },
    { label: 'Boards tried', value: props.lesson.tried },
    { label: 'Observations', value: pts.length },
  ]
})

const legend = [
  { color: '#10b981', label: 'Clean correct' },
  { color: '#f59e0b', label: 'Corrected / close (errors fixed or recent prior fail)' },
  { color: '#f43f5e', label: 'Failed (uncorrected)' },
]

// Badge legend — only shown when at least one board has a star or paw.
const badgeLegend = computed(() => {
  const items = []
  const hasSilver = props.lesson.boardLines.some(b => b.maxStars === 1)
  const hasGold = props.lesson.boardLines.some(b => b.maxStars >= 2)
  const hasRecentPaw = props.lesson.boardLines.some(b => b.wildAchievement === 'Recent')
  const hasFreshPaw = props.lesson.boardLines.some(b => b.wildAchievement === 'Fresh')
  if (hasSilver) items.push({ kind: 'star', color: '#9ca3af', label: 'Silver star' })
  if (hasGold)   items.push({ kind: 'star', color: '#d4a900', label: 'Gold star' })
  if (hasRecentPaw) items.push({ kind: 'paw', color: '#f5cd47', label: 'Recent paw' })
  if (hasFreshPaw)  items.push({ kind: 'paw', color: '#10b981', label: 'Fresh paw' })
  return items
})

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}
</script>

<style scoped>
.details-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
  padding: 20px;
}

.details-panel {
  background: white;
  border: 1px solid var(--card-border, #e0ddd7);
  border-radius: 16px;
  padding: 24px 24px 20px;
  max-width: 740px;
  width: 95vw;
  max-height: 90vh;
  overflow: auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
}

.details-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
}

.details-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary, #1a1a1a);
}

.details-subtitle {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
}

.details-close-btn {
  background: none;
  border: 1px solid var(--card-border, #e0ddd7);
  color: var(--text-secondary, #6b7280);
  border-radius: 8px;
  padding: 4px 12px;
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
}

.details-close-btn:hover {
  border-color: #999;
  color: var(--text-primary, #1a1a1a);
}

.details-chart {
  display: block;
}

.obs-dot {
  cursor: pointer;
  transition: opacity 0.15s;
}

.obs-dot:hover {
  opacity: 1 !important;
  filter: brightness(1.1);
}

.details-activity {
  margin-top: 16px;
  margin-bottom: 8px;
}

.stats-row {
  display: flex;
  gap: 24px;
  margin-bottom: 10px;
}

.stat-item {
  text-align: center;
}

.stat-value {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary, #1a1a1a);
}

.stat-label {
  font-size: 10px;
  color: var(--text-secondary, #6b7280);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.activity-chart {
  display: block;
}

.activity-dates {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--text-secondary, #6b7280);
  margin-top: 2px;
}

.details-legend {
  display: flex;
  gap: 14px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-secondary, #6b7280);
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}

.legend-star {
  font-size: 16px;
  line-height: 1;
  font-family: serif;
}

.badge-legend {
  margin-top: 6px;
}
</style>

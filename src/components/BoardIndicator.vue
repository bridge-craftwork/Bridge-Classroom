<template>
  <!-- Board indicator (documentation/design/board-indicator-spec.md): a truncated
       pyramid seen from above — a raised plateau with the board number, four sloped
       bevel faces shaded under an upper-left light, vulnerability by face colour
       (red = vul), the dealer letter on the dealer's face. Optional flag border in a
       reserved slot. Pure presentational; deterministic from props. -->
  <svg :width="extent" :height="extent" :viewBox="viewBox" role="img" :aria-label="ariaLabel">
    <!-- Flag border first (bottom of stack); the slot is always reserved. -->
    <rect :x="borderXY" :y="borderXY" :width="borderWH" :height="borderWH" fill="none" :stroke="borderColor" :stroke-width="borderW" />
    <!-- Four faces -->
    <polygon v-for="f in ['top', 'right', 'bottom', 'left']" :key="f"
             :points="faces[f].points" :fill="faces[f].fill"
             :stroke="seamW ? faces[f].seam : 'none'" :stroke-width="seamW" />
    <!-- Plateau + board number -->
    <rect :x="b" :y="b" :width="S - 2 * b" :height="S - 2 * b" fill="#FBFAF5" stroke="#9B9588" :stroke-width="plateauW" />
    <text :x="0.5 * S" :y="numBaseline" text-anchor="middle" :font-size="numFont" font-weight="500" fill="#222018">{{ n }}</text>
    <!-- Dealer D, upright on the dealer's face -->
    <text :x="dealerPos.x" :y="dealerPos.y" text-anchor="middle" :font-size="dFont" font-weight="500" :fill="dealerInk">D</text>
  </svg>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  boardNumber: { type: [Number, String], required: true },
  size: { type: Number, default: 130 },        // edge length S of the pyramid footprint
  borderColor: { type: String, default: 'transparent' },
  // Non-standard boards carry their own dealer/vulnerability (a practice deal may
  // be "board 7" yet be dealt by North with NS vul). These override the derived
  // 16-cycle values (§4); leave unset to fall back to the standard cycle.
  dealer: { type: String, default: null },        // 'N' | 'E' | 'S' | 'W'
  vulnerable: { type: String, default: null },    // 'None' | 'NS' | 'EW' | 'All'
})

const S = computed(() => props.size)
const b = computed(() => 0.23 * S.value)        // bevel depth
const n = computed(() => parseInt(props.boardNumber, 10) || 1)

// §4 — standard duplicate 16-board cycle. Explicit dealer/vulnerable props
// override the cycle (non-standard boards); an unrecognised value falls through
// to the derived value rather than rendering something wrong.
const i = computed(() => (n.value - 1) % 16)
const DEALERS = ['N', 'E', 'S', 'W']
const derivedDealer = computed(() => DEALERS[i.value % 4])
const dealer = computed(() => {
  const d = (props.dealer || '').trim().toUpperCase()
  return DEALERS.includes(d) ? d : derivedDealer.value
})
const derivedVulCode = computed(() => (i.value + Math.floor(i.value / 4)) % 4) // 0 None · 1 NS · 2 EW · 3 All
const VUL_CODES = { NONE: 0, LOVE: 0, '-': 0, NS: 1, EW: 2, ALL: 3, BOTH: 3 }
const vulCode = computed(() => {
  const v = (props.vulnerable || '').trim().toUpperCase()
  return v in VUL_CODES ? VUL_CODES[v] : derivedVulCode.value
})
const red = computed(() => ({
  top: vulCode.value === 1 || vulCode.value === 3,
  bottom: vulCode.value === 1 || vulCode.value === 3,
  left: vulCode.value === 2 || vulCode.value === 3,
  right: vulCode.value === 2 || vulCode.value === 3,
}))

// §6 — per-face shades (fixed hex; never theme-routed — depicts a physical object).
const SHADE = {
  red: { top: '#DA5A50', left: '#C64840', right: '#A6332B', bottom: '#8A2822', seam: '#7A201B' },
  ivory: { top: '#FFFFFF', left: '#F0ECE1', right: '#DBD5C7', bottom: '#C2BCAB', seam: '#ABA595' },
}
const seamW = computed(() => (S.value < 64 ? 0 : Math.max(0.5, 0.004 * S.value))) // omit seams < 64px (§9)
const plateauW = computed(() => Math.max(1, 0.008 * S.value))

// §5 — geometry, all derived from S.
const faces = computed(() => {
  const s = S.value, bb = b.value
  const face = (name, points) => ({ points, fill: (red.value[name] ? SHADE.red : SHADE.ivory)[name], seam: (red.value[name] ? SHADE.red : SHADE.ivory).seam })
  return {
    top: face('top', `0,0 ${s},0 ${s - bb},${bb} ${bb},${bb}`),
    right: face('right', `${s},0 ${s},${s} ${s - bb},${s - bb} ${s - bb},${bb}`),
    bottom: face('bottom', `0,${s} ${s},${s} ${s - bb},${s - bb} ${bb},${s - bb}`),
    left: face('left', `0,0 ${bb},${bb} ${bb},${s - bb} 0,${s}`),
  }
})

// Board number typography (§6).
const numFont = computed(() => (String(n.value).length >= 3 ? 0.22 : 0.28) * S.value)
const numBaseline = computed(() => 0.5 * S.value + 0.35 * numFont.value)

// Dealer letter (§6). Upright, on the dealer's face; ink flips on face colour.
const dFont = computed(() => 0.20 * S.value)
const dealerFace = computed(() => ({ N: 'top', E: 'right', S: 'bottom', W: 'left' }[dealer.value]))
const dealerPos = computed(() => {
  const s = S.value, bb = b.value
  const c = { N: { x: 0.5 * s, y: bb / 2 }, E: { x: s - bb / 2, y: 0.5 * s }, S: { x: 0.5 * s, y: s - bb / 2 }, W: { x: bb / 2, y: 0.5 * s } }[dealer.value]
  return { x: c.x, y: c.y + 0.35 * dFont.value }
})
const dealerInk = computed(() => (red.value[dealerFace.value] ? '#FFEDEA' : '#443F35'))

// §7 — flag border + reserved slot.
const borderW = computed(() => 0.031 * S.value)
const gap = computed(() => 0.038 * S.value)
const slot = computed(() => gap.value + borderW.value)
const borderXY = computed(() => -(gap.value + borderW.value / 2))
const borderWH = computed(() => S.value + 2 * (gap.value + borderW.value / 2))
const extent = computed(() => S.value + 2 * slot.value)
const viewBox = computed(() => `${-slot.value} ${-slot.value} ${extent.value} ${extent.value}`)

// §8 — accessibility.
const ariaLabel = computed(() => {
  const dealerName = { N: 'North', E: 'East', S: 'South', W: 'West' }[dealer.value]
  const vul = ['not vulnerable', 'North-South vulnerable', 'East-West vulnerable', 'all vulnerable'][vulCode.value]
  const flagged = props.borderColor && props.borderColor !== 'transparent' ? ', flagged' : ''
  return `Board ${n.value}, dealer ${dealerName}, ${vul}${flagged}`
})
</script>

<style scoped>
svg text { font-family: 'DM Sans', system-ui, sans-serif; }
</style>

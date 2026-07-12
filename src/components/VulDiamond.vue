<template>
  <!-- BBO / IntoBridge board glyph (grid-arranger-spec §1 "vul-diamond"): a center
       square carrying the board number, with four side pieces at N/E/S/W. A side
       piece turns RED when that pair is vulnerable (N+S for NS, E+W for EW); a "D"
       badge marks the dealer's side. One compact glyph for board · dealer · vul,
       replacing the pill stack. Sizes off --table-scale. -->
  <svg class="vul-diamond" :class="'scale-' + sizeClass" viewBox="0 0 100 100" role="img" :aria-label="ariaLabel">
    <!-- Four side pieces (plus/cross around the hub) -->
    <rect x="38" y="7"  width="24" height="19" rx="2" :class="tabClass('N')" />
    <rect x="74" y="38" width="19" height="24" rx="2" :class="tabClass('E')" />
    <rect x="38" y="74" width="24" height="19" rx="2" :class="tabClass('S')" />
    <rect x="7"  y="38" width="19" height="24" rx="2" :class="tabClass('W')" />
    <!-- Center square: the board number -->
    <rect x="30" y="30" width="40" height="40" rx="4" class="hub" />
    <text x="50" y="51" class="board">{{ board ?? '—' }}</text>
    <!-- Dealer "D" badge on the dealer's side -->
    <g v-if="dealerBadge" :transform="`translate(${dealerBadge.x} ${dealerBadge.y})`">
      <circle r="9" class="dbadge" />
      <text class="dtext" y="1">D</text>
    </g>
  </svg>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  board: { type: [Number, String], default: null },
  dealer: { type: String, default: null },   // 'N' | 'E' | 'S' | 'W'
  vul: { type: String, default: 'None' },     // 'None' | 'NS' | 'EW' | 'All'/'Both'
  sizeClass: { type: String, default: 'md' }, // 'sm' (chip) | 'md'
})

const vulNS = computed(() => ['NS', 'All', 'Both'].includes(props.vul))
const vulEW = computed(() => ['EW', 'All', 'Both'].includes(props.vul))
function tabClass(seat) {
  const red = (seat === 'N' || seat === 'S') ? vulNS.value : vulEW.value
  return red ? 'tab vul' : 'tab'
}
// Dealer badge sits just outside the dealer's side piece.
const dealerBadge = computed(() => {
  const pos = { N: { x: 50, y: 7 }, E: { x: 93, y: 50 }, S: { x: 50, y: 93 }, W: { x: 7, y: 50 } }
  return props.dealer ? pos[props.dealer] : null
})
const ariaLabel = computed(() =>
  `Board ${props.board ?? '?'}, dealer ${props.dealer ?? '?'}, ${props.vul === 'None' ? 'none' : props.vul} vulnerable`)
</script>

<style scoped>
.vul-diamond {
  width: calc(52px * var(--table-scale));
  height: calc(52px * var(--table-scale));
  display: block;
}
.vul-diamond.scale-sm { width: calc(38px * var(--table-scale)); height: calc(38px * var(--table-scale)); }
.tab { fill: #fff; stroke: #b9c0bb; stroke-width: 1.5; }
.tab.vul { fill: #e2433a; stroke: #c22c24; }
.hub { fill: #fff; stroke: #9aa39a; stroke-width: 1.5; }
.board { font: 700 26px 'Segoe UI', system-ui, sans-serif; fill: #1a2420; text-anchor: middle; dominant-baseline: central; }
.dbadge { fill: #33403a; }
.dtext { font: 700 11px 'Segoe UI', system-ui, sans-serif; fill: #fff; text-anchor: middle; dominant-baseline: central; }
</style>

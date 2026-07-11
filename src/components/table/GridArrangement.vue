<template>
  <!-- The real 3×3 named-area grid arranger (grid-arranger-spec.md). Seats are
       ALWAYS occupied (chip minimum) so the grid never reflows; corners are
       first-class areas, not overlays. Each region publishes a computed
       `--region-scale` (the §3 clamp) applied locally as `--table-scale` so the
       leaves render at that scale, plus a `data-region-scale` attribute for the
       gallery captions. Legacy BridgeTable is untouched — this is the `grid`
       branch, dark until the A1 flip. -->
  <div ref="root" class="grid-table" :style="gridStyle">
    <!-- Four seats, placed by rotation; every seat area is filled. -->
    <div
      v-for="seat in SEATS"
      :key="seat"
      class="region seat"
      :class="'area-' + seatArea(seat)"
      :style="regionStyle('seats')"
      :data-region="'seat-' + seatArea(seat)"
      :data-region-scale="fmt(scales.seats)"
    >
      <SeatPanel
        :hand="hands[seat]"
        :seat="seat"
        :show-hcp="showHcp"
        :clickable="clickableSeat === seat"
        :density="seatDensity(seat)"
        :marks="marksFor(seat)"
        :hide-played-cards="hidePlayedCards"
        @card-click="(p) => $emit('card-click', { seat, ...p })"
      />
    </div>

    <!-- center + peripheral regions: shell-provided content, scaled per region. -->
    <div class="region area-center" :style="regionStyle('center')" data-region="center" :data-region-scale="fmt(scales.center)">
      <slot name="center" />
    </div>
    <div v-if="hasRegion('nw')" class="region area-nw" :style="regionStyle('nw')" data-region="nw" :data-region-scale="fmt(scales.nw)"><slot name="nw" /></div>
    <div v-if="hasRegion('ne')" class="region area-ne" :style="regionStyle('ne')" data-region="ne" :data-region-scale="fmt(scales.ne)"><slot name="ne" /></div>
    <div v-if="hasRegion('se')" class="region area-se" :style="regionStyle('se')" data-region="se" :data-region-scale="fmt(scales.se)"><slot name="se" /></div>
    <div v-if="hasRegion('sw')" class="region area-sw" :style="regionStyle('sw')" data-region="sw" :data-region-scale="fmt(scales.sw)"><slot name="sw" /></div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import SeatPanel from '../SeatPanel.vue'
import { seatToArea, anchorFor, computeRegionScale, uniformSeatScale, rowReservePx } from '../../utils/gridArranger.js'

const props = defineProps({
  hands: { type: Object, required: true },
  hiddenSeats: { type: Array, default: () => [] },
  showHcp: { type: Boolean, default: false },
  clickableSeat: { type: String, default: null },
  playedCards: { type: Object, default: null },
  hidePlayedCards: { type: Boolean, default: false },
  config: { type: Object, required: true },
  phase: { type: String, default: 'bidding' },
  heroSeat: { type: String, default: 'S' },
})
defineEmits(['card-click'])

const SEATS = ['N', 'E', 'S', 'W']
const SUIT_LETTER = { spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' }

// Nominal reserves for the non-seat regions (px, 1.0×). Center ~= the auction's
// four columns; periphery is small enough that its 1.0 cap binds regardless.
const CENTER_RESERVE = 220
const PERIPH_RESERVE = 160

const anchor = computed(() => anchorFor(props.config.orientation, props.heroSeat))
function seatArea(seat) { return seatToArea(seat, anchor.value) }

const caps = computed(() => props.config.scale?.caps || {})
const floor = computed(() => props.config.scale?.legibilityFloor ?? 0.65)
const regions = computed(() => props.config.regions || {})
function hasRegion(area) { return regions.value[area] && regions.value[area] !== 'none' }

function hasCards(seat) {
  const h = props.hands?.[seat]
  return !!h && ['spades', 'hearts', 'diamonds', 'clubs'].some((s) => (h[s] || []).length > 0)
}
function isHandBearing(seat) { return !props.hiddenSeats.includes(seat) && hasCards(seat) }
// Always occupied: a hand-bearing seat shows a full hand; otherwise a chip.
function seatDensity(seat) { return isHandBearing(seat) ? 'full' : 'chip' }

function marksFor(seat) {
  const cards = {}
  for (const code of props.playedCards?.[seat] || []) {
    cards[code[0].toUpperCase() + code.slice(1).toUpperCase()] = { played: true }
  }
  return { cards, activeSeat: props.clickableSeat === seat }
}

const gridStyle = computed(() => {
  const c = props.config.tracks?.columns || [1, 1, 1]
  const r = props.config.tracks?.rows || [1, 1, 1]
  return {
    gridTemplateColumns: c.map((f) => f + 'fr').join(' '),
    gridTemplateRows: r.map((f) => f + 'fr').join(' '),
  }
})

// ── The §3 scale clamp, per region, from measured geometry ──────────────────
const scales = reactive({ seats: 1, center: 1, nw: 1, ne: 1, se: 1, sw: 1 })
const root = ref(null)
const fmt = (x) => (x == null ? '' : Number(x).toFixed(2))

// Column index each area sits in (left/center/right). A region's AVAILABLE width
// is its column's resolved track width — NOT the region's own (content-sized,
// centered) box, which would measure the hand instead of the space it's given.
const COL_OF = { nw: 0, w: 0, sw: 0, n: 1, center: 1, s: 1, ne: 2, e: 2, se: 2 }

function measure() {
  const el = root.value
  if (!el) return
  const cols = getComputedStyle(el).gridTemplateColumns.split(' ').map(parseFloat)
  if (cols.length < 3 || cols.some((n) => !isFinite(n))) return
  const availOf = (area) => cols[COL_OF[area]] || 0

  // Seats: uniform over hand-bearing seats only (refined §3) — each hand-bearing
  // seat's COLUMN track width against the 7-card reserve; the min drives the size.
  const handBearing = SEATS.filter(isHandBearing).map((seat) => ({
    available: availOf(seatArea(seat)),
    reserve: rowReservePx(7),
  }))
  scales.seats = uniformSeatScale(handBearing, { cap: caps.value.seats ?? 1.4, floor: floor.value })
  scales.center = computeRegionScale({ available: availOf('center'), reserve: CENTER_RESERVE, cap: caps.value.center ?? 1.8, floor: floor.value })
  for (const area of ['nw', 'ne', 'se', 'sw']) {
    if (!hasRegion(area)) continue
    scales[area] = computeRegionScale({ available: availOf(area), reserve: PERIPH_RESERVE, cap: caps.value[area] ?? 1.0, floor: floor.value })
  }
}

// Apply a region's scale locally as --table-scale (leaves read it) + expose
// --region-scale for semantics/captions.
function regionStyle(kind) {
  const s = scales[kind] ?? 1
  return { '--table-scale': s, '--region-scale': s }
}

let ro = null
onMounted(async () => {
  await nextTick(); measure()
  if (typeof ResizeObserver === 'undefined' || !root.value) return
  ro = new ResizeObserver(() => measure())
  ro.observe(root.value)
})
onBeforeUnmount(() => ro?.disconnect())
</script>

<style scoped>
.grid-table {
  display: grid;
  grid-template-areas:
    "nw n  ne"
    "w  center e"
    "sw s  se";
  gap: 10px;
  padding: 14px;
  align-items: center;
  justify-items: center;
}
.region { min-width: 0; }
.area-nw { grid-area: nw; justify-self: start; align-self: start; }
.area-n { grid-area: n; }
.area-ne { grid-area: ne; justify-self: end; align-self: start; }
.area-w { grid-area: w; justify-self: start; }
.area-center { grid-area: center; }
.area-e { grid-area: e; justify-self: end; }
.area-sw { grid-area: sw; justify-self: start; align-self: end; }
.area-s { grid-area: s; }
.area-se { grid-area: se; justify-self: end; align-self: end; }
.seat { display: flex; }
</style>

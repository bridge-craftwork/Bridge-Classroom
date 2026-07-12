<template>
  <!-- The real 3×3 named-area grid arranger (grid-arranger-spec.md). Seats are
       ALWAYS occupied (chip minimum) so the grid never reflows; corners are
       first-class areas, not overlays. Each region publishes a computed
       `--region-scale` (the §3 clamp) applied locally as `--table-scale` so the
       leaves render at that scale, plus a `data-region-scale` attribute for the
       gallery captions. Legacy BridgeTable is untouched — this is the `grid`
       branch, dark until the A1 flip. -->
  <div ref="root" class="grid-table" :class="{ 'bidding-anchored': biddingAnchored }" :style="gridStyle" :data-layout-ledger="ledgerJson">
    <!-- Occupied seats only — an unoccupied seat area doesn't render (occupancy
         model); its cell is either absorbed by the stage or left empty. -->
    <div
      v-for="seat in visibleSeats"
      :key="seat"
      class="region seat occupied"
      :class="'area-' + seatArea(seat)"
      :style="regionStyle('seats')"
      :data-region="'seat-' + seatArea(seat)"
      :data-region-scale="fmt(scales.seats)"
      :data-region-reserve="Math.round(rowReservePx(7))"
      :data-bounding-box-label="bbLabel('seat-' + seatArea(seat))"
    >
      <SeatPanel
        :hand="hands[seat]"
        :seat="seat"
        :name="seatBadge(seat)"
        :show-hcp="showHcp"
        :clickable="clickableSeat === seat"
        :density="seatDensity(seat)"
        :marks="marksFor(seat)"
        :hide-played-cards="hidePlayedCards"
        @card-click="(p) => $emit('card-click', { seat, ...p })"
      />
    </div>

    <!-- center + peripheral regions: shell-provided content, scaled per region. -->
    <div class="region area-center occupied" :style="centerStyle" data-region="center" :data-region-scale="fmt(scales.center)" :data-region-reserve="biddingAnchored ? stageReservePx : Math.round(regionReserve('center'))" :data-bounding-box-label="bbLabel('center')">
      <slot name="center" />
    </div>
    <div v-if="areaOccupied('nw')" class="region area-nw occupied" :style="regionStyle('nw')" data-region="nw" :data-region-scale="fmt(scales.nw)" :data-region-reserve="Math.round(regionReserve('nw'))" :data-bounding-box-label="bbLabel('nw')"><slot name="nw" /></div>
    <div v-if="areaOccupied('ne')" class="region area-ne occupied" :style="regionStyle('ne')" data-region="ne" :data-region-scale="fmt(scales.ne)" :data-region-reserve="Math.round(regionReserve('ne'))" :data-bounding-box-label="bbLabel('ne')"><slot name="ne" /></div>
    <div v-if="areaOccupied('se')" class="region area-se occupied" :style="regionStyle('se')" data-region="se" :data-region-scale="fmt(scales.se)" :data-region-reserve="Math.round(regionReserve('se'))" :data-bounding-box-label="bbLabel('se')"><slot name="se" /></div>
    <div v-if="areaOccupied('sw')" class="region area-sw occupied" :style="regionStyle('sw')" data-region="sw" :data-region-scale="fmt(scales.sw)" :data-region-reserve="Math.round(regionReserve('sw'))" :data-bounding-box-label="bbLabel('sw')"><slot name="sw" /></div>

    <!-- Bounding-box diagnostic legend: collapsed (zero-size) regions listed here
         instead of as floating 0×0 labels over the layout. Hidden unless the
         diagnostic is on (boundingBoxes.css keys off html[data-bounding-boxes]). -->
    <div class="bounding-box-legend" aria-hidden="true">
      <span class="bbl-title">collapsed</span>
      <template v-if="collapsedRegions.length">
        <span v-for="k in collapsedRegions" :key="k" class="bbl-item">{{ k }}</span>
      </template>
      <span v-else class="bbl-item bbl-none">none</span>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick, useSlots } from 'vue'
import SeatPanel from '../SeatPanel.vue'
import { seatToArea, anchorFor, seatRole, rowReservePx, computeLayoutLedger } from '../../utils/gridArranger.js'
import { auctionReservePx, auctionGrowthReservePx } from '../auctionMetrics.js'
import { biddingBoxReservePx } from '../biddingBoxMetrics.js'

const slots = useSlots()

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
  heroName: { type: String, default: null },
})
defineEmits(['card-click'])

const SEATS = ['N', 'E', 'S', 'W']
const SUIT_LETTER = { spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' }
const AREA_ROWS = [['nw', 'n', 'ne'], ['w', 'center', 'e'], ['sw', 's', 'se']]
const AREA_COLS = [['nw', 'w', 'sw'], ['n', 'center', 's'], ['ne', 'e', 'se']]
const ALL_AREAS = AREA_ROWS.flat()
const CORNERS = ['nw', 'ne', 'sw', 'se']

// Region reserves (px, 1.0×) — the component's NEEDED width, single-sourced from
// its metrics where it exists (auction: auctionMetrics, fix 1b). Fixes the stale
// reserve that let the NE auction overflow its track at computed 1.0×.
const TRICK_RESERVE = 200
const STATUS_RESERVE = 150
// BiddingBox natural width at 1.0×, single-sourced from biddingBoxMetrics (same
// pattern as auction: render and provisioning share the number, can't drift).
// Post glyph-ratio restyle this is ~222 (down from the pre-restyle 308) — the BB
// now collapses inter-card gaps before shrinking cards, so the honestly narrower
// form is what the action column must hold.
const BOX_RESERVE = biddingBoxReservePx()
const PERIPH_RESERVE = 160
// Designed inter-region gap (px) — mirrors the --cell-gap CSS var; used to size
// occupancy-driven columns wide enough for their region PLUS its margins.
const CELL_GAP = 6

const anchor = computed(() => anchorFor(props.config.orientation, props.heroSeat))
function seatArea(seat) { return seatToArea(seat, anchor.value) }

const floor = computed(() => props.config.scale?.legibilityFloor ?? 0.65)
const regions = computed(() => props.config.regions || {})
function hasRegion(area) { return regions.value[area] && regions.value[area] !== 'none' }

function hasCards(seat) {
  const h = props.hands?.[seat]
  return !!h && ['spades', 'hearts', 'diamonds', 'clubs'].some((s) => (h[s] || []).length > 0)
}
function isHandBearing(seat) { return !props.hiddenSeats.includes(seat) && hasCards(seat) }
function seatDensity(seat) { return isHandBearing(seat) ? 'full' : 'chip' }
// Chips by VISIBILITY (fix 3): the seat AREA always exists (the fr tracks give
// the geometry), but whether a chip/hand renders is a display decision. A1
// ('directive') renders only the deal's directive seats (not hidden ones);
// tables ('always') render every seat (live presence). Non-visible → empty area.
function seatVisible(seat) {
  return (props.config.seatChips || 'always') === 'always' || !props.hiddenSeats.includes(seat)
}

function marksFor(seat) {
  const cards = {}
  for (const code of props.playedCards?.[seat] || []) {
    cards[code[0].toUpperCase() + code.slice(1).toUpperCase()] = { played: true }
  }
  return { cards, activeSeat: props.clickableSeat === seat }
}

// Bidding-scene vertical model (grid-arranger-spec §1, amended no-reflow rule):
// BOTTOM-anchor the working cluster with a BOUNDED growth reserve. During bidding
// the rows are content-sized (`auto auto auto`); the center stage reserves a fixed
// height (`stageReservePx`, sized to a realistic auction, NOT the viewport) and
// bottom-anchors the auction within it. The auction grows UPWARD into the reserve
// while the hand + BiddingBox row hold position; only a freak auction exceeding the
// reserve pushes them down. The grid shrink-wraps vertically — the shell owns where
// the resulting block sits in the viewport (the arranger never reads viewport dims).
const biddingAnchored = computed(
  () => props.phase === 'bidding' && props.config.anchor?.bidding === 'bottom',
)
const reserveRounds = computed(() => props.config.reserveRounds ?? 1)

// ── Occupancy model (evaluated per deal, at load) ────────────────────────────
// A region is occupied iff it actually renders content this deal: center = the
// stage; a corner = its role is configured AND the shell provided its slot; a seat
// = it's visible (the deal's display directive). Everything downstream — which
// divs render, the area template, the column widths, the legend — is a pure
// function of this, so the grid genuinely collapses around what isn't there.
// A corner is occupied iff its role is configured AND the shell PROVIDED its slot.
// The shell must gate the slot at the source (`<template v-if=… #se>`): a slot whose
// content is merely v-if'd away still registers here (and forwarding hides that), so
// an always-provided slot would over-count (e.g. an empty se in review). Providing
// conditionally is what lets an empty corner genuinely collapse.
function seatForArea(area) { return SEATS.find((s) => seatArea(s) === area) }
function areaOccupied(area) {
  if (area === 'center') return true
  if (CORNERS.includes(area)) return hasRegion(area) && !!slots[area]
  const seat = seatForArea(area)
  return seat ? seatVisible(seat) : false
}
const visibleSeats = computed(() => SEATS.filter((s) => areaOccupied(seatArea(s))))

// Seat identity BADGE (item 4). config.seatBadges maps the seat's role relative
// to the hero → 'name' (hero's first name) | 'label' ("Partner") | 'off'. 'off'
// (or no config) returns null, so SeatChip renders the plain compass label — the
// "badge off" state. Roles derive from heroSeat, so badges rotate with anchor.
function firstNameOf(full) {
  return (full || '').trim().split(/\s+/)[0] || null
}
function seatBadge(seat) {
  const mode = props.config.seatBadges?.[seatRole(seat, props.heroSeat)] || 'off'
  if (mode === 'name') return firstNameOf(props.heroName)
  if (mode === 'label') return 'Partner'
  return null
}

// A region's reserve WIDTH (px, 1.0×) for column provisioning.
function reserveForArea(area) {
  if (area === 'center') return regionReserve('center')
  if (CORNERS.includes(area)) return regionReserve(area)
  return rowReservePx(7) // seat
}

// Fix 1 — occupancy-driven area template: when the top-centre seat `n` is
// unoccupied, `center` absorbs its cell (spans rows 1–2 in the centre column), so
// the stage lifts to align with the top-row status instead of sitting a row below.
function areaTemplate() {
  const rows = AREA_ROWS.map((r) => r.slice())
  if (!areaOccupied('n')) rows[0][1] = 'center'
  return rows.map((r) => `"${r.join(' ')}"`).join(' ')
}
// Column widths are computed in relayout() (budget allocation), not here — see the
// one-directional sizing note. `reserveForArea` (above) supplies the per-column
// need; the centre column is the flexible stage that absorbs any deficit.

const actionHandGap = computed(() => props.config.spacing?.actionHandGap ?? 14)

const gridStyle = computed(() => {
  const r = props.config.tracks?.rows || [1, 1, 1]
  // Columns are the computed ALLOCATIONS (fixed px), NOT `1fr` — so tracks size to
  // need and don't stretch to fill the budget; `justify-content:center` (CSS)
  // turns the surplus into outer margin, clustering the columns.
  const cols = colAlloc.map((w) => (w > 0 ? w + 'px' : '0')).join(' ')
  return {
    gridTemplateAreas: areaTemplate(),
    gridTemplateColumns: cols,
    // Bottom-anchored bidding: content-sized rows — the center's min-height (the
    // reserve, see centerStyle) sets the stage height. Otherwise the config's
    // weighted-fr rows (play/review centered stage).
    gridTemplateRows: biddingAnchored.value ? 'auto auto auto' : r.map((f) => f + 'fr').join(' '),
    '--action-hand-gap': actionHandGap.value + 'px',
  }
})

// ── The §3 scale clamp, per region, from measured geometry ──────────────────
const scales = reactive({ seats: 1, center: 1, nw: 1, ne: 1, se: 1, sw: 1 })
// Received box (px) per region — measured, DISPLAY-ONLY (never fed to scale).
const sizes = reactive({})
// The full layout ledger from the pure allocator — the source of truth the render
// applies and the bounding-box diagnostic reads (grid-arranger-spec §3/§5.1).
const ledger = ref(null)
// Serialized ledger on the grid root — the walker reads it to save beside each
// capture (harness only; a few hundred bytes, inert in production).
const ledgerJson = computed(() => (ledger.value ? JSON.stringify(ledger.value) : null))
const root = ref(null)
const fmt = (x) => (x == null ? '' : Number(x).toFixed(2))

// Bounding-box label straight from the LEDGER: `region · WxH · scale× · r<reserve>
// · a<allocated> · <binding>`. reserve-vs-allocated (and vs the received W×H) is
// the encroachment / dead-space / who-won-the-budget diagnosis.
function bbLabel(regionKey) {
  const area = regionKey.startsWith('seat-') ? regionKey.slice(5) : regionKey
  const led = ledger.value?.regions?.[area]
  const s = sizes[regionKey]
  const sz = s ? `${s.w}×${s.h}` : '—'
  if (!led) return `${regionKey} · ${sz}`
  return `${regionKey} · ${sz} · ${led.scale}× · r${led.reserve} · a${led.allocated} · ${led.binding}`
}
// Collapsed regions — the unoccupied areas (from the occupancy model), listed in
// the diagnostic's corner legend rather than rendered as floating 0×0 boxes.
const collapsedRegions = computed(() => ALL_AREAS.filter((a) => !areaOccupied(a)))

// Column index each area sits in (left/center/right). A region's AVAILABLE width
// is its column's resolved track width — NOT the region's own (content-sized,
// centered) box, which would measure the hand instead of the space it's given.
const COL_OF = { nw: 0, w: 0, sw: 0, n: 1, center: 1, s: 1, ne: 2, e: 2, se: 2 }

// A region's NEEDED width from its role (single-sourced where the component
// exports metrics). Center is phase-driven: the auction during bidding, the
// trick area during play.
function regionReserve(area) {
  // Center is phase-driven: auction during bidding AND review (review hosts the
  // completed auction + result, NE freed — densities ruling); trick area in play.
  if (area === 'center') return props.phase === 'play' ? TRICK_RESERVE : auctionReservePx()
  const role = regions.value[area]
  if (role === 'auction-ref') return auctionReservePx()
  if (role === 'action') return BOX_RESERVE
  if (role === 'status') return STATUS_RESERVE
  return PERIPH_RESERVE
}
// One-directional sizing (Rick's ruling, 2026-07-11). The shell hands the grid a
// width BUDGET (its offered content width — stable, never a rendered-content
// measurement, so applying a scale can't feed back). Tracks are ALLOCATED from the
// budget + the components' exported reserves; the scale is `min(1, allocation /
// reserve)` — natural size (1.0×) when it fits, smaller only when the budget
// genuinely can't. Tracks size to their NEED (not stretched to fill the budget);
// the surplus becomes outer margin (justify-content:center), so hands cluster one
// gutter from the centre object instead of spreading to the stage extremes.
const colAlloc = reactive([0, 0, 0]) // per-column WIDTH (content + margins), px
let lastBudget = -1

function relayout(force = false) {
  const el = root.value
  if (!el) return
  const cs = getComputedStyle(el)
  const budget = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
  if (!(budget > 0)) return
  // Width is the only input; height (vertical shrink-wrap) never re-triggers scale.
  if (!force && Math.abs(budget - lastBudget) < 0.5) { recordSizes(el); return }
  lastBudget = budget

  // Build the ledger inputs from occupancy + exported reserves (no rendered-content
  // measurement) and delegate to the pure allocator. The ledger IS the layout: the
  // render applies it, the bounding boxes read it, the walker saves it.
  const occupied = ALL_AREAS.filter(areaOccupied)
  const reserves = {}
  for (const a of ALL_AREAS) reserves[a] = reserveForArea(a)
  const l = computeLayoutLedger({
    budget,
    occupied,
    reserves,
    tiers: props.config.allocationPriority,
    seatReserve: rowReservePx(7),
    handBearingAreas: SEATS.filter(isHandBearing).map(seatArea),
    cellGap: CELL_GAP,
    actionHandGap: actionHandGap.value,
    floor: floor.value,
  })
  ledger.value = l

  for (let ci = 0; ci < 3; ci++) colAlloc[ci] = l.colWidths[ci]
  scales.seats = l.seats.scale
  scales.center = l.regions.center?.scale ?? 1
  for (const area of ['nw', 'ne', 'se', 'sw']) scales[area] = l.regions[area]?.scale ?? 1
  recordSizes(el)
}

// Received boxes for the bounding-box ledger (display only — never fed to scale).
function recordSizes(el) {
  el.querySelectorAll('[data-region]').forEach((r) => {
    const b = r.getBoundingClientRect()
    sizes[r.getAttribute('data-region')] = { w: Math.round(b.width), h: Math.round(b.height) }
  })
}

// Apply a region's scale locally as --table-scale (leaves read it) + expose
// --region-scale for semantics/captions.
function regionStyle(kind) {
  const s = scales[kind] ?? 1
  return { '--table-scale': s, '--region-scale': s }
}

// Bidding stage reserve HEIGHT (px) — the bounded growth band above the
// bottom-anchored auction, scaled by the center region's own scale so the reserve
// matches the rendered auction. Fixed (not viewport-derived): the auction grows
// upward into it without moving the hand/BB until it's exhausted.
const stageReservePx = computed(() =>
  biddingAnchored.value ? Math.round(auctionGrowthReservePx(reserveRounds.value) * (scales.center || 1)) : 0,
)
// Center region: scale vars + (bidding only) the reserved min-height that holds the
// growth band. `data-region-reserve` exposes it for the bounding-box diagnostic.
const centerStyle = computed(() => {
  const base = regionStyle('center')
  return biddingAnchored.value ? { ...base, minHeight: stageReservePx.value + 'px' } : base
})

let ro = null
onMounted(async () => {
  await nextTick(); relayout(true)
  if (typeof ResizeObserver === 'undefined' || !root.value) return
  // Watch the grid's OFFERED width only. The grid fills the frame (which doesn't
  // shrink-wrap horizontally), so clientWidth = the shell's budget and is stable;
  // relayout skips when the width is unchanged, so a content/height change (the
  // vertical shrink-wrap) never re-drives scale.
  ro = new ResizeObserver(() => relayout())
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
  /* gap: 0 — spacing is expressed as margins on OCCUPIED regions only (below), so
     gutters collapse with occupancy. A grid gap still reserves a gutter around a
     collapsed 0-height/0-width track, which is what left a phantom band between the
     status strip and the stage; margins on non-empty regions don't. */
  gap: 0;
  padding: 14px;
  align-items: center;
  justify-items: center;
  /* Tracks are allocated to their need (not stretched to the budget); the leftover
     budget is distributed as outer margin here, clustering the columns toward the
     centre so hands sit one gutter from the stage rather than at its extremes. */
  justify-content: center;
  --cell-gap: 6px;
  /* The grid SHRINK-WRAPS to its content + reserves — it never reads the viewport.
     The shell owns where this block sits (grid-arranger-spec §1: grid sizes to
     content/reserves, shell owns the viewport). */
}
/* Designed spacing lives on occupied regions only; unoccupied areas don't render,
   so no phantom gutters (gap:0 does the rest). */
.grid-table .region.occupied { margin: var(--cell-gap); }
/* Bottom-anchor bidding: the center stage reserves a bounded growth height (min-
   height set inline = stageReservePx) and bottom-anchors the auction within it.
   `justify-self: center` shrinks the region to the auction and centres it in the
   stage column, so the growth reserve reads as a VERTICAL band above the auction
   (not side fill) and the centre midline lines up with the hand's. */
.grid-table.bidding-anchored .area-center {
  display: flex;
  align-items: flex-start;  /* auction pinned to the TOP of the stage — its top is
                               fixed (= stage top, aligned with the status), so it
                               never wobbles as the reserve/scale change; the reserve
                               is growth room BELOW, which the auction fills as it
                               lengthens before displacing the hand. */
  align-self: start;        /* top-align the (row-spanning) stage in its rows too, so
                               the grid's align-items:center can't float it. */
  justify-content: center;
  justify-self: center;
}
/* Fix 4: the action cluster gets a designed gap on its hand-facing (left) side —
   a config constant (`--action-hand-gap`), per spacing-as-margins-on-occupied. */
.grid-table.bidding-anchored .area-se { margin-left: var(--action-hand-gap, 14px); }
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

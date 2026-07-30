<template>
  <!-- The real 3×3 named-area grid arranger (grid-arranger-spec.md). Seats are
       ALWAYS occupied (chip minimum) so the grid never reflows; corners are
       first-class areas, not overlays. Each region publishes a computed
       `--region-scale` (the §3 clamp) applied locally as `--table-scale` so the
       leaves render at that scale, plus a `data-region-scale` attribute for the
       gallery captions. Legacy BridgeTable is untouched — this is the `grid`
       branch, dark until the A1 flip. -->
  <div ref="root" class="grid-table" :class="{ anchored, 'bidding-anchored': biddingAnchored, 'play-anchored': playAnchored }" :style="gridStyle" :data-layout-ledger="ledgerJson">
    <!-- Occupied seats only — an unoccupied seat area doesn't render (occupancy
         model); its cell is either absorbed by the stage or left empty. -->
    <div
      v-for="seat in visibleSeats"
      :key="seat"
      class="region seat occupied"
      :class="'area-' + seatArea(seat)"
      :style="[regionStyle('seats'), seatAllocStyle(seat)]"
      :data-region="'seat-' + seatArea(seat)"
      :data-region-scale="fmt(scales.seats)"
      :data-region-reserve="Math.round(dealSeatReserve)"
      :data-bounding-box-label="bbLabel('seat-' + seatArea(seat))"
      :data-overflow="regionOverflow('seat-' + seatArea(seat))"
    >
      <SeatPanel
        :hand="hands[seat]"
        :seat="seat"
        :name="seatName(seat)"
        :you="seat === heroSeat"
        :presence="occPresence(seat)"
        :show-hcp="showHcp"
        :clickable="clickableSeat === seat"
        :inspectable="inspectable"
        :density="seatDensity(seat)"
        :marks="marksFor(seat)"
        :hide-played-cards="hidePlayedCards"
        :label-component="labelComponent"
        :label-props="labelProps"
        @card-click="(p) => $emit('card-click', { seat, ...p })"
        @card-inspect="(p) => $emit('card-inspect', { seat, ...p })"
      />
    </div>

    <!-- center + peripheral regions: shell-provided content, scaled per region. -->
    <div class="region area-center occupied" :style="centerStyle" data-region="center" :data-region-scale="fmt(scales.center)" :data-region-reserve="biddingAnchored ? stageReservePx : Math.round(regionReserve('center'))" :data-bounding-box-label="bbLabel('center')" :data-overflow="regionOverflow('center')">
      <slot name="center" />
    </div>
    <div v-if="areaOccupied('nw')" class="region area-nw occupied" :style="regionStyle('nw')" data-region="nw" :data-region-scale="fmt(scales.nw)" :data-region-reserve="Math.round(regionReserve('nw'))" :data-bounding-box-label="bbLabel('nw')" :data-overflow="regionOverflow('nw')"><slot name="nw" /></div>
    <div v-if="areaOccupied('ne')" class="region area-ne occupied" :style="regionStyle('ne')" data-region="ne" :data-region-scale="fmt(scales.ne)" :data-region-reserve="Math.round(regionReserve('ne'))" :data-bounding-box-label="bbLabel('ne')" :data-overflow="regionOverflow('ne')"><slot name="ne" /></div>
    <div v-if="areaOccupied('se')" class="region area-se occupied" :style="regionStyle('se')" data-region="se" :data-region-scale="fmt(scales.se)" :data-region-reserve="Math.round(regionReserve('se'))" :data-bounding-box-label="bbLabel('se')" :data-overflow="regionOverflow('se')"><slot name="se" /></div>
    <div v-if="areaOccupied('sw')" class="region area-sw occupied" :style="regionStyle('sw')" data-region="sw" :data-region-scale="fmt(scales.sw)" :data-region-reserve="Math.round(regionReserve('sw'))" :data-bounding-box-label="bbLabel('sw')" :data-overflow="regionOverflow('sw')"><slot name="sw" /></div>

    <!-- Row-band markers (§5.1): one per grid row, tinting the band and labelling
         its occupied areas + ✗phantom seats (a hidden hand's dead band, e.g. the
         declarer's empty South row in a defence scene). Empty divs — the label is
         a ::before, so they add nothing to track sizing; display:none until the
         diagnostic is on. Makes the "phantom South" answerable from the box image. -->
    <div v-for="rb in rowBands" :key="'rb' + rb.index"
         class="row-band" :class="{ 'has-phantom': rb.phantom.length, 'has-slack': rb.slack > 4, 'has-overflow': rb.overflow > 4 }"
         :style="{ gridRow: rb.index + 1, gridColumn: '1 / -1', '--row-slack': rb.slack + 'px' }"
         :data-row-band-label="rb.label" aria-hidden="true"></div>

    <!-- Stage line: total vertical vs content, the slack sum, and the vertical
         binding (viewport-fill = fr rows over-expand into slack; shrink-wrap =
         content-sized). The void's headline number. -->
    <div class="stage-line" :data-stage-label="stageLine" aria-hidden="true"></div>

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
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick, useSlots } from 'vue'
import { useArrangement } from '../../composables/useArrangement.js'
import SeatPanel from '../SeatPanel.vue'
import { seatToArea, anchorFor, seatRole, partnerOf, rowReservePx, handReservePx, computeLayoutLedger, actionCornerFor } from '../../utils/gridArranger.js'
import { auctionReservePx, auctionGrowthReservePx } from '../auctionMetrics.js'
import { biddingBoxReservePx } from '../biddingBoxMetrics.js'
import { A1_BOARD_SIZE, boardIndicatorExtentPx } from '../boardIndicatorMetrics.js'

const slots = useSlots()

const props = defineProps({
  hands: { type: Object, required: true },
  hiddenSeats: { type: Array, default: () => [] },
  showHcp: { type: Boolean, default: false },
  clickableSeat: { type: String, default: null },
  playedCards: { type: Object, default: null },
  // Current-trick cards to HIGHLIGHT (vs playedCards, which strike through).
  currentCards: { type: Object, default: null },
  // Per-seat DD overlay badges: { N: { "H4": { badge, fill } }, ... }. Merged
  // into each card's mark (badge text + cell fill) WITHOUT the `played` strike —
  // used for the post-hand double-dummy cardplay-error overlay on the fresh
  // reveal (#24). Independent of playedCards.
  cardBadges: { type: Object, default: null },
  // Post-hand review: make every card tappable to inspect its DD alternatives.
  inspectable: { type: Boolean, default: false },
  hidePlayedCards: { type: Boolean, default: false },
  config: { type: Object, required: true },
  // Per-region width-reserve overrides in CSS px at 1.0×: { nw: 240, se: 300 }.
  //
  // Why this exists (2026-07-29). A region's reserve is normally derived from its
  // ROLE — 'auction-ref' asks AuctionTable, 'action' asks BiddingBox, 'status' is the
  // board glyph's extent. That works while a region holds exactly the thing its role
  // names. It stops working the moment a corner holds a CLUSTER whose membership the
  // arranger can't predict: NW gained the deal transport, SE gained Undo/Claim under
  // the box and the double-dummy table at review, and — the case no single component
  // metric can express — WHICH of those render depends on the viewer. A table owner
  // sees the transport; an invited player (B3) does not, and the corner must not
  // reserve width for controls that seat never gets.
  //
  // So the SHELL, which is the only party that knows what it's placing, may hand the
  // arranger the number. Occupancy already works this way (a corner is occupied iff
  // its role is configured AND the shell provided the slot); this closes the gap by
  // letting the same decision carry its width. Unset regions fall through to the
  // role-derived default, so every existing caller — A1 included — is byte-identical.
  regionReserves: { type: Object, default: null },
  phase: { type: String, default: 'bidding' },
  heroSeat: { type: String, default: 'S' },
  heroName: { type: String, default: null },
  // Declarer seat (played/reviewed deals) — names declarer + its dummy (item 5).
  declarer: { type: String, default: null },
  // Per-seat occupants for multiplayer tables: { N: { name, connected }, ... }.
  // When provided (server/local table), the occupant name (a player's name, or a
  // bot label like "BBA+RulesBot") REPLACES the config-role badge — the table
  // shows WHO holds the seat, not a lesson role. A1 passes no occupants, so the
  // role-based seatBadge path is untouched there.
  occupants: { type: Object, default: null },
  // Seat highlighted as "on turn" (auction/play), additive to clickableSeat.
  activeSeat: { type: String, default: null },
  // Seat where a bot is currently thinking (pink frame; e.g. BEN on the lead).
  thinkingSeat: { type: String, default: null },
  // Optional grabbable/droppable seat-label component + its shared props
  // (SeatControlTable injects ManageableSeatLabel for host drag/drop + the
  // Sit/Remove/Kick menu). null → the plain SeatChip; A1 passes neither.
  labelComponent: { type: [Object, Function], default: null },
  labelProps: { type: Object, default: null },
})
defineEmits(['card-click', 'card-inspect'])

const SEATS = ['N', 'E', 'S', 'W']
const SUIT_LETTER = { spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' }
const AREA_ROWS = [['nw', 'n', 'ne'], ['w', 'center', 'e'], ['sw', 's', 'se']]
const AREA_COLS = [['nw', 'w', 'sw'], ['n', 'center', 's'], ['ne', 'e', 'se']]
const ALL_AREAS = AREA_ROWS.flat()
const CORNERS = ['nw', 'ne', 'sw', 'se']

// Region reserves (px, 1.0×) — the component's NEEDED width, single-sourced from
// its metrics where it exists (auction: auctionMetrics, fix 1b). Fixes the stale
// reserve that let the NE auction overflow its track at computed 1.0×.
// TrickArea's full width = the .trick-grid (200px) PLUS its .trick-area horizontal
// padding (2×8px, the designed clearance from the adjacent E/W hand panels). The
// reserve MUST include that padding — omitting it under-provisions by 16px×scale, so
// once the seats/centre grew past 1.0× the trick spilled left over the West hand
// (2026-07-13 report; harmless at the old <1.0× scales, ~19px at 1.16×). At an
// accurate reserve the rendered centre == its allocation, so it stays inside its
// column and the overlay-on/off renders agree (the observer effect was the spill
// painting over the neighbour, which the fix removes).
const TRICK_RESERVE = 216
// NW status column: the board·dealer·vul BoardIndicator glyph (StatusStrip chips
// wrap under it). Single-sourced from boardIndicatorMetrics at the A1 glyph size
// (~89px) — replaces the stale 150 (the old three-pill board/dealer/vul stack;
// the vul-diamond composition is visibly narrower).
const STATUS_RESERVE = Math.round(boardIndicatorExtentPx(A1_BOARD_SIZE))
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
const heroArea = computed(() => seatArea(props.heroSeat))
// The bottom corner the action cluster rides in — hero-relative (§ play bottom-pack).
const actionArea = computed(() => actionCornerFor(heroArea.value))

const floor = computed(() => props.config.scale?.legibilityFloor ?? 0.65)
// Per-client preview channel — read here so ONE url param previews the fix on every
// surface at once (A1, the B tables, and the gallery scenes).
const { arrangement } = useArrangement()
// Effective region map: the configured 'action' role is RELOCATED to the bottom
// corner on the hero's side, so the action cluster (bidding box / Undo·Claim) rides
// with the hero instead of a fixed compass corner. A South/East hero keeps 'se'
// (no move); a West defender (screen-left) moves it to 'sw'. The scene provides its
// action slot in the same computed corner (shared actionCornerFor), so the slot and
// the occupancy/reserve agree.
const regions = computed(() => {
  const base = { ...(props.config.regions || {}) }
  const from = CORNERS.find((c) => base[c] === 'action')
  if (from && actionArea.value !== from) { base[actionArea.value] = 'action'; base[from] = 'none' }
  return base
})
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
  // Current-trick cards (e.g. dummy's led card) highlight rather than strike through.
  for (const code of props.currentCards?.[seat] || []) {
    cards[code[0].toUpperCase() + code.slice(1).toUpperCase()] = { current: true }
  }
  // DD error overlay: merge badge/fill onto the card WITHOUT `played` (no strike).
  for (const [code, mark] of Object.entries(props.cardBadges?.[seat] || {})) {
    const key = code[0].toUpperCase() + code.slice(1).toUpperCase()
    cards[key] = { ...cards[key], ...mark }
  }
  return {
    cards,
    activeSeat: props.clickableSeat === seat || props.activeSeat === seat,
    thinking: props.thinkingSeat === seat,
  }
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
// Play bottom-pack (grid-arranger-spec § play bottom-pack): the play phase takes the
// SAME content-sized-rows treatment as bidding — the fr rows over-expand a tall
// frame into slack (the "phantom South" dead band), so anchoring collapses the rows
// to content and flips the stage to shrink-wrap. Unlike bidding there's no growth
// reserve (the trick area doesn't grow like an auction); the difference is only the
// bidding-specific auction top-pin + reserve, kept under `.bidding-anchored`.
const playAnchored = computed(
  () => props.phase === 'play' && props.config.anchor?.play === 'bottom',
)
// Either anchored model → content-sized rows + shrink-wrap stage binding.
const anchored = computed(() => biddingAnchored.value || playAnchored.value)
// Rows shrink-wrap to content in the anchored (bottom-pack) phases AND in REVIEW.
// Review isn't bottom-packed, but its fr rows over-expand a tall frame into slack
// exactly like the play "phantom South" — with two hands stacked (N + S) the grid
// stretched to 1212px and pushed the South hand offscreen (2026-07-13, issue #13).
// Content-sized rows collapse that; the height-fit below then keeps the stack inside
// the viewport. (Kept separate from `anchored` so review doesn't inherit the
// bottom-pack corner margins / growth reserve it has no use for.)
const shrinkWrapRows = computed(() => anchored.value || props.phase === 'review')
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

// Seat identity BADGE (item 4 + item 5). config.seatBadges maps the seat's role
// relative to the hero → 'name' (hero's first name) | 'label' ("Partner") |
// 'off'. On a played/reviewed deal the declarer and its dummy are additionally
// named "Declarer" / "Dummy", overriding the neutral opponent 'off' — but never
// the hero (the student always sees their own name). The name field carries the
// role word only; the SeatIndicator circle already shows the compass letter.
// 'off' / no match → null, so SeatChip renders the plain compass label. Roles
// derive from heroSeat, so badges rotate with the orientation anchor.
function firstNameOf(full) {
  return (full || '').trim().split(/\s+/)[0] || null
}
function seatBadge(seat) {
  const role = seatRole(seat, props.heroSeat)
  if (role === 'hero') return props.config.seatBadges?.hero === 'name' ? firstNameOf(props.heroName) : null
  // Declarer + its dummy named by ROLE only — the SeatIndicator circle already
  // carries the compass letter, so no compass prefix in the name field.
  const decl = props.declarer
  if (decl) {
    if (seat === decl) return 'Declarer'
    if (seat === partnerOf(decl)) return 'Dummy'
  }
  // seatRole returns the SINGULAR 'opponent'; the config key is PLURAL 'opponents' —
  // map it so a config that turns opponents on is actually read (was a silent no-op).
  const key = role === 'opponent' ? 'opponents' : role
  const mode = props.config.seatBadges?.[key] || 'off'
  return mode === 'label' ? 'Partner' : mode === 'name' ? firstNameOf(props.heroName) : null
}
// Seat label: on a multiplayer table the OCCUPANT (player name / bot label) wins
// over the config-role badge — the table names WHO holds each seat. A1 passes no
// occupants, so this falls straight through to the role-based seatBadge.
function seatName(seat) {
  const occ = props.occupants?.[seat]
  return (occ && occ.name) || seatBadge(seat)
}
// Presence dot / badge greying for a HUMAN occupant (boolean `connected`); bots
// (no `connected`) and A1 (no occupants) get null → no dot.
function occPresence(seat) {
  const o = props.occupants?.[seat]
  return o && o.name && typeof o.connected === 'boolean'
    ? (o.connected ? 'connected' : 'disconnected')
    : null
}

// The seat reserve for THIS deal: the widest actual hand's natural row, not the
// 7-card worst case. Provisioning to what the deal truly needs lets the uniform seat
// scale grow to fill the budget instead of pre-allowing for max-width hands that are
// rare (Rick, 2026-07-13: "grow based on actual width of this deal instead of the
// budget"). Computed from the FULL holdings (handReservePx reads the whole hand; played
// cards are struck in the render, never removed), so it's the hands' WIDEST extent and
// never shrinks as cards are played — no mid-deal magnification creep. Only the shown
// hand-bearing seats count; no hand yet → the 7-card fallback.
const rawSeatReserve = computed(() => {
  const shown = SEATS.filter(isHandBearing)
  if (!shown.length) return rowReservePx(7)
  return Math.max(...shown.map((s) => handReservePx(props.hands?.[s])))
})
// HIGH-WATER MARK across the deal. `handReservePx` assumes the hand keeps all its
// cards (A1 STRIKES played cards but keeps them, so the raw value is naturally
// stable). The SERVER table (useServerTable) instead REMOVES played cards — its
// hands ref empties through the deal — so the raw reserve would shrink as cards are
// played, collapsing the seat columns and squeezing the centre trick area onto the
// hands (reported 2026-07-15). Hold the reserve at the deal's widest and rebaseline
// only when the hands refill (new deal / undo → total card count RISES). So the
// layout "sticks from the start of the hand" and never shrinks mid-deal.
const dealCardTotal = computed(() =>
  SEATS.reduce((n, s) => {
    const h = props.hands?.[s]
    if (!h) return n
    return n + ['spades', 'hearts', 'diamonds', 'clubs'].reduce((m, suit) => m + (h[suit]?.length || 0), 0)
  }, 0))
const dealSeatReserve = ref(rawSeatReserve.value)
let _prevCardTotal = dealCardTotal.value
watch([rawSeatReserve, dealCardTotal], ([raw, total]) => {
  dealSeatReserve.value = total > _prevCardTotal ? raw : Math.max(dealSeatReserve.value, raw)
  _prevCardTotal = total
})

// A region's reserve WIDTH (px, 1.0×) for column provisioning.
function reserveForArea(area) {
  if (area === 'center') return regionReserve('center')
  if (CORNERS.includes(area)) return regionReserve(area)
  return dealSeatReserve.value // seat — this deal's actual widest hand
}

// Occupancy-driven area template: the stage absorbs an empty CENTRE-column seat so
// there's no phantom band. When the top-centre seat `n` is unoccupied, `center`
// absorbs its cell (spans rows 1–2), lifting the stage to align with the top-row
// status (bidding). Symmetrically, when the bottom-centre seat `s` is unoccupied —
// a hidden declarer in a defence scene — `center` absorbs THAT cell (spans rows
// 2–3), dropping the stage into what was the "phantom South" dead band (play
// bottom-pack cure). Both can apply at once (only side hands shown → full-height
// stage). In bidding/review `s` is the hero/revealed, so s-absorption never fires
// there; the bidding triptych is unaffected.
function areaTemplate() {
  const rows = AREA_ROWS.map((r) => r.slice())
  if (!areaOccupied('n')) rows[0][1] = 'center'
  if (!areaOccupied('s')) rows[2][1] = 'center'
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
    // Anchored (bidding OR play bottom-pack): content-sized rows so the tracks
    // shrink-wrap to content (+ the bidding reserve via centerStyle) instead of the
    // fr weights over-expanding a tall frame into slack. Otherwise (review) the
    // config's weighted-fr rows keep the centered stage.
    gridTemplateRows: shrinkWrapRows.value ? 'auto auto auto' : r.map((f) => f + 'fr').join(' '),
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
// Vertical accounting (MEASURED, display-only — never fed to scale): per-row track
// height vs content height (→ slack), and the stage line. Kept separate from the
// pure ledger (which is width-only + row topology) and merged into ledgerJson, so
// measurement never mutates the allocator's output or loops the layout.
const vert = reactive({ rows: [], stage: null })
// Horizontal content-over-track detection — the COLUMNS' measurement counterpart, the
// blind spot the DealInfo + bidding-box overlaps exposed (grid-arranger-spec §3: "every
// layout mechanism needs its measurement counterpart"; the width allocator had none). A
// region whose MEASURED received width exceeds the width its column ALLOCATED has overflowed
// its track and is spilling into a neighbour — e.g. the FIXED-width bidding box at a floored
// SE (222px content in a 144px track → 78px onto the South hand). The pure allocator calls
// that 'floor' (legal), but a fixed-width region can't actually shrink, so the floor is a
// lie: re-label it 'overflow' (red). Display-only (measured), merged into the ledger like
// the vertical row overflow; the pure allocator is unchanged and its unit tests stand.
// Overflow = received width beyond the region's COLUMN TRACK (colWidth = allocated +
// margin gutter), NOT beyond `allocated` (content). Comparing to the track means a region
// only flags when it spills PAST its gutter into a neighbour — the real overlap (the
// bidding box onto the hand). Comparing to `allocated` false-flagged regions that merely
// used their margin (e.g. the trick area a few px over its reserve, absorbed by the gutter,
// no visible overlap). Threshold > a gutter's worth so sub-gutter slop doesn't light up.
const HOVERFLOW_EPS = 10
const displayRegions = computed(() => {
  const regs = ledger.value?.regions
  if (!regs) return regs || {}
  const colW = ledger.value?.colWidths || []
  const out = {}
  for (const [area, r] of Object.entries(regs)) {
    const recv = sizes[sizeKeyFor(area)]?.w
    const track = colW[COL_OF[area]]
    const over = recv != null && track != null ? Math.round(recv - track) : 0
    out[area] = over > HOVERFLOW_EPS ? { ...r, receivedW: recv, track, overflowX: over, binding: 'overflow' } : r
  }
  return out
})

// Serialized ledger on the grid root — the walker reads it to save beside each
// capture (harness only; a few hundred bytes, inert in production). Merges the
// measured vertical (row heights/slack + stage line) AND the measured horizontal
// region overflow (displayRegions) into the pure ledger.
const ledgerJson = computed(() => {
  if (!ledger.value) return null
  const rows = (ledger.value.rows || []).map((r, i) => ({ ...r, ...(vert.rows[i] || {}) }))
  return JSON.stringify({ ...ledger.value, regions: displayRegions.value, rows, ...(vert.stage ? { stage: vert.stage } : {}) })
})
const root = ref(null)
const fmt = (x) => (x == null ? '' : Number(x).toFixed(2))

// Bounding-box label straight from the LEDGER: `region · WxH · scale× · r<reserve>
// · a<allocated> · <binding>` (+ `+Npx` when the region overflows its track). reserve-vs-
// allocated (and vs the received W×H) is the encroachment / dead-space / overflow diagnosis.
function bbLabel(regionKey) {
  const area = regionKey.startsWith('seat-') ? regionKey.slice(5) : regionKey
  const led = displayRegions.value?.[area]
  const s = sizes[regionKey]
  const sz = s ? `${s.w}×${s.h}` : '—'
  if (!led) return `${regionKey} · ${sz}`
  const over = led.overflowX ? ` +${led.overflowX}px` : ''
  return `${regionKey} · ${sz} · ${led.scale}× · r${led.reserve} · a${led.allocated} · ${led.binding}${over}`
}
// Overflow px for a region (null when it fits) — drives the red `[data-overflow]` outline
// in boundingBoxes.css so a spilling region pops in the overlay/2nd screenshot.
function regionOverflow(regionKey) {
  const area = regionKey.startsWith('seat-') ? regionKey.slice(5) : regionKey
  return displayRegions.value?.[area]?.overflowX || null
}
// Collapsed regions — the unoccupied areas (from the occupancy model), listed in
// the diagnostic's corner legend rather than rendered as floating 0×0 boxes.
const collapsedRegions = computed(() => ALL_AREAS.filter((a) => !areaOccupied(a)))

// Row-band overlay data (§5.1) from the ledger's `rows`: label each band with its
// occupied areas and ✗phantom seats. Falls back to bare occupancy if the ledger
// isn't computed yet.
const ROW_NAME = ['top', 'mid', 'bot']
const rowBands = computed(() => {
  const led = ledger.value?.rows
  if (!led) return []
  return led.map((r, i) => {
    const v = vert.rows[i] || {}
    const phantom = r.phantom || []
    const occ = (r.occupied || []).join(' ') || '—'
    const tail = phantom.length ? '  ✗' + phantom.join(' ✗') : ''
    const over = v.overflow > SLACK_EPS ? ` · ${v.overflow} OVERFLOW` : ''
    const slackTxt = v.slack > SLACK_EPS ? ` · ${v.slack} slack` : ''
    const vlabel = v.height != null ? ` · ${v.height}h ${v.contentHeight}c${slackTxt}${over}` : ''
    return { index: r.index, phantom, slack: v.slack || 0, overflow: v.overflow || 0, label: `${ROW_NAME[r.index]}: ${occ}${tail}${vlabel}` }
  })
})
// Stage line for the overlay strip: total · content · slack · binding.
const stageLine = computed(() => {
  const s = vert.stage
  return s ? `stage: ${s.total}h · ${s.content}c · ${s.slack} slack · ${s.binding}` : ''
})

// Column index each area sits in (left/center/right). A region's AVAILABLE width
// is its column's resolved track width — NOT the region's own (content-sized,
// centered) box, which would measure the hand instead of the space it's given.
const COL_OF = { nw: 0, w: 0, sw: 0, n: 1, center: 1, s: 1, ne: 2, e: 2, se: 2 }

// A region's NEEDED width from its role (single-sourced where the component
// exports metrics). Center is phase-driven: the auction during bidding, the
// trick area during play.
function regionReserve(area) {
  // A shell-supplied override wins for the peripheral regions — it is the only
  // party that knows which members of a corner CLUSTER it actually rendered (see
  // the `regionReserves` prop). Center stays arranger-owned: it's the stage, its
  // content is the phase, and no shell should be able to starve it.
  const override = area !== 'center' ? props.regionReserves?.[area] : null
  if (typeof override === 'number' && override > 0) return override
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
// Height-fit state (§ symmetric allocator, 2026-07-13 issue #13). The width pass is
// one-directional (a scale can't feed back into the width budget); height is the one
// genuinely variable input — banner state, board-strip wrap, whatever chrome — so we
// MEASURE it (viewport − grid top − margin) instead of modelling it, and clamp the
// seat scale down to fit. `heightSeatCeiling` is that clamp (Infinity = no height
// pressure); it's reset whenever the WIDTH budget changes (a fresh layout) and derived
// by re-measuring after the width pass renders. Bounded to two passes so it can't loop.
const HEIGHT_BOTTOM_MARGIN = 12
let heightSeatCeiling = Infinity
let heightPass = 0

// Apply the height-fit ceiling to the seats cap (leaves every other role untouched;
// the `se: 'seats'` relationship rides the resulting seatScale as before).
function capsWithHeight(baseCaps) {
  if (!Number.isFinite(heightSeatCeiling)) return baseCaps
  const seatsCap = typeof baseCaps?.seats === 'number' ? baseCaps.seats : 1
  return { ...(baseCaps || {}), seats: Math.min(seatsCap, heightSeatCeiling) }
}

function relayout(force = false) {
  const el = root.value
  if (!el) return
  const cs = getComputedStyle(el)
  const budget = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
  if (!(budget > 0)) return
  const widthChanged = Math.abs(budget - lastBudget) >= 0.5
  // A width change is a fresh layout — drop any prior height clamp and re-fit. Height
  // alone (vertical shrink-wrap) never re-triggers the WIDTH pass; the height fit below
  // re-runs with force when it needs to.
  if (!force && !widthChanged) { recordSizes(el); return }
  if (widthChanged) { lastBudget = budget; heightSeatCeiling = Infinity; heightPass = 0 }

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
    seatReserve: dealSeatReserve.value,
    handBearingAreas: SEATS.filter(isHandBearing).map(seatArea),
    cellGap: CELL_GAP,
    actionHandGap: actionHandGap.value,
    floor: floor.value,
    // Per-region floors (config scale.regionFloors) — reference content (the review
    // double-dummy table) may compress below the global legibility floor.
    floors: props.config.scale?.regionFloors || {},
    // Per-role scale ceilings (§2 scale.caps): the stage/center may grow above 1.0×
    // toward its cap, seats toward theirs, periphery pinned at 1.0, se ≤ seats. Keyed by
    // AREA — the arranger's config caps object. Omitting it (any surface without caps)
    // reverts to the natural-size min(1, fit) allocation, so this is purely additive.
    // The seats cap is additionally lowered by the height fit when the stack is too tall.
    caps: capsWithHeight(props.config.scale?.caps),
    // BETA channel (?arrangement=beta). Stops a HEIGHT-driven seats-cap reduction from
    // also capping a column's WIDTH below its natural need — the 1521x784 collapse where
    // col0 (NW glyph + West seat, nothing else to defend it) was allocated 117 against
    // col2's 220 for identical hands. Default channel is byte-identical.
    capFloorAtNeed: arrangement.value === 'beta',
    // Column fr weights (tracks.columns) — the caps pass grows the stage only toward its fr
    // share of the budget (not straight to the cap), so it stays geometry-bound and clusters.
    columnWeights: props.config.tracks?.columns,
  })
  ledger.value = l

  for (let ci = 0; ci < 3; ci++) colAlloc[ci] = l.colWidths[ci]
  scales.seats = l.seats.scale
  scales.center = l.regions.center?.scale ?? 1
  for (const area of ['nw', 'ne', 'se', 'sw']) scales[area] = l.regions[area]?.scale ?? 1
  recordSizes(el)
  scheduleHeightFit()
}

// The height fit reads the LIVE DOM, so it must run AFTER Vue paints the new scale (a
// synchronous read here sees the previous render). A double rAF waits for layout/paint,
// the same settle HandDisplay's measure uses.
let heightFitRaf = null
function scheduleHeightFit() {
  if (typeof requestAnimationFrame === 'undefined') return
  if (heightFitRaf) cancelAnimationFrame(heightFitRaf)
  heightFitRaf = requestAnimationFrame(() => requestAnimationFrame(() => { heightFitRaf = null; applyHeightFit() }))
}

// Symmetric height clamp (§ issue #13). Measure the rendered stack against the available
// viewport height and, if it overflows, shrink the SEAT scale to fit — down to the
// legibility floor, never below. Below the floor the page SCROLLS (the pressure valve):
// a small scroll beats illegible cards. Re-runs the width pass once with the lowered
// seats cap; converges because the seat rows scale ~linearly with the seat scale and the
// rest (centre, status, gaps) is fixed height, so the fit is a one-step solve.
function applyHeightFit() {
  const el = root.value
  if (!el || heightPass >= 2) return
  const rect = el.getBoundingClientRect()
  const heightBudget = window.innerHeight - rect.top - HEIGHT_BOTTOM_MARGIN
  const gridH = Math.round(rect.height)
  if (!(heightBudget > 0) || gridH <= heightBudget + 2) return // fits — no height pressure

  // Rows carrying a hand-bearing seat scale with the seat scale; sum the tallest such
  // region per ROW (grouping avoids double-counting two side hands sharing the middle
  // row). Everything else (centre, status, gaps) is the fixed remainder.
  const hb = ledger.value?.seats?.handBearing || []
  const rowMax = {}
  for (const area of hb) {
    const node = el.querySelector('.region.area-' + area)
    if (!node) continue
    const ri = AREA_ROWS.findIndex((r) => r.includes(area))
    rowMax[ri] = Math.max(rowMax[ri] || 0, node.getBoundingClientRect().height)
  }
  const seatRowsH = Object.values(rowMax).reduce((s, h) => s + h, 0)
  if (seatRowsH <= 0) return
  const seatScale = scales.seats || 1
  const naturalSeatRowsH = seatRowsH / seatScale
  const fixedH = gridH - seatRowsH
  let target = (heightBudget - fixedH) / naturalSeatRowsH
  target = Math.max(floor.value, Math.min(seatScale, target))
  // Only act when it actually tightens the clamp (avoids a no-op re-render / loop).
  if (target < seatScale - 0.01 && target < heightSeatCeiling - 0.01) {
    heightSeatCeiling = target
    heightPass += 1
    relayout(true)
  }
}

// Received boxes for the bounding-box ledger (display only — never fed to scale).
function recordSizes(el) {
  el.querySelectorAll('[data-region]').forEach((r) => {
    const b = r.getBoundingClientRect()
    sizes[r.getAttribute('data-region')] = { w: Math.round(b.width), h: Math.round(b.height) }
  })
  measureVertical(el)
}

// Vertical accounting (display-only). Resolved row-track heights come straight
// from the grid (`grid-template-rows` computed value — no viewport read, no scale
// feedback); content height per row = the tallest occupied region in it; slack =
// track − content. Stage: total grid height, its slack sum, and the vertical
// BINDING — `shrink-wrap` (content-sized rows: bidding's auto tracks + the designed
// growth reserve) vs `viewport-fill` (the weighted-fr play/review rows, whose
// proportions over-expand under-filled rows into slack). Bottom-packing play flips
// it to shrink-wrap; the slack collapses to the designed reserve.
const SLACK_EPS = 4
// A row area's key in `sizes`: seat areas are keyed 'seat-n' etc.; corners/center by name.
function sizeKeyFor(area) { return ['n', 'e', 's', 'w'].includes(area) ? 'seat-' + area : area }
function measureVertical(el) {
  const topo = ledger.value?.rows
  if (!topo) return
  const trackH = getComputedStyle(el).gridTemplateRows.split(/\s+/).map(parseFloat).filter((n) => !isNaN(n))
  // The stage (center) SPANS rows when it absorbs an empty centre-column seat
  // (n-/s-absorption). Attributing its full box to the single row it's listed in
  // reads as a spurious content>track "overflow" (the trick area is 220px against a
  // 213px row it deliberately spans past) — so measure it against its WHOLE SPAN,
  // and cap its contribution to any one row at that row's track. Genuine per-row
  // overflow (a seat/corner taller than its own track) still surfaces, now labelled
  // 'overflow' (red) — the same vocabulary the columns section uses.
  const centerStart = areaOccupied('n') ? 1 : 0
  const centerEnd = areaOccupied('s') ? 1 : 2
  const centerSpanTrack = trackH.slice(centerStart, centerEnd + 1).reduce((s, t) => s + (t || 0), 0)
  const rows = topo.map((r, i) => {
    const height = Math.round(trackH[i] ?? 0)
    let contentHeight = 0
    let overflow = 0
    for (const a of r.occupied) {
      const ch = sizes[sizeKeyFor(a)]?.h || 0
      if (a === 'center') {
        // Stage: overflow measured against its full span (it can't overflow a row it
        // spans past); its contribution to THIS row's content is capped at the track.
        overflow = Math.max(overflow, ch - centerSpanTrack)
        contentHeight = Math.max(contentHeight, Math.min(ch, height))
      } else {
        contentHeight = Math.max(contentHeight, ch)
        overflow = Math.max(overflow, ch - height)
      }
    }
    contentHeight = Math.round(contentHeight)
    overflow = Math.round(Math.max(0, overflow))
    const slack = Math.max(0, height - contentHeight)
    const vbinding = overflow > SLACK_EPS ? 'overflow' : slack > SLACK_EPS ? 'fill' : 'content'
    return { height, contentHeight, slack, overflow, vbinding }
  })
  const total = Math.round(el.clientHeight)
  const slack = rows.reduce((s, r) => s + r.slack, 0)
  // Anchored (content-sized rows) → shrink-wrap: any residual slack is designed
  // margins, not fr over-expansion. Un-anchored fr rows over-expand → viewport-fill.
  const binding = shrinkWrapRows.value ? 'shrink-wrap' : (slack > SLACK_EPS ? 'viewport-fill' : 'shrink-wrap')
  vert.rows = rows
  vert.stage = { total, content: Math.max(0, total - slack), slack, binding }
}

// Apply a region's scale locally as --table-scale (leaves read it) + expose
// --region-scale for semantics/captions.
function regionStyle(kind) {
  const s = scales[kind] ?? 1
  return { '--table-scale': s, '--region-scale': s }
}

// Publish a seat's ALLOCATED width (px, 1.0×) as --alloc-width so HandDisplay can
// fit its suit rows against the allocation instead of the shrink-wrapped row. The
// seat regions justify-self:center + min-width:0, so a hand's rendered row width is
// its own (possibly compressed) content — measuring the fit target off THAT is
// circular (narrow render → narrow fit → narrow render), which squeezed North to
// ~130px inside a 264px allocation (2026-07-13 report). The allocation is
// content-independent, so it breaks the loop. Legacy/console/server never set this
// var, so HandDisplay falls back to the measured row there. Absent until the first
// ledger lands (0 → no var → fallback).
function seatAllocStyle(seat) {
  const w = ledger.value?.regions?.[seatArea(seat)]?.allocated
  return w > 0 ? { '--alloc-width': w + 'px' } : {}
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
// A window resize can change the HEIGHT budget without changing the grid's width (the
// RO below only sees width). Re-fit from scratch so the height clamp tracks the new
// viewport — this is what makes "measure, don't model" hold as the viewport changes.
function onWindowResize() {
  heightSeatCeiling = Infinity
  heightPass = 0
  relayout(true)
}
// Flipping the preview channel changes the ALLOCATION, so force a fresh width pass —
// otherwise the beetle's live toggle would only take effect on the next resize.
watch(arrangement, () => relayout(true))

onMounted(async () => {
  await nextTick(); relayout(true)
  if (typeof window !== 'undefined') window.addEventListener('resize', onWindowResize)
  if (typeof ResizeObserver === 'undefined' || !root.value) return
  // Watch the grid's OFFERED width only. The grid fills the frame (which doesn't
  // shrink-wrap horizontally), so clientWidth = the shell's budget and is stable;
  // relayout skips when the width is unchanged, so a content/height change (the
  // vertical shrink-wrap) never re-drives the WIDTH scale — the height fit owns that.
  ro = new ResizeObserver(() => relayout())
  ro.observe(root.value)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  if (typeof window !== 'undefined') window.removeEventListener('resize', onWindowResize)
})

// Re-provision when the deal's own inputs change without a width change: the actual
// seat reserve (new hands), which seats are shown, and the phase. `relayout` skips on an
// unchanged budget, so a new deal at the same viewport width would otherwise keep the
// prior ledger. `dealSeatReserve` is pure from props (no scale feedback), so this
// converges in one pass. Also DROP any height clamp: it was fit to the previous content
// (e.g. review's two-hand stack), so it must not carry into a shorter layout (bidding's
// single hand) — otherwise the new hand renders needlessly small. Await a tick so the
// hands have rendered before we re-measure boxes.
watch(
  [dealSeatReserve, () => SEATS.filter(isHandBearing).join(''), () => props.phase],
  async () => { heightSeatCeiling = Infinity; heightPass = 0; await nextTick(); relayout(true) },
)
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
/* The action cluster gets a designed gap on its CENTRE-facing side — a config
   constant (`--action-hand-gap`), per spacing-as-margins-on-occupied. At 'se' (right
   column, bidding box / a South·East hero's controls) the centre is to the LEFT; at
   'sw' (left column, a screen-left defender's Undo·Claim) it's to the RIGHT. */
.grid-table.anchored .area-se { margin-left: var(--action-hand-gap, 14px); }
.grid-table.anchored .area-sw { margin-right: var(--action-hand-gap, 14px); }
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
/* Action corners hold a FIXED-width widget (the bidding box) that shrinks to fit
   its parent, not a scalable hand. `justify-self:*` sizes the cell to content, so
   an over-wide box would push out of its column into the neighbouring seat (a
   South·SE collision, 2026-07-14 report). Cap the cell to its grid TRACK so the
   box's own fit logic (it measures this parent) sees the real column bound and
   shrinks instead of overflowing. */
.area-se, .area-sw { max-width: 100%; }
.seat { display: flex; }

/* Seat identity + HCP sizing, grid-only. The shared HandDisplay/SeatIndicator
   defaults (name 14px, badge 22/13px, HCP 12px) read tiny beside the grid's big
   24px card glyphs. Rick wants the circled compass initial, the player name, and
   the HCP footer sized to ~80% of a card (≈19px) — legible without competing with
   the cards. Scoped to `.region.seat` here (GridArrangement only renders for
   arrangement='grid'), so LEGACY a1 and every other consumer of these components
   stay byte-identical (2026-07-13 report). All ride --table-scale like the leaves
   they sit beside. */
.region.seat :deep(.si-name) { font-size: calc(19px * var(--table-scale)); }
.region.seat :deep(.si-badge) {
  width: calc(30px * var(--table-scale));
  height: calc(30px * var(--table-scale));
  font-size: calc(18px * var(--table-scale));
}
.region.seat :deep(.hcp) { font-size: calc(19px * var(--table-scale)); }

/* Diagnostic overlays (row bands, stage line, collapsed-region legend) are OFF by
   default. The harness's boundingBoxes.css turns them on under
   `html[data-bounding-boxes]` (higher specificity, so it still wins there); in
   PRODUCTION that stylesheet isn't loaded, so without this default-hide the legend
   leaked as raw text under the table (the "collapsed n ne e sw" bug, 2026-07-12).
   These elements are aria-hidden and empty, so hiding them changes nothing else. */
.row-band,
.stage-line,
.bounding-box-legend {
  display: none;
}
</style>

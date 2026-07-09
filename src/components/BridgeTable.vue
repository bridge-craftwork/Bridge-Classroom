<template>
  <div ref="root" class="bridge-table" :class="['size-' + sizeMode, { compact: compact, 'no-center': !hasCenter }]">
    <!-- North - spans all columns -->
    <div class="ns-column north-row">
      <div v-if="!hiddenSeats.includes('N') && hands.N" class="position north">
        <SeatPanel
          :hand="hands.N"
          seat="N"
          :showHcp="showHcp"
          :showTotalPoints="showTotalPoints"
          :clickable="clickableSeat === 'N'"
          :density="seatDensity"
          :marks="marksFor('N')"
          :hidePlayedCards="hidePlayedCards"
          @card-click="(payload) => $emit('card-click', { seat: 'N', ...payload })"
        />
      </div>
    </div>

    <!-- West -->
    <div v-if="!hiddenSeats.includes('W') && hands.W" class="position west">
      <SeatPanel
        :hand="hands.W"
        seat="W"
        :showHcp="showHcp"
        :showTotalPoints="showTotalPoints"
        :clickable="clickableSeat === 'W'"
        :density="seatDensity"
        :marks="marksFor('W')"
        :hidePlayedCards="hidePlayedCards"
        @card-click="(payload) => $emit('card-click', { seat: 'W', ...payload })"
      />
    </div>

    <!-- Center (empty slot for dealer/vul indicator if needed) -->
    <div class="center">
      <slot name="center"></slot>
    </div>

    <!-- East -->
    <div v-if="!hiddenSeats.includes('E') && hands.E" class="position east">
      <SeatPanel
        :hand="hands.E"
        seat="E"
        :showHcp="showHcp"
        :showTotalPoints="showTotalPoints"
        :clickable="clickableSeat === 'E'"
        :density="seatDensity"
        :marks="marksFor('E')"
        :hidePlayedCards="hidePlayedCards"
        @card-click="(payload) => $emit('card-click', { seat: 'E', ...payload })"
      />
    </div>

    <!-- South - spans all columns -->
    <div class="ns-column south-row">
      <div v-if="!hiddenSeats.includes('S') && hands.S" class="position south">
        <SeatPanel
          :hand="hands.S"
          seat="S"
          :showHcp="showHcp"
          :showTotalPoints="showTotalPoints"
          :clickable="clickableSeat === 'S'"
          :density="seatDensity"
          :marks="marksFor('S')"
          :hidePlayedCards="hidePlayedCards"
          @card-click="(payload) => $emit('card-click', { seat: 'S', ...payload })"
        />
      </div>
    </div>

    <!-- Optional SE-corner content (e.g. a post-hand analysis grid). Sits in the
         empty bottom-right cell: same row as South, same column as East. -->
    <div v-if="$slots.corner" class="position corner-se">
      <slot name="corner"></slot>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, useSlots } from 'vue'
import SeatPanel from './SeatPanel.vue'

const props = defineProps({
  hands: {
    type: Object,
    required: true,
    default: () => ({ N: null, E: null, S: null, W: null })
  },
  hiddenSeats: {
    type: Array,
    default: () => []
  },
  showHcp: {
    type: Boolean,
    default: false
  },
  showTotalPoints: {
    type: Boolean,
    default: false
  },
  compact: {
    type: Boolean,
    default: false
  },
  clickableSeat: {
    type: String,
    default: null
  },
  playedCards: {
    type: Object,
    default: null
  },
  hidePlayedCards: {
    type: Boolean,
    default: false
  }
})

defineEmits(['card-click'])

// The center column reserves ~240px for a TrickArea (play view). Bidding/review
// boards pass no #center slot, so that space is dead and squeezes the side hands
// (W/E cramp and wrap ranks when the table is narrow — e.g. beside a docked
// lesson intro). Only reserve the center when the slot is actually filled; when
// empty, hand that width back to W/E (see `.no-center` CSS).
const slots = useSlots()
const hasCenter = computed(() => !!slots.center)

// The arranger: pick a density from the table's OWN width, so it responds inside
// a console tile as well as at the viewport. Ladder — full ≥ 700 (roomy compass,
// unchanged from today); compact 360–700 (smaller cards, all hands still shown);
// chip 280–360 (identity chips in the compass — two fit side-by-side); stack
// < 280 (identity chips in a single full-width column — below this the compass's
// side-by-side W/E chips can't fit and would clip). Starts wide so there's no
// chip-flash before the observer measures. ResizeObserver, never container
// queries (inline-size containment breaks shrink-wrap hosts — see #88).
const root = ref(null)
const width = ref(9999)
let ro = null
onMounted(() => {
  if (typeof ResizeObserver === 'undefined' || !root.value) return
  ro = new ResizeObserver((entries) => { width.value = entries[0].contentRect.width })
  ro.observe(root.value)
})
onBeforeUnmount(() => ro?.disconnect())
// The chip/stack collapse exists only because W (left) + center + E (right) must
// sit side-by-side; the 280/360 thresholds reserve room for that compass. When
// NEITHER side seat is shown (a single N/S hand, or N+S stacked — e.g. a bidding
// board that hides E/W), there is no compass to preserve: one hand column shows
// in full at ~200px. Using the compass ladder there wrongly collapses a lone hand
// to an identity chip ("South 13 cards") whenever its column is narrowed — e.g. a
// docked lesson intro reserving a gutter. So drop to a single-column ladder that
// keeps rendering the cards (only shrinking card size) until the column is truly
// too tight for ranks.
const hasSideSeats = computed(() =>
  (!props.hiddenSeats.includes('W') && !!props.hands.W) ||
  (!props.hiddenSeats.includes('E') && !!props.hands.E)
)
const sizeMode = computed(() => {
  const w = width.value
  if (!hasSideSeats.value) {
    return w < 160 ? 'chip' : w < 700 ? 'compact' : 'full'
  }
  return w < 280 ? 'stack'
    : w < 360 ? 'chip'
    : w < 700 ? 'compact'
    : 'full'
})
// Seat rendering budget: 'stack' and 'chip' are both identity-only (they differ
// only in arrangement), so both map to the SeatPanel 'chip' density.
const seatDensity = computed(() => (sizeMode.value === 'stack' ? 'chip' : sizeMode.value))

// Build a seat's annotation map from the (unchanged) external props: each
// played card code becomes a `played` mark, and the clickable seat carries the
// `active-seat` frame. Codes are normalized to upper-suit + upper-rank ("DT")
// to match HandDisplay's per-card lookup — same match behavior as before.
function marksFor(seat) {
  const cards = {}
  for (const code of props.playedCards?.[seat] || []) {
    cards[code[0].toUpperCase() + code.slice(1).toUpperCase()] = { played: true }
  }
  return { cards, activeSeat: props.clickableSeat === seat }
}
</script>

<style scoped>
.bridge-table {
  display: grid;
  /* Reserve space in the center column so a TrickArea (or any wider center
     content) can render without being clipped by the side hand columns. */
  grid-template-columns: 1fr minmax(240px, auto) 1fr;
  grid-template-rows: auto auto auto;
  gap: 8px;
  padding: 16px;
  min-width: 320px;
}

/* N/S column containers - centered but contents left-aligned */
.ns-column {
  grid-column: 1 / -1;
  display: flex;
  justify-content: center;
}

.ns-column .position {
  /* Hands are left-aligned within the centered container */
}

/* West in left column, aligned right */
.position.west {
  grid-column: 1;
  grid-row: 2;
  justify-self: end;
}

/* Center in middle column */
.center {
  grid-column: 2;
  grid-row: 2;
  min-width: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* East in right column, aligned left */
.position.east {
  grid-column: 3;
  grid-row: 2;
  justify-self: start;
}

/* North row is grid row 1, South row is grid row 3 */
.north-row {
  grid-row: 1;
}

.south-row {
  grid-row: 3;
}

/* SE corner: the empty bottom-right cell (South's row, East's column). South
   spans the full row but its hand is centered, so this cell is visually free. */
.corner-se {
  grid-column: 3;
  grid-row: 3;
  justify-self: start;
  align-self: start;
}

/* Compact mode for desktop two-column layout */
.bridge-table.compact {
  gap: 4px;
  padding: 8px;
  min-width: 280px;
}

/* Container-relative arranger. `size-full` is the roomy compass (unchanged).
   `size-compact` tightens the grid + shrinks the reserved center so the smaller
   hands fit; `size-chip` is a tiny compass of identity chips (console tile). */
.bridge-table.size-compact {
  gap: 6px;
  padding: 10px;
  min-width: 0;
  grid-template-columns: 1fr minmax(150px, auto) 1fr;
}
.bridge-table.size-chip {
  gap: 4px;
  padding: 8px;
  min-width: 0;
  grid-template-columns: auto minmax(0, 1fr) auto;
}

/* Below ~280px two chips can't sit side-by-side in the compass (they'd clip off
   the tile edge), so stack the four identity chips in a single full-width
   column. The center slot is hidden — a monitoring tile this small shows seat
   identity, not a trick area. This is the tile-clipping fix. */
.bridge-table.size-stack {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  min-width: 0;
}
.bridge-table.size-stack .ns-column { display: block; }
.bridge-table.size-stack .position { width: 100%; }
.bridge-table.size-stack .center { display: none; }

/* No #center content (bidding/review boards have no trick area): stop reserving
   the ~240px center column and give that width back to W/E so the side hands
   don't cramp/wrap when the table is narrow. Full + compass-compact only; chip/
   stack are identity-only and already collapse the center. */
.bridge-table.no-center,
.bridge-table.no-center.size-compact {
  grid-template-columns: 1fr auto 1fr;
}
.bridge-table.no-center .center {
  min-width: 0;
}

/* Responsive adjustments */
@media (max-width: 600px) {
  .bridge-table {
    gap: 8px;
    padding: 8px;
    min-width: 260px;
  }
}
</style>

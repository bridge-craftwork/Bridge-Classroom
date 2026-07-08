<template>
  <div ref="root" class="bridge-table" :class="['size-' + sizeMode, { compact: compact }]">
    <!-- North - spans all columns -->
    <div class="ns-column north-row">
      <div v-if="!hiddenSeats.includes('N') && hands.N" class="position north">
        <SeatPanel
          :hand="hands.N"
          seat="N"
          :showHcp="showHcp"
          :showTotalPoints="showTotalPoints"
          :clickable="clickableSeat === 'N'"
          :density="sizeMode"
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
        :density="sizeMode"
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
        :density="sizeMode"
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
          :density="sizeMode"
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
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
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

// The arranger: pick a density from the table's OWN width, so it responds inside
// a console tile as well as at the viewport. Ladder — full ≥ 700 (roomy compass,
// unchanged from today); compact 400–700 (smaller cards, all hands still shown);
// chip < 400 (identity chips only — the console monitoring tile). Starts wide so
// there's no chip-flash before the observer measures.
const root = ref(null)
const width = ref(9999)
let ro = null
onMounted(() => {
  if (typeof ResizeObserver === 'undefined' || !root.value) return
  ro = new ResizeObserver((entries) => { width.value = entries[0].contentRect.width })
  ro.observe(root.value)
})
onBeforeUnmount(() => ro?.disconnect())
const sizeMode = computed(() => (width.value < 360 ? 'chip' : width.value < 700 ? 'compact' : 'full'))

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

/* Responsive adjustments */
@media (max-width: 600px) {
  .bridge-table {
    gap: 8px;
    padding: 8px;
    min-width: 260px;
  }
}
</style>

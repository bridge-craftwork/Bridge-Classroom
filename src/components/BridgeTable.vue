<template>
  <div class="bridge-table" :class="{ compact: compact }">
    <!-- North - spans all columns -->
    <div class="ns-column north-row">
      <div v-if="!hiddenSeats.includes('N') && hands.N" class="position north">
        <HandDisplay
          :hand="hands.N"
          seat="N"
          :showHcp="showHcp"
          :showTotalPoints="showTotalPoints"
          :clickable="clickableSeat === 'N'"
          :playedCards="playedCards?.N"
          :hidePlayedCards="hidePlayedCards"
          @card-click="(payload) => $emit('card-click', { seat: 'N', ...payload })"
        />
      </div>
    </div>

    <!-- West -->
    <div v-if="!hiddenSeats.includes('W') && hands.W" class="position west">
      <HandDisplay
        :hand="hands.W"
        seat="W"
        :showHcp="showHcp"
        :showTotalPoints="showTotalPoints"
        :clickable="clickableSeat === 'W'"
        :playedCards="playedCards?.W"
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
      <HandDisplay
        :hand="hands.E"
        seat="E"
        :showHcp="showHcp"
        :showTotalPoints="showTotalPoints"
        :clickable="clickableSeat === 'E'"
        :playedCards="playedCards?.E"
        :hidePlayedCards="hidePlayedCards"
        @card-click="(payload) => $emit('card-click', { seat: 'E', ...payload })"
      />
    </div>

    <!-- South - spans all columns -->
    <div class="ns-column south-row">
      <div v-if="!hiddenSeats.includes('S') && hands.S" class="position south">
        <HandDisplay
          :hand="hands.S"
          seat="S"
          :showHcp="showHcp"
          :showTotalPoints="showTotalPoints"
          :clickable="clickableSeat === 'S'"
          :playedCards="playedCards?.S"
          :hidePlayedCards="hidePlayedCards"
          @card-click="(payload) => $emit('card-click', { seat: 'S', ...payload })"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import HandDisplay from './HandDisplay.vue'

defineProps({
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

/* Compact mode for desktop two-column layout */
.bridge-table.compact {
  gap: 4px;
  padding: 8px;
  min-width: 280px;
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

<template>
  <!-- Composes seat IDENTITY (SeatChip) with an optional HOLDING (HandDisplay)
       and owns their relationship: the box, the on-turn frame, and the density
       (chip = chip alone; compact/full = chip + hand). The layout-inertness
       obligation (reserved frame width) lives here, not in HandDisplay. -->
  <div class="seat-panel" :class="[{ compact: compactMode, active: activeSeat, chip: density === 'chip' }]">
    <SeatChip
      :seat="seat"
      :name="name"
      :presence="presence"
      :card-count="chipCardCount"
      :compact="compactMode"
    />
    <HandDisplay
      v-if="showHolding"
      :hand="hand"
      :show-hcp="showHcp"
      :show-total-points="showTotalPoints"
      :compact="compactMode"
      :clickable="clickable"
      :marks="marks"
      :density="density"
      :hide-played-cards="hidePlayedCards"
      @card-click="$emit('card-click', $event)"
    />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import SeatChip from './SeatChip.vue'
import HandDisplay from './HandDisplay.vue'

const props = defineProps({
  seat: {
    type: String,
    required: true,
    validator: (v) => ['N', 'E', 'S', 'W'].includes(v),
  },
  hand: { type: Object, default: null },
  // Seat identity (console tiles); table falls back to the compass name.
  name: { type: String, default: null },
  presence: { type: String, default: null },
  // Annotation map. `activeSeat` (seat-level) drives the frame here; per-card
  // marks pass through to HandDisplay.
  marks: { type: Object, default: null },
  showHcp: { type: Boolean, default: false },
  showTotalPoints: { type: Boolean, default: false },
  compact: { type: Boolean, default: false },
  clickable: { type: Boolean, default: false },
  hidePlayedCards: { type: Boolean, default: false },
  // 'chip' → identity only; 'compact' | 'full' → identity + holding.
  density: { type: String, default: 'full' },
  // Hidden seat: no holding shown; the chip carries a card count instead.
  hidden: { type: Boolean, default: false },
})

defineEmits(['card-click'])

const activeSeat = computed(() => !!props.marks?.activeSeat)
// compact sizing comes from the explicit prop OR the 'compact' density rung.
const compactMode = computed(() => props.compact || props.density === 'compact')
// Holding shows at compact/full; 'chip' density (and hidden) drop to identity.
const showHolding = computed(() => !props.hidden && props.density !== 'chip' && !!props.hand)
// The chip carries a card count whenever the holding isn't shown but a hand exists.
const chipCardCount = computed(() => {
  if (!props.hand || (!props.hidden && props.density !== 'chip')) return null
  return ['spades', 'hearts', 'diamonds', 'clubs'].reduce((n, s) => n + (props.hand[s]?.length || 0), 0)
})
</script>

<style scoped>
/* The seat box — reproduces the old HandDisplay `.hand` exactly. Transparent
   border baseline so the on-turn frame never shifts layout. */
.seat-panel {
  background: #f5f5f5;
  border-radius: 8px;
  padding: 12px;
  /* Floor for the compass (≥ 220px containers are unchanged), but never wider
     than the container — so a narrow console tile caps it at 100% instead of
     forcing overflow and clipping the right edge / shoving the centered title. */
  min-width: min(220px, 100%);
  border: 2px solid transparent;
}
.seat-panel.active {
  background: #e3f2fd;
  border-color: #2196f3;
}
.seat-panel.compact {
  padding: 8px;
  min-width: min(180px, 100%);
}
.seat-panel.chip {
  min-width: auto;
}
</style>

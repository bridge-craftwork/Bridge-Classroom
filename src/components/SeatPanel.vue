<template>
  <!-- Composes seat IDENTITY (SeatChip) with an optional HOLDING (HandDisplay)
       and owns their relationship: the box, the on-turn frame, and the density
       (chip = chip alone; compact/full = chip + hand). The layout-inertness
       obligation (reserved frame width) lives here, not in HandDisplay. -->
  <div class="seat-panel" :class="[{ compact, active: activeSeat, chip: density === 'chip' }]">
    <SeatChip
      :seat="seat"
      :name="name"
      :presence="presence"
      :card-count="chipCardCount"
      :compact="compact"
    />
    <HandDisplay
      v-if="showHolding"
      :hand="hand"
      :show-hcp="showHcp"
      :show-total-points="showTotalPoints"
      :compact="compact"
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
const showHolding = computed(() => !props.hidden && props.density !== 'chip' && !!props.hand)
const chipCardCount = computed(() => {
  if (!props.hidden || !props.hand) return null
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
  min-width: 220px;
  border: 2px solid transparent;
}
.seat-panel.active {
  background: #e3f2fd;
  border-color: #2196f3;
}
.seat-panel.compact {
  padding: 8px;
  min-width: 180px;
}
.seat-panel.chip {
  min-width: auto;
}
</style>

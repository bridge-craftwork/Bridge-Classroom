<template>
  <!-- Composes seat IDENTITY (SeatChip) with an optional HOLDING (HandDisplay)
       and owns their relationship: the box, the on-turn frame, and the density
       (chip = chip alone; compact/full = chip + hand). The layout-inertness
       obligation (reserved frame width) lives here, not in HandDisplay. -->
  <div class="seat-panel" :class="[{ compact: compactMode, active: activeSeat, thinking: thinking, chip: density === 'chip' }]">
    <!-- Seat identity. Default = the plain SeatChip label (A1 and every other
         caller). A drag/drop variant (SeatControlTable) injects a grabbable label
         component here — the base itself carries no seat-control code. -->
    <component
      :is="labelComponent || SeatChip"
      :seat="seat"
      :name="name"
      :presence="presence"
      :card-count="chipCardCount"
      :compact="compactMode"
      :you="you"
      v-bind="labelProps"
    />
    <HandDisplay
      v-if="showHolding"
      :hand="hand"
      :show-hcp="showHcp"
      :show-total-points="showTotalPoints"
      :compact="compactMode"
      :clickable="clickable"
      :inspectable="inspectable"
      :marks="marks"
      :density="density"
      :hide-played-cards="hidePlayedCards"
      @card-click="$emit('card-click', $event)"
      @card-inspect="$emit('card-inspect', $event)"
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
  // This seat is the viewer's own (host / your seat) — forwarded to the label so
  // the name ladder can prefer your full/first name over "First L.".
  you: { type: Boolean, default: false },
  // Annotation map. `activeSeat` (seat-level) drives the frame here; per-card
  // marks pass through to HandDisplay.
  marks: { type: Object, default: null },
  showHcp: { type: Boolean, default: false },
  showTotalPoints: { type: Boolean, default: false },
  compact: { type: Boolean, default: false },
  clickable: { type: Boolean, default: false },
  inspectable: { type: Boolean, default: false },
  hidePlayedCards: { type: Boolean, default: false },
  // 'chip' → identity only; 'compact' | 'full' → identity + holding.
  density: { type: String, default: 'full' },
  // Hidden seat: no holding shown; the chip carries a card count instead.
  hidden: { type: Boolean, default: false },
  // Canonical engine phase ('bidding' | 'play' | 'review'), when the host knows
  // it. The card count is phase-dependent (see chipCardCount); null = not told,
  // which keeps the count — the pre-grid BridgeTable compass doesn't thread a
  // phase, and silently blanking its counts would be the worse failure.
  phase: { type: String, default: null },
  // Optional replacement for the SeatChip label (a drag/drop variant injects an
  // interactive label). null → the plain SeatChip. `labelProps` are extra props
  // merged in (context + callbacks); the base never inspects them.
  labelComponent: { type: [Object, Function], default: null },
  labelProps: { type: Object, default: null },
})

defineEmits(['card-click', 'card-inspect'])

const activeSeat = computed(() => !!props.marks?.activeSeat)
// A bot is thinking on this seat (pink frame) — the counterpart to `active`
// (blue) for a human's turn. `active` wins if both are somehow set.
const thinking = computed(() => !activeSeat.value && !!props.marks?.thinking)
// compact sizing comes from the explicit prop OR the 'compact' density rung.
const compactMode = computed(() => props.compact || props.density === 'compact')
// Holding shows at compact/full; 'chip' density (and hidden) drop to identity.
const showHolding = computed(() => !props.hidden && props.density !== 'chip' && !!props.hand)
// The chip carries a card count whenever the holding isn't shown but a hand exists.
const chipCardCount = computed(() => {
  if (!props.hand || (!props.hidden && props.density !== 'chip')) return null
  // During the auction nobody has played a card, so every unseen hand reads
  // "13 cards" — true, constant, and telling the reader nothing (roadmap
  // 2026-07-30 §2.2). The count earns its place once cards start leaving hands.
  //
  // Suppress on the PHASE, never on `n === 13`: at trick one a defender legitimately
  // still holds 13, and that reading is informative precisely because its
  // neighbours are already down to 12.
  if (props.phase === 'bidding') return null
  const n = ['spades', 'hearts', 'diamonds', 'clubs'].reduce((t, s) => t + (props.hand[s]?.length || 0), 0)
  // An undealt-for-display seat (empty {} hand) reads 0 — suppress it rather than
  // render "0 cards" (grid-arranger fix 3). A real hidden hand still counts.
  return n || null
})
</script>

<style scoped>
/* The seat box — reproduces the old HandDisplay `.hand` exactly. Transparent
   border baseline so the on-turn frame never shifts layout. */
.seat-panel {
  background: #f5f5f5;
  border-radius: 8px;
  padding: calc(12px * var(--table-scale));
  /* Floor for the compass (≥ 220px containers are unchanged), but never wider
     than the container — so a narrow console tile caps it at 100% instead of
     forcing overflow and clipping the right edge / shoving the centered title. */
  min-width: min(calc(220px * var(--table-scale)), 100%);
  border: 2px solid transparent;
}
.seat-panel.active {
  background: #e3f2fd;
  border-color: #2196f3;
}
/* A bot is thinking on this seat (e.g. BEN on the opening lead) — pink, the
   counterpart to the blue "your turn" frame. */
.seat-panel.thinking {
  background: #fdecf2;
  border-color: #f06292;
}
.seat-panel.compact {
  padding: calc(8px * var(--table-scale));
  min-width: min(calc(180px * var(--table-scale)), 100%);
}
.seat-panel.chip {
  min-width: auto;
}
</style>

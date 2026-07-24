<template>
  <!-- Seat IDENTITY: who sits here, not what they hold. Renders with or without
       a hand attached — the console tile's resting state ("S  Rick Wilson ●") is
       just a chip. In the table it reproduces the old .seat-label header. -->
  <div class="seat-chip" :class="{ compact, 'is-turn': turn, reserved }">
    <!-- Named occupant (multiplayer): badge + player name above the hand, like
         BBO/Intobridge. No name (A1 / solo / bots) → the plain compass label. -->
    <SeatIndicator
      v-if="name"
      :seat="seat"
      :name="name"
      :turn="turn"
      :you="you"
      align="start"
      :connected="presence === 'connected' ? true : presence === 'disconnected' ? false : null"
    >
      <span v-if="cardCount != null" class="seat-count">{{ cardCount }} card{{ cardCount === 1 ? '' : 's' }}</span>
    </SeatIndicator>
    <template v-else>
      <span class="seat-name">{{ label }}</span>
      <span v-if="cardCount != null" class="seat-count">{{ cardCount }} card{{ cardCount === 1 ? '' : 's' }}</span>
      <span
        v-if="presence"
        class="seat-dot"
        :class="'seat-dot-' + presence"
        :title="presence === 'connected' ? 'connected' : 'disconnected'"
      ></span>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { getSeatName } from '../utils/cardFormatting.js'
import SeatIndicator from './SeatIndicator.vue'

const props = defineProps({
  seat: {
    type: String,
    required: true,
    validator: (v) => ['N', 'E', 'S', 'W'].includes(v),
  },
  // Occupant name (console). Falls back to the compass name ("North") — the
  // table's default identity.
  name: { type: String, default: null },
  // 'connected' | 'disconnected' — a presence dot; null in the table.
  presence: { type: String, default: null },
  // On-turn hint on the chip itself (SeatPanel owns the frame). Off in the table.
  turn: { type: Boolean, default: false },
  // Cards left, shown when the hand is hidden. null when a hand is displayed.
  cardCount: { type: Number, default: null },
  compact: { type: Boolean, default: false },
  // This seat belongs to the viewer (host / your own seat) → the name ladder
  // shows your full name then your first name, and highlights it as "you".
  you: { type: Boolean, default: false },
  // Held for an invited friend who hasn't joined yet (Phase 4) → a pending
  // (amber) treatment so it reads as not-yet-seated.
  reserved: { type: Boolean, default: false },
})

const label = computed(() => props.name || getSeatName(props.seat))
</script>

<style scoped>
/* Table identity: reproduces the old .seat-label exactly. */
.seat-chip {
  font-weight: bold;
  font-size: calc(21px * var(--table-scale));
  color: #333;
  margin-bottom: calc(8px * var(--table-scale));
  text-align: center;
}
.seat-chip.compact {
  font-size: calc(18px * var(--table-scale));
  margin-bottom: calc(4px * var(--table-scale));
}
.seat-count {
  font-size: calc(12px * var(--table-scale));
  font-weight: 500;
  color: #666;
  margin-left: calc(8px * var(--table-scale));
}
.seat-dot {
  display: inline-block;
  width: calc(8px * var(--table-scale));
  height: calc(8px * var(--table-scale));
  border-radius: 50%;
  margin-left: calc(6px * var(--table-scale));
  vertical-align: middle;
}
.seat-dot-connected { background: #1d9e75; }
.seat-dot-disconnected { background: #c0c4c0; }
.seat-chip.is-turn .seat-name { color: #1565c0; }

/* Pending reservation (invited friend not yet joined): amber, italic. */
.seat-chip.reserved :deep(.si-name),
.seat-chip.reserved .seat-name { color: #b45309; font-style: italic; }
.seat-chip.reserved :deep(.si-badge) {
  background: #fdebcb;
  color: #b45309;
  box-shadow: inset 0 0 0 1px #e6c88a;
}
</style>

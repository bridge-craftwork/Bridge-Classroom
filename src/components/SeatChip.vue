<template>
  <!-- Seat IDENTITY: who sits here, not what they hold. Renders with or without
       a hand attached — the console tile's resting state ("S  Rick Wilson ●") is
       just a chip. In the table it reproduces the old .seat-label header. -->
  <div class="seat-chip" :class="{ compact, 'is-turn': turn }">
    <!-- Named occupant (multiplayer): badge + player name above the hand, like
         BBO/Intobridge. No name (A1 / solo / bots) → the plain compass label. -->
    <SeatIndicator
      v-if="name"
      :seat="seat"
      :name="name"
      :turn="turn"
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
})

const label = computed(() => props.name || getSeatName(props.seat))
</script>

<style scoped>
/* Table identity: reproduces the old .seat-label exactly. */
.seat-chip {
  font-weight: bold;
  font-size: 21px;
  color: #333;
  margin-bottom: 8px;
  text-align: center;
}
.seat-chip.compact {
  font-size: 18px;
  margin-bottom: 4px;
}
.seat-count {
  font-size: 12px;
  font-weight: 500;
  color: #666;
  margin-left: 8px;
}
.seat-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-left: 6px;
  vertical-align: middle;
}
.seat-dot-connected { background: #1d9e75; }
.seat-dot-disconnected { background: #c0c4c0; }
.seat-chip.is-turn .seat-name { color: #1565c0; }
</style>

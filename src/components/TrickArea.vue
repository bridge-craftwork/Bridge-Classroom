<template>
  <div class="trick-area" :class="{ inactive: !active }">
    <div v-if="active" class="trick-grid">
      <!-- N -->
      <div class="slot slot-n" :class="{ 'is-next': nextSeat === 'N' }">
        <div class="card" v-if="cardForSeat('N')">
          <span :class="suitClass(cardForSeat('N').suit)">{{ suitSymbol(cardForSeat('N').suit) }}</span>{{ formatRank(cardForSeat('N').rank) }}
        </div>
      </div>
      <!-- W -->
      <div class="slot slot-w" :class="{ 'is-next': nextSeat === 'W' }">
        <div class="card" v-if="cardForSeat('W')">
          <span :class="suitClass(cardForSeat('W').suit)">{{ suitSymbol(cardForSeat('W').suit) }}</span>{{ formatRank(cardForSeat('W').rank) }}
        </div>
      </div>
      <!-- Center: trick counter / bot status -->
      <div class="slot slot-center">
        <div class="counter">NS&nbsp;{{ tricksTaken.NS }} · EW&nbsp;{{ tricksTaken.EW }}</div>
        <div v-if="botLoading" class="bot-thinking">{{ botName ? `${botName} thinking…` : 'Thinking…' }}</div>
        <div v-else-if="lastWinner" class="last-winner">Trick to {{ lastWinner }}</div>
      </div>
      <!-- E -->
      <div class="slot slot-e" :class="{ 'is-next': nextSeat === 'E' }">
        <div class="card" v-if="cardForSeat('E')">
          <span :class="suitClass(cardForSeat('E').suit)">{{ suitSymbol(cardForSeat('E').suit) }}</span>{{ formatRank(cardForSeat('E').rank) }}
        </div>
      </div>
      <!-- S -->
      <div class="slot slot-s" :class="{ 'is-next': nextSeat === 'S' }">
        <div class="card" v-if="cardForSeat('S')">
          <span :class="suitClass(cardForSeat('S').suit)">{{ suitSymbol(cardForSeat('S').suit) }}</span>{{ formatRank(cardForSeat('S').rank) }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { SUIT_SYMBOLS, formatCard } from '../utils/cardFormatting.js'

const props = defineProps({
  // { leader, plays: [{ seat, suit, rank }] }
  currentTrick: { type: Object, required: true },
  // Last completed trick — shown briefly between tricks. { leader, plays, winner }
  lastFinishedTrick: { type: Object, default: null },
  tricksTaken: { type: Object, default: () => ({ NS: 0, EW: 0 }) },
  // Seat to play next (for visual cue).
  nextSeat: { type: String, default: null },
  botLoading: { type: Boolean, default: false },
  botName: { type: String, default: '' },
  active: { type: Boolean, default: true },
})

// Show the lastFinishedTrick cards if present (during the inter-trick pause),
// otherwise show currentTrick.plays.
const visiblePlays = computed(() => {
  if (props.lastFinishedTrick) return props.lastFinishedTrick.plays
  return props.currentTrick?.plays || []
})

const lastWinner = computed(() => props.lastFinishedTrick?.winner || null)

function cardForSeat(seat) {
  return visiblePlays.value.find(p => p.seat === seat)
}

function suitSymbol(suit) {
  return SUIT_SYMBOLS[suit] || suit
}

function suitClass(suit) {
  return (suit === 'H' || suit === 'D') ? 'suit-red' : 'suit-black'
}

function formatRank(rank) {
  return formatCard(rank)
}
</script>

<style scoped>
.trick-area {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 220px;
  padding: 0 8px;  /* clearance from adjacent E/W hand panels */
}
.trick-area.inactive {
  display: none;
}

.trick-grid {
  display: grid;
  /* Fixed-width side columns sized to the actual card box (~50px) so the
     trick area doesn't over-claim space and force layout shifts. Center
     column flexes to fit the trick counter / status. */
  grid-template-columns: 56px 1fr 56px;
  grid-template-rows: minmax(48px, auto) minmax(48px, auto) minmax(48px, auto);
  gap: 6px;
  width: 200px;
}

.slot {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
}
.slot-n { grid-column: 2; grid-row: 1; }
.slot-w { grid-column: 1; grid-row: 2; }
.slot-center { grid-column: 2; grid-row: 2; flex-direction: column; gap: 4px; color: #666; text-align: center; }
.slot-e { grid-column: 3; grid-row: 2; }
.slot-s { grid-column: 2; grid-row: 3; }

.slot.is-next .card {
  outline: 1.5px solid #1D9E75;
  outline-offset: 2px;
}
.slot:not(:has(.card)).is-next::after {
  content: '·';
  color: #1D9E75;
  font-size: 28px;
  line-height: 1;
}

.card {
  background: #fff;
  border: 0.5px solid #bbb;
  border-radius: 4px;
  padding: 6px 10px;
  font-weight: 500;
  font-size: 20px;
  white-space: nowrap;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  letter-spacing: 1px;
}

.suit-red { color: #d32f2f; }
.suit-black { color: #222; }

.counter {
  font-variant-numeric: tabular-nums;
  color: #555;
  font-weight: 500;
  font-size: 14px;
  line-height: 1.3;
}
.bot-thinking {
  color: #1D9E75;
  font-style: italic;
  font-size: 11px;
}
.last-winner {
  color: #1D9E75;
  font-size: 11px;
  font-weight: 500;
}
</style>

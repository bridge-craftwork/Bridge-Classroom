<template>
  <div class="hand" :class="{ hidden: hidden, compact: compact, minimal: minimal, clickable: clickable, 'hide-played': hidePlayedCards }">
    <!-- Minimal mode: just suit symbols in a row (for hidden E/W on desktop) -->
    <template v-if="minimal && hidden">
      <div class="minimal-hand">
        <span class="seat-label-inline">{{ seat }}</span>
        <span v-for="suit in suits" :key="suit" class="suit-symbol-inline" :class="suitClass(suit)">{{ suitSymbol(suit) }}</span>
      </div>
    </template>

    <!-- Normal/compact mode -->
    <template v-else>
      <div class="seat-label">{{ seatName }}</div>
      <div v-if="!hidden && hand" class="suits">
        <!-- For partial hands (showcards), only show suits that have cards -->
        <template v-for="suit in suits" :key="suit">
          <div v-if="!isPartialHand || hasSuitCards(suit)" class="suit-row">
            <span class="suit-symbol" :class="suitClass(suit)">{{ suitSymbol(suit) }}</span>
            <!-- Clickable mode: render each card as a separate clickable span -->
            <span v-if="clickable" class="cards clickable-cards">
              <span
                v-for="card in hand[suit]"
                :key="card"
                :class="isCardPlayed(suit, card) ? 'card-played' : 'card-clickable'"
                @click="!isCardPlayed(suit, card) && $emit('card-click', { suit: suitLetter(suit), rank: card })"
              >{{ formatCard(card) }}</span>
            </span>
            <!-- Non-clickable mode: individual spans when there are played cards -->
            <span v-else-if="hasPlayedCards" class="cards">
              <span
                v-for="card in hand[suit]"
                :key="card"
                :class="{ 'card-played': isCardPlayed(suit, card) }"
              >{{ formatCard(card) }}</span>
            </span>
            <!-- Non-clickable mode: plain text -->
            <span v-else class="cards">{{ formatSuitCards(suit) }}</span>
          </div>
        </template>
      </div>
      <div v-else-if="hidden" class="hidden-hand">
        <div class="card-back"></div>
      </div>
      <div v-if="showHcp && hand && !hidden && !isPartialHand" class="hcp">
        <template v-if="showTotalPoints && lengthPts > 0">{{ hcp }}+{{ lengthPts }} TP</template>
        <template v-else>{{ hcp }} HCP</template>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import {
  SUIT_SYMBOLS,
  SUIT_ORDER,
  getSuitClass,
  formatCard,
  countHCP,
  getSeatName
} from '../utils/cardFormatting.js'

const props = defineProps({
  hand: {
    type: Object,
    default: null
  },
  seat: {
    type: String,
    required: true,
    validator: (v) => ['N', 'E', 'S', 'W'].includes(v)
  },
  hidden: {
    type: Boolean,
    default: false
  },
  showHcp: {
    type: Boolean,
    default: false
  },
  showTotalPoints: {
    // When true and lengthPts > 0, display "X+Y TP" instead of "X HCP".
    type: Boolean,
    default: false
  },
  compact: {
    type: Boolean,
    default: false
  },
  minimal: {
    type: Boolean,
    default: false
  },
  clickable: {
    type: Boolean,
    default: false
  },
  playedCards: {
    type: Array,
    default: null
  },
  // When true, cards already played disappear from the hand entirely (matches
  // real-bridge default where played cards are turned face-down). When false,
  // they show with strike-through styling — useful as a teaching mode and as
  // a post-deal review state.
  hidePlayedCards: {
    type: Boolean,
    default: false
  }
})

defineEmits(['card-click'])

const suits = SUIT_ORDER

const seatName = computed(() => getSeatName(props.seat))

const hcp = computed(() => countHCP(props.hand))

// Length points: 1 per card over 4 in any suit.
const lengthPts = computed(() => {
  if (!props.hand) return 0
  let lp = 0
  for (const suit of suits) {
    const len = (props.hand[suit] || []).length
    if (len > 4) lp += len - 4
  }
  return lp
})

// Count total cards in hand - partial hands (showcards) have fewer than 5 cards
const totalCards = computed(() => {
  if (!props.hand) return 0
  return suits.reduce((sum, suit) => sum + (props.hand[suit]?.length || 0), 0)
})

// A partial hand shows only played cards (from showcards directive)
// Don't show empty suits for partial hands - dashes would imply voids
const isPartialHand = computed(() => totalCards.value > 0 && totalCards.value < 5)

function hasSuitCards(suit) {
  return props.hand && props.hand[suit] && props.hand[suit].length > 0
}

function suitSymbol(suit) {
  return SUIT_SYMBOLS[suit]
}

function suitClass(suit) {
  return getSuitClass(suit)
}

// Map suit name to single letter for card-click events
const SUIT_LETTERS = { spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' }
function suitLetter(suit) {
  return SUIT_LETTERS[suit] || suit
}

function formatSuitCards(suit) {
  if (!props.hand || !props.hand[suit]) return '—'
  const cards = props.hand[suit]
  if (cards.length === 0) return '—'
  return cards.map(formatCard).join(' ')
}

// playedCards is an array like ['SK', 'H3'] — card codes from showcards for this seat
const hasPlayedCards = computed(() => props.playedCards && props.playedCards.length > 0)

// Build a Set of "suit:rank" keys for O(1) lookup
const playedCardSet = computed(() => {
  if (!props.playedCards) return null
  const set = new Set()
  for (const code of props.playedCards) {
    const suit = code[0].toUpperCase()
    const rank = code.slice(1).toUpperCase()
    const suitName = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' }[suit]
    if (suitName) set.add(`${suitName}:${rank}`)
  }
  return set
})

function isCardPlayed(suit, rank) {
  if (!playedCardSet.value) return false
  return playedCardSet.value.has(`${suit}:${rank}`)
}
</script>

<style scoped>
.hand {
  background: #f5f5f5;
  border-radius: 8px;
  padding: 12px;
  min-width: 220px;  /* Wide enough to align N/S hands consistently */
  /* Transparent baseline so toggling .clickable doesn't shift layout. */
  border: 2px solid transparent;
}

.seat-label {
  font-weight: bold;
  font-size: 21px;
  color: #333;
  margin-bottom: 8px;
  text-align: center;
}

.suits {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.suit-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'Segoe UI', system-ui, sans-serif;
  font-size: 24px;
}

.suit-symbol {
  font-size: 27px;
  width: 28px;
  text-align: center;
}

.suit-red {
  color: #d32f2f;
}

.suit-black {
  color: #1a1a1a;
}

.cards {
  font-weight: 500;
  letter-spacing: 1px;
}

/* Played card (already led/played in a previous trick) */
.card-played {
  opacity: 0.4;
  text-decoration: line-through;
  cursor: default;
  padding: 2px 6px;
  user-select: none;
}

/* Clickable cards mode (border color only — baseline is always rendered
   so toggling clickable doesn't reflow surrounding layout). */
.hand.clickable {
  background: #e3f2fd;
  border-color: #2196f3;
}

/* "Cards turned face-down after play" mode. Default during live cardplay.
   When off (the strike-through view), played cards stay visible — useful
   as a teaching mode and as the post-deal review state. */
.hand.hide-played .card-played {
  display: none;
}

.clickable-cards {
  display: flex;
  gap: 2px;
}

.card-clickable {
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: background 0.15s, transform 0.1s;
  user-select: none;
}

.card-clickable:hover {
  background: #bbdefb;
  transform: scale(1.1);
}

.card-clickable:active {
  background: #90caf9;
  transform: scale(0.95);
}

.hidden-hand {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 80px;
}

.card-back {
  width: 50px;
  height: 70px;
  background: linear-gradient(135deg, #1565c0, #0d47a1);
  border-radius: 4px;
  border: 2px solid #fff;
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
}

.hcp {
  margin-top: 8px;
  text-align: center;
  font-size: 12px;
  color: #666;
}

.hand.hidden {
  opacity: 0.7;
}

/* Compact mode - smaller padding and fonts */
.hand.compact {
  padding: 8px;
  min-width: 180px;
}

.hand.compact .seat-label {
  font-size: 18px;
  margin-bottom: 4px;
}

.hand.compact .suit-row {
  font-size: 21px;
  gap: 6px;
}

.hand.compact .suit-symbol {
  font-size: 24px;
  width: 24px;
}

/* Minimal mode - just suit symbols in a row (for hidden E/W) */
.hand.minimal {
  background: transparent;
  padding: 4px 8px;
  min-width: auto;
}

.minimal-hand {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 24px;
}

.seat-label-inline {
  font-weight: bold;
  color: #666;
  margin-right: 4px;
}

.suit-symbol-inline {
  font-size: 27px;
}
</style>

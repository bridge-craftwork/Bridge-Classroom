<template>
  <div class="hand" :class="[densityClass, { hidden: hidden, compact: compact, minimal: minimal, 'active-seat': activeSeat, 'hide-played': hidePlayedCards }]">
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
            <!-- One DOM cell per card, one tight layout for every context: cells
                 separated by real spaces. `played` (strikethrough / collapse) and
                 `interactive` (cursor + subtle highlight) are modifiers that DON'T
                 change a cell's geometry — so a hand's cards never reflow when it
                 gains or loses the turn (the active-seat jitter). Badge/fill are
                 harness-only placeholder channels. -->
            <span class="cards"><template v-for="(card, i) in orderedHand[suit]" :key="card"><span
              class="cell"
              :class="cellClass(suit, card)"
              :style="cellFill(suit, card)"
              @click="clickable && !isCardPlayed(suit, card) && $emit('card-click', { suit: suitLetter(suit), rank: card })"
            >{{ formatCard(card) }}<span v-if="cardBadge(suit, card)" class="cell-badge">{{ cardBadge(suit, card) }}</span></span>{{ i < orderedHand[suit].length - 1 ? ' ' : '' }}</template></span>
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
  getSeatName,
  sortSuitDescending
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
  // Interaction only: makes cells clickable (cursor + card-click emit). The
  // on-turn FRAME is a separate concern — the `active-seat` mark (see below).
  clickable: {
    type: Boolean,
    default: false
  },
  // Annotation map (Slice 3). Two marks are wired:
  //   cards: { <code>: { played, badge, fill } }  — per-card, keyed by "SK"/"DT"
  //   activeSeat: bool                             — seat-level on-turn frame
  // `played` renders as the strikethrough/collapse; `badge`/`fill` are generic
  // placeholder channels for future marks (rendered on the individual-cell
  // paths only). Producers never emit badge/fill in production today.
  marks: {
    type: Object,
    default: null
  },
  // Rendering budget: 'chip' | 'compact' | 'full'. Only 'full' is wired now
  // (renders as today); the density-specific budgets arrive with later slices.
  density: {
    type: String,
    default: 'full'
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

// Cards ordered for display (A→2 per suit) regardless of the source's order —
// so a deal loaded low-to-high (e.g. BBO save/replay ?pbn=) still shows right.
// Display-only: HCP/length/played-card logic all key off rank, not position.
const orderedHand = computed(() => {
  if (!props.hand) return props.hand
  const out = {}
  for (const suit of suits) out[suit] = sortSuitDescending(props.hand[suit] || [])
  return out
})

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

// Map suit name to single letter for card-click events + mark codes
const SUIT_LETTERS = { spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' }
function suitLetter(suit) {
  return SUIT_LETTERS[suit] || suit
}

const densityClass = computed(() => `density-${props.density}`)
const activeSeat = computed(() => !!props.marks?.activeSeat)

// Per-card annotation lookup, keyed by code ("SK", "DT", …).
function cardMark(suit, rank) {
  return props.marks?.cards?.[suitLetter(suit) + rank] || null
}
function isCardPlayed(suit, rank) {
  return !!cardMark(suit, rank)?.played
}
function cardBadge(suit, rank) {
  return cardMark(suit, rank)?.badge || null
}
function cellFill(suit, rank) {
  const fill = cardMark(suit, rank)?.fill
  return fill ? { backgroundColor: fill } : null
}
// A cell's modifiers. `played` and `interactive` add no box geometry (only
// strikethrough/opacity and cursor/highlight), so cells occupy the same space
// whether or not the hand is on turn — that's the layout-inertness guarantee.
// `has-badge` turns on `position: relative` only where a badge exists.
function cellClass(suit, rank) {
  return {
    played: isCardPlayed(suit, rank),
    interactive: props.clickable && !isCardPlayed(suit, rank),
    'has-badge': !!cardBadge(suit, rank),
  }
}
</script>

<style scoped>
.hand {
  background: #f5f5f5;
  border-radius: 8px;
  padding: 12px;
  min-width: 220px;  /* Wide enough to align N/S hands consistently */
  /* Transparent baseline so toggling the frame doesn't shift layout. */
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

/* One card. The base cell is a plain inline run (no box model), so plain-mode
   cells render exactly like the old space-joined text; modes layer padding /
   marks on top. */
.cell {
  display: inline;
}

/* Played card (already led/played in a previous trick). Strikethrough + fade
   only — no padding, so a struck cell keeps its geometry (review) and, in live
   play, collapses to nothing (below) without disturbing the tight layout. */
.cell.played {
  opacity: 0.4;
  text-decoration: line-through;
  cursor: default;
  user-select: none;
}

/* active-seat mark: the on-turn frame (was the `.hand.clickable` frame). */
.hand.active-seat {
  background: #e3f2fd;
  border-color: #2196f3;
}

/* "Cards turned face-down after play" mode. Default during live cardplay: the
   played cell collapses out (adjacent spaces coalesce), so the remaining shape
   reads true. When off (review/teaching) the struck card stays visible. */
.hand.hide-played .cell.played {
  display: none;
}

/* Interaction only: cursor + a subtle highlight. Geometry-free (no padding /
   flex / transform), so the hand's cards sit in exactly the same place whether
   or not it's this seat's turn — no reflow when the turn moves. */
.cell.interactive {
  cursor: pointer;
  border-radius: 3px;
  transition: background 0.15s;
  user-select: none;
}

.cell.interactive:hover {
  background: #bbdefb;
}

.cell.interactive:active {
  background: #90caf9;
}

/* Placeholder channels for future marks (harness / full-everything only — no
   producer emits badge/fill in production, so real cells never grow one). */
.cell.has-badge {
  position: relative;
}
.cell-badge {
  position: absolute;
  top: -7px;
  right: -3px;
  font-size: 10px;
  line-height: 1;
  font-weight: 700;
  letter-spacing: 0;
  color: #fff;
  background: #6a1b9a;
  border-radius: 8px;
  padding: 1px 4px;
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

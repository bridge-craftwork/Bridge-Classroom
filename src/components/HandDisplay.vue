<template>
  <!-- Pure holding renderer: cards + marks + HCP. No compass, name, presence, or
       turn state — those are seat identity (SeatChip). Geometry is a function of
       holding + marks + density, so it renders anywhere a holding appears,
       including with no seat at all (lesson combination illustrations, reveals).
       SeatPanel supplies the box + frame in the table. -->
  <div class="holding" :class="[densityClass, { compact, 'hide-played': hidePlayedCards }]">
    <div v-if="hand" class="suits">
      <!-- For partial holdings (showcards), only show suits that have cards -->
      <template v-for="suit in suits" :key="suit">
        <div v-if="!isPartialHand || hasSuitCards(suit)" class="suit-row" :style="suitRowStyle(suit)">
          <span class="suit-symbol" :class="suitClass(suit)">{{ suitSymbol(suit) }}</span>
          <!-- One DOM cell per card, one tight layout; `played` / `interactive`
               are geometry-free modifiers (no reflow when the turn moves). -->
          <span class="cards"><template v-for="(card, i) in orderedHand[suit]" :key="card"><span
            class="cell"
            :class="cellClass(suit, card)"
            :style="cellFill(suit, card)"
            @click="clickable && !isCardPlayed(suit, card) && $emit('card-click', { suit: suitLetter(suit), rank: card })"
          >{{ formatCard(card) }}<span v-if="cardBadge(suit, card)" class="cell-badge">{{ cardBadge(suit, card) }}</span></span>{{ i < orderedHand[suit].length - 1 ? ' ' : '' }}</template></span>
        </div>
      </template>
    </div>
    <div v-if="showHcp && hand && !isPartialHand" class="hcp">
      <template v-if="showTotalPoints && lengthPts > 0">{{ hcp }}+{{ lengthPts }} TP</template>
      <template v-else>{{ hcp }} HCP</template>
    </div>
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
  sortSuitDescending
} from '../utils/cardFormatting.js'

const props = defineProps({
  hand: {
    type: Object,
    default: null
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
  // Interaction only: makes cells clickable (cursor + card-click emit).
  clickable: {
    type: Boolean,
    default: false
  },
  // Annotation map: cards: { <code>: { played, badge, fill } } — per-card, keyed
  // by "SK"/"DT". (Seat-level marks like active-seat live on SeatPanel now.)
  marks: {
    type: Object,
    default: null
  },
  // Rendering budget: 'chip' | 'compact' | 'full'. Only 'full' wired (= today).
  density: {
    type: String,
    default: 'full'
  },
  // When true, played cards collapse out of the holding (live-play default);
  // when false they stay struck through (review / teaching).
  hidePlayedCards: {
    type: Boolean,
    default: false
  }
})

defineEmits(['card-click'])

const suits = SUIT_ORDER

// Cards ordered for display (A→2 per suit) regardless of the source's order.
const orderedHand = computed(() => {
  if (!props.hand) return props.hand
  const out = {}
  for (const suit of suits) out[suit] = sortSuitDescending(props.hand[suit] || [])
  return out
})

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

// Count total cards - partial hands (showcards) have fewer than 5.
const totalCards = computed(() => {
  if (!props.hand) return 0
  return suits.reduce((sum, suit) => sum + (props.hand[suit]?.length || 0), 0)
})
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

const SUIT_LETTERS = { spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' }
function suitLetter(suit) {
  return SUIT_LETTERS[suit] || suit
}

const densityClass = computed(() => `density-${props.density}`)

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
function cellClass(suit, rank) {
  return {
    played: isCardPlayed(suit, rank),
    interactive: props.clickable && !isCardPlayed(suit, rank),
    'has-badge': !!cardBadge(suit, rank),
  }
}

// Cards actually rendered in a suit row (collapsed played cards don't take
// width when hidePlayedCards is on), which is what compression must fit.
function renderedCount(suit) {
  const cards = orderedHand.value?.[suit] || []
  if (!props.hidePlayedCards) return cards.length
  return cards.filter((c) => !isCardPlayed(suit, c)).length
}

// Per-suit horizontal compression instead of wrapping. A suit of ≤7 cards
// renders at its natural width (scale 1 → PIXEL-IDENTICAL to before); 8–10
// compress to the reserved 7-card width; 11+ hold at a ~0.65 floor and let the
// row grow into the arranger's slack rather than shrinking further. The factor
// rides on the row as --suit-scale, multiplying the card font-size and
// letter-spacing only — the suit symbol and row height are untouched.
function suitScale(suit) {
  const n = renderedCount(suit)
  if (n <= 7) return 1
  return Math.max(0.65, 7 / n)
}
function suitRowStyle(suit) {
  const s = suitScale(suit)
  // No inline var for ≤7 rows — CSS falls back to var(--suit-scale, 1), so the
  // DOM (and render) is unchanged for the 99.5% case.
  return s === 1 ? null : { '--suit-scale': s }
}
</script>

<style scoped>
.suits {
  display: flex;
  flex-direction: column;
  gap: calc(4px * var(--table-scale));
}

.suit-row {
  display: flex;
  align-items: center;
  gap: calc(8px * var(--table-scale));
  font-family: 'Segoe UI', system-ui, sans-serif;
  /* --suit-scale (per row, default 1) compresses long suits horizontally
     instead of wrapping — see suitScale(). At 1 this is calc(...*1) = today. */
  font-size: calc(24px * var(--table-scale) * var(--suit-scale, 1));
}

.suit-symbol {
  font-size: calc(27px * var(--table-scale));
  width: calc(28px * var(--table-scale));
  text-align: center;
}

.suit-red { color: #d32f2f; }
.suit-black { color: #1a1a1a; }

.cards {
  font-weight: 500;
  /* nowrap: long suits never wrap to a second line (the "reads as 5-1" bug) —
     they compress via --suit-scale instead. letter-spacing scales with the row
     so an 8–10 suit fits the reserved 7-card width. At scale 1 = 1px (today). */
  white-space: nowrap;
  letter-spacing: calc(1px * var(--suit-scale, 1));
}

/* One card. Plain inline run (no box model), tight space-joined layout. */
.cell {
  display: inline;
}

/* Played card — strikethrough + fade only (no geometry). Collapses out in
   live play (below); stays struck in review. */
.cell.played {
  opacity: 0.4;
  text-decoration: line-through;
  cursor: default;
  user-select: none;
}
.holding.hide-played .cell.played {
  display: none;
}

/* Interaction only: cursor + subtle highlight, geometry-free (no reflow when
   the turn moves). */
.cell.interactive {
  cursor: pointer;
  border-radius: 3px;
  transition: background 0.15s;
  user-select: none;
}
.cell.interactive:hover { background: #bbdefb; }
.cell.interactive:active { background: #90caf9; }

/* Placeholder channels for future marks (harness-only). */
.cell.has-badge { position: relative; }
.cell-badge {
  position: absolute;
  top: -7px;
  right: -3px;
  font-size: calc(10px * var(--table-scale));
  line-height: 1;
  font-weight: 700;
  letter-spacing: 0;
  color: #fff;
  background: #6a1b9a;
  border-radius: 8px;
  padding: calc(1px * var(--table-scale)) calc(4px * var(--table-scale));
}
/* The top suit row has no row above it to overlap into, so a badge at top:-7px
   paints above the holding and clips. Drop just that row's badges down onto the
   card. (Badges are harness-only marks — no production hand paints one, so this
   is pixel-identical in prod.) */
.suit-row:first-child .cell-badge {
  top: 2px;
}

.hcp {
  margin-top: calc(8px * var(--table-scale));
  text-align: center;
  font-size: calc(12px * var(--table-scale));
  color: #666;
}

/* Compact — smaller card sizing (SeatPanel shrinks the box + SeatChip). */
.holding.compact .suit-row {
  font-size: calc(21px * var(--table-scale) * var(--suit-scale, 1));
  gap: calc(6px * var(--table-scale));
}
.holding.compact .suit-symbol {
  font-size: calc(24px * var(--table-scale));
  width: calc(24px * var(--table-scale));
}
</style>

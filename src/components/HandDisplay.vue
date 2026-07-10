<template>
  <!-- Pure holding renderer: cards + marks + HCP. No compass, name, presence, or
       turn state — those are seat identity (SeatChip). Geometry is a function of
       holding + marks + density, so it renders anywhere a holding appears.

       In-grid suit rows NEVER wrap and NEVER clip: a row is always exactly one
       line tall. When a suit is too long for its measured content zone even at
       the legibility floor, the leftmost cards that fit render and the row ends
       in a "+N" chip (the low cards of the suit — rendering is high→low). No
       capability is lost: the hidden cards stay viewable/selectable through the
       floating CardSelectorPopup, which floats above the layout and may wrap
       freely without pushing anything. SeatPanel supplies the box + frame. -->
  <div ref="rootEl" class="holding" :class="[densityClass, { compact, 'hide-played': hidePlayedCards }]">
    <div v-if="hand" class="suits">
      <template v-for="suit in suits" :key="suit">
        <div
          v-if="!isPartialHand || hasSuitCards(suit)"
          class="suit-row"
          :class="{ truncated: hiddenCount(suit) > 0, tappable: clickable && hiddenCount(suit) > 0 }"
          :style="rowStyle(suit)"
          :ref="el => setRowRef(suit, el)"
          @click="clickable && hiddenCount(suit) > 0 && openPopup(suit)"
        >
          <span class="suit-symbol" :class="suitClass(suit)">{{ suitSymbol(suit) }}</span>
          <span class="cards" :ref="el => setCardsRef(suit, el)"><template v-for="(card, i) in visibleRanks(suit)" :key="card"><span
            class="cell"
            :class="cellClass(suit, card)"
            :style="cellFill(suit, card)"
            @click.stop="clickable && !isCardPlayed(suit, card) && $emit('card-click', { suit: suitLetter(suit), rank: card })"
          >{{ formatCard(card) }}<span v-if="cardBadge(suit, card)" class="cell-badge">{{ cardBadge(suit, card) }}</span></span>{{ i < visibleRanks(suit).length - 1 ? ' ' : '' }}</template><span
            v-if="hiddenCount(suit) > 0"
            class="cell chip"
            @click.stop="clickable ? openPopup(suit) : null"
          > +{{ hiddenCount(suit) }}<span v-if="hiddenMarked(suit)" class="chip-dot">•</span></span></span>
        </div>
      </template>
    </div>
    <div v-if="showHcp && hand && !isPartialHand" class="hcp">
      <template v-if="showTotalPoints && lengthPts > 0">{{ hcp }}+{{ lengthPts }} TP</template>
      <template v-else>{{ hcp }} HCP</template>
    </div>
    <!-- Hidden probe: each suit's FULL rendered cards + a worst-case chip at
         natural scale (1), one line. Its per-cell geometry is `needed` for the
         fit/truncation computation — stable regardless of the visible row's
         applied scale. Off-flow + hidden, so it never affects the holding. -->
    <div v-if="hand" class="hd-probe" aria-hidden="true">
      <template v-for="suit in suits" :key="'p' + suit">
        <div v-if="!isPartialHand || hasSuitCards(suit)" class="suit-row">
          <span class="suit-symbol">{{ suitSymbol(suit) }}</span>
          <span class="cards" :ref="el => setProbeRef(suit, el)"><template v-for="(card, i) in renderedRanks(suit)" :key="card"><span class="cell">{{ formatCard(card) }}</span>{{ i < renderedRanks(suit).length - 1 ? ' ' : '' }}</template></span>
          <span class="cell chip chip-probe" :ref="el => setChipRef(suit, el)"> +13</span>
        </div>
      </template>
    </div>
    <CardSelectorPopup
      v-if="popupSuit"
      :suit="popupSuit"
      :cards="popupCards"
      :anchor="popupAnchor"
      @select="onPopupSelect"
      @close="popupSuit = null"
    />
  </div>
</template>

<script setup>
import { computed, reactive, ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import {
  SUIT_SYMBOLS,
  SUIT_ORDER,
  getSuitClass,
  formatCard,
  countHCP,
  sortSuitDescending
} from '../utils/cardFormatting.js'
import CardSelectorPopup from './CardSelectorPopup.vue'
import { computeFit, LEGIBILITY_FLOOR } from '../utils/handFit.js'

const props = defineProps({
  hand: { type: Object, default: null },
  showHcp: { type: Boolean, default: false },
  // When true and lengthPts > 0, display "X+Y TP" instead of "X HCP".
  showTotalPoints: { type: Boolean, default: false },
  compact: { type: Boolean, default: false },
  // Interaction only: makes cells clickable (cursor + card-click emit).
  clickable: { type: Boolean, default: false },
  // Annotation map: cards: { <code>: { played, badge, fill } } — per-card, keyed
  // by "SK"/"DT". (Seat-level marks like active-seat live on SeatPanel now.)
  marks: { type: Object, default: null },
  // Rendering budget: 'chip' | 'compact' | 'full'. Only 'full' wired (= today).
  density: { type: String, default: 'full' },
  // When true, played cards collapse out of the holding (live-play default);
  // when false they stay struck through (review / teaching).
  hidePlayedCards: { type: Boolean, default: false }
})

const emit = defineEmits(['card-click'])

const suits = SUIT_ORDER

// Cards ordered for display (A→2 per suit) regardless of the source's order.
const orderedHand = computed(() => {
  if (!props.hand) return props.hand
  const out = {}
  for (const suit of suits) out[suit] = sortSuitDescending(props.hand[suit] || [])
  return out
})

const hcp = computed(() => countHCP(props.hand))

const lengthPts = computed(() => {
  if (!props.hand) return 0
  let lp = 0
  for (const suit of suits) {
    const len = (props.hand[suit] || []).length
    if (len > 4) lp += len - 4
  }
  return lp
})

const totalCards = computed(() => {
  if (!props.hand) return 0
  return suits.reduce((sum, suit) => sum + (props.hand[suit]?.length || 0), 0)
})
const isPartialHand = computed(() => totalCards.value > 0 && totalCards.value < 5)

function hasSuitCards(suit) {
  return props.hand && props.hand[suit] && props.hand[suit].length > 0
}
function suitSymbol(suit) { return SUIT_SYMBOLS[suit] }
function suitClass(suit) { return getSuitClass(suit) }

const SUIT_LETTERS = { spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' }
function suitLetter(suit) { return SUIT_LETTERS[suit] || suit }

const densityClass = computed(() => `density-${props.density}`)

function cardMark(suit, rank) {
  return props.marks?.cards?.[suitLetter(suit) + rank] || null
}
function isCardPlayed(suit, rank) { return !!cardMark(suit, rank)?.played }
function cardBadge(suit, rank) { return cardMark(suit, rank)?.badge || null }
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

// Ranks actually rendered in-grid for a suit: all of them, minus the played
// cards that collapse out in live play (hidePlayedCards). This is the set
// truncation operates on — playing a card removes it here, which only ever
// FREES width, so a formerly-hidden card can surface (monotone).
function renderedRanks(suit) {
  const cards = orderedHand.value?.[suit] || []
  if (!props.hidePlayedCards) return cards
  return cards.filter((c) => !isCardPlayed(suit, c))
}

// ── Measured per-row fit + truncation (math in ../utils/handFit) ────────────
const fit = reactive({})
const rootEl = ref(null)
const rowEls = {}
const cardsEls = {}
const probeEls = {}
const chipEls = {}
function setRowRef(suit, el) { if (el) rowEls[suit] = el; else delete rowEls[suit] }
function setCardsRef(suit, el) { if (el) cardsEls[suit] = el; else delete cardsEls[suit] }
function setProbeRef(suit, el) { if (el) probeEls[suit] = el; else delete probeEls[suit] }
function setChipRef(suit, el) { if (el) chipEls[suit] = el; else delete chipEls[suit] }

function rowStyle(suit) {
  const s = fit[suit]?.scale
  return s == null || s === 1 ? null : { '--suit-scale': s }
}
function hiddenCount(suit) { return fit[suit]?.hidden || 0 }
function visibleRanks(suit) {
  const list = renderedRanks(suit)
  const v = fit[suit]?.visible
  return v == null ? list : list.slice(0, v)
}
function hiddenMarked(suit) {
  const list = renderedRanks(suit)
  const v = fit[suit]?.visible ?? list.length
  return list.slice(v).some((c) => !!cardMark(suit, c))
}

function measure() {
  if (!props.hand) return
  for (const suit of suits) {
    const rowEl = rowEls[suit]
    const cardsEl = cardsEls[suit]
    const probeEl = probeEls[suit]
    if (!rowEl || !cardsEl || !probeEl) { if (fit[suit]) delete fit[suit]; continue }
    const probeLeft = probeEl.getBoundingClientRect().left
    const cells = probeEl.querySelectorAll('.cell')
    // cumWidths[i] = natural width of the first (i+1) cards (right edge of cell).
    const cumWidths = Array.from(cells).map((c) => c.getBoundingClientRect().right - probeLeft)
    // available = row width minus the fixed label zone (cards' left offset).
    const rowRect = rowEl.getBoundingClientRect()
    const cardsRect = cardsEl.getBoundingClientRect()
    const available = rowRect.width - (cardsRect.left - rowRect.left)
    const chipReserve = chipEls[suit] ? chipEls[suit].getBoundingClientRect().width : 0
    fit[suit] = computeFit({ cumWidths, available, chipReserve, floor: LEGIBILITY_FLOOR })
  }
}

let ro = null
onMounted(async () => {
  await nextTick()
  measure()
  const el = rootEl.value?.parentElement || rootEl.value
  if (typeof ResizeObserver === 'undefined' || !el) return
  ro = new ResizeObserver(() => measure())
  ro.observe(el)
})
onBeforeUnmount(() => ro?.disconnect())
watch(() => [props.hand, props.density, props.compact, props.hidePlayedCards, props.marks], async () => {
  await nextTick(); measure()
}, { deep: true })

// ── Card-selector popup (reaches the truncated cards) ───────────────────────
const popupSuit = ref(null)
const popupAnchor = ref(null)
const popupCards = computed(() => {
  if (!popupSuit.value) return []
  return (orderedHand.value?.[popupSuit.value] || []).map((rank) => ({
    rank,
    played: isCardPlayed(popupSuit.value, rank),
    badge: cardBadge(popupSuit.value, rank),
    fill: cellFill(popupSuit.value, rank)?.backgroundColor || null,
  }))
})
function openPopup(suit) {
  if (!props.clickable || hiddenCount(suit) === 0) return
  const rowEl = rowEls[suit]
  if (rowEl) {
    const r = rowEl.getBoundingClientRect()
    popupAnchor.value = { top: r.bottom + window.scrollY + 4, left: r.left + window.scrollX }
  }
  popupSuit.value = suit
}
function onPopupSelect(rank) {
  const suit = popupSuit.value
  if (!suit || isCardPlayed(suit, rank)) return
  emit('card-click', { suit: suitLetter(suit), rank })
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
  /* --suit-scale (per row, default 1) compresses long suits horizontally to
     fit; below the floor the row truncates + shows a +N chip (never wraps or
     clips). At 1 this is calc(...*1) = today. */
  font-size: calc(24px * var(--table-scale) * var(--suit-scale, 1));
}
.suit-row.tappable { cursor: pointer; }

.suit-symbol {
  font-size: calc(27px * var(--table-scale));
  width: calc(28px * var(--table-scale));
  text-align: center;
  flex: 0 0 auto;
}

.suit-red { color: #d32f2f; }
.suit-black { color: #1a1a1a; }

.cards {
  min-width: 0;
  font-weight: 500;
  /* Always one line: compression + truncation keep it fitting, so it never
     wraps. letter-spacing scales with the row so a compressed suit fits. */
  white-space: nowrap;
  letter-spacing: calc(1px * var(--suit-scale, 1));
}

/* One card. Plain inline run (no box model), tight space-joined layout. */
.cell { display: inline; }

/* +N truncation chip: a content-zone cell that scales with the row. Muted so
   the real cards dominate. Inert on non-clickable hands (must not steal the
   console tile's whole-surface click-through); a tap target on clickable. */
.cell.chip {
  color: #7a7f78;
  font-weight: 600;
  pointer-events: none;
}
.suit-row.tappable .cell.chip { pointer-events: auto; cursor: pointer; }
.cell.chip .chip-dot { color: #6a1b9a; font-size: 0.8em; vertical-align: 0.15em; }

.cell.played {
  opacity: 0.4;
  text-decoration: line-through;
  cursor: default;
  user-select: none;
}
.holding.hide-played .cell.played { display: none; }

.cell.interactive {
  cursor: pointer;
  border-radius: 3px;
  transition: background 0.15s;
  user-select: none;
}
.cell.interactive:hover { background: #bbdefb; }
.cell.interactive:active { background: #90caf9; }

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
.suit-row:first-child .cell-badge { top: 2px; }

.hcp {
  margin-top: calc(8px * var(--table-scale));
  text-align: center;
  font-size: calc(12px * var(--table-scale));
  color: #666;
}

.holding.compact .suit-row {
  font-size: calc(21px * var(--table-scale) * var(--suit-scale, 1));
  gap: calc(6px * var(--table-scale));
}
.holding.compact .suit-symbol {
  font-size: calc(24px * var(--table-scale));
  width: calc(24px * var(--table-scale));
}

/* Hidden natural-width probe — off-flow, unpainted, never affects layout. */
.hd-probe {
  position: absolute;
  left: -9999px;
  top: 0;
  visibility: hidden;
  pointer-events: none;
  white-space: nowrap;
}
</style>

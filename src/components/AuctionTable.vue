<template>
  <div class="auction-table">
    <div class="header">
      <div class="header-cell">W</div>
      <div class="header-cell">N</div>
      <div class="header-cell">E</div>
      <div class="header-cell">S</div>
    </div>
    <div class="rounds">
      <div v-for="(round, roundIdx) in rounds" :key="roundIdx" class="round">
        <div
          v-for="(bid, bidIdx) in round"
          :key="bidIdx"
          class="bid-cell"
          :class="{
            'current-turn': isCurrentTurn(roundIdx, bidIdx),
            'wrong-bid': isWrongBid(roundIdx, bidIdx),
            'correct-bid': isCorrectBid(roundIdx, bidIdx),
            'stacked': bid && divergedBids[getBidIndexFromPosition(roundIdx, bidIdx)],
          }"
          @mouseenter="bid ? hoveredIdx = getBidIndexFromPosition(roundIdx, bidIdx) : null"
          @mouseleave="hoveredIdx = null"
        >
          <template v-if="bid && divergedBids[getBidIndexFromPosition(roundIdx, bidIdx)]">
            <div
              v-for="kind in ['user', 'bba']"
              :key="kind"
              class="stacked-row"
              :class="{
                rejected: divergedBids[getBidIndexFromPosition(roundIdx, bidIdx)][kind] !== bid,
                clickable: allowDivergenceToggle,
              }"
              @click.stop="allowDivergenceToggle && $emit('toggle-bid', getBidIndexFromPosition(roundIdx, bidIdx))"
            >
              <span class="stacked-marker">{{ divergedBids[getBidIndexFromPosition(roundIdx, bidIdx)][kind] === bid ? '●' : '○' }}</span>
              <span class="stacked-label">{{ kind === 'user' ? 'You' : 'BBA' }}:</span>
              <span class="stacked-bid" v-html="formatBidHtml(divergedBids[getBidIndexFromPosition(roundIdx, bidIdx)][kind])"></span>
            </div>
          </template>
          <span v-else-if="bid" v-html="formatBidHtml(bid)"></span>
          <span v-else-if="showTurnIndicator && isCurrentTurn(roundIdx, bidIdx)" class="turn-indicator">?</span>
          <div
            v-if="bid && hoveredIdx === getBidIndexFromPosition(roundIdx, bidIdx) && tooltipFor(getBidIndexFromPosition(roundIdx, bidIdx))"
            class="bid-tooltip"
            v-html="tooltipFor(getBidIndexFromPosition(roundIdx, bidIdx))"
          ></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { formatBid } from '../utils/cardFormatting.js'
import { getSeatOrder } from '../utils/pbnParser.js'

const hoveredIdx = ref(null)

// Render BBOalert suit codes (!C !D !H !S) as colored unicode symbols.
function formatMeaningHtml(text) {
  const escaped = text.replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
  return escaped
    .replace(/!C/gi, '<span class="t-suit-c">&clubs;</span>')
    .replace(/!D/gi, '<span class="t-suit-d">&diams;</span>')
    .replace(/!H/gi, '<span class="t-suit-h">&hearts;</span>')
    .replace(/!S/gi, '<span class="t-suit-s">&spades;</span>')
}

// Useless meanings to skip: empty, natural/pass/double/redouble, or repeating the bid.
function isMeaningfulText(text, bid) {
  if (!text) return false
  const t = text.trim()
  if (!t) return false
  const lower = t.toLowerCase()
  if (lower === 'natural' || lower === 'pass' || lower === 'double' || lower === 'redouble') return false
  if (t === bid) return false
  return true
}

const props = defineProps({
  bids: {
    type: Array,
    default: () => []
  },
  dealer: {
    type: String,
    default: 'N'
  },
  currentBidIndex: {
    type: Number,
    default: -1
  },
  wrongBidIndex: {
    type: Number,
    default: -1
  },
  wrongBidIndices: {
    // Optional alternative to wrongBidIndex that highlights multiple wrong bids.
    type: Array,
    default: () => []
  },
  correctBidIndex: {
    type: Number,
    default: -1
  },
  showTurnIndicator: {
    type: Boolean,
    default: false
  },
  meanings: {
    // Optional [{position, bid, meaning, isAlert}, ...]; enables per-cell hover tooltip.
    type: Array,
    default: () => []
  },
  divergedBids: {
    // Optional map: { idx: { user: 'X', bba: 'Y' } } — when present, renders both
    // bids stacked in the cell with the rejected one struck-through.
    type: Object,
    default: () => ({})
  },
  allowDivergenceToggle: {
    // When true, clicking a stacked bid emits `toggle-bid` so the parent can
    // swap which is live. Off by default — toggling is only safe in review.
    type: Boolean,
    default: false
  }
})

defineEmits(['toggle-bid'])

const seatOrder = computed(() => getSeatOrder(props.dealer))

// Figure out which column the dealer is in (0-3 for W-N-E-S display order)
const dealerColumn = computed(() => {
  const displayOrder = ['W', 'N', 'E', 'S']
  return displayOrder.indexOf(props.dealer)
})

const rounds = computed(() => {
  const result = []
  const bids = props.bids

  // First round might not have all 4 bids if dealer isn't West
  let bidIdx = 0
  let roundNum = 0

  while (bidIdx < bids.length || (roundNum === 0 && bids.length > 0)) {
    const round = [null, null, null, null]

    // Determine starting column for this round
    const startCol = roundNum === 0 ? dealerColumn.value : 0

    for (let col = startCol; col < 4 && bidIdx < bids.length; col++) {
      round[col] = bids[bidIdx]
      bidIdx++
    }

    // Only add round if it has any bids
    if (round.some(b => b !== null)) {
      result.push(round)
    }

    roundNum++

    // Safety break
    if (roundNum > 20) break
  }

  // Add an empty round for current turn indicator if needed
  if (props.currentBidIndex >= bids.length) {
    const lastRound = result[result.length - 1]
    const filledCount = lastRound ? lastRound.filter(b => b !== null).length : 0
    const startCol = result.length === 1 ? dealerColumn.value : 0
    const expectedNextCol = (startCol + filledCount) % 4

    if (filledCount === 4 || (result.length > 1 && filledCount === 4)) {
      // Need a new round
      const newRound = [null, null, null, null]
      result.push(newRound)
    }
  }

  return result
})

function getBidIndexFromPosition(roundIdx, colIdx) {
  if (roundIdx === 0) {
    return colIdx - dealerColumn.value
  }
  // First round has (4 - dealerColumn) bids
  const firstRoundBids = 4 - dealerColumn.value
  return firstRoundBids + (roundIdx - 1) * 4 + colIdx
}

function isCurrentTurn(roundIdx, colIdx) {
  const bidIdx = getBidIndexFromPosition(roundIdx, colIdx)
  return bidIdx === props.currentBidIndex && bidIdx >= props.bids.length
}

function isWrongBid(roundIdx, colIdx) {
  const bidIdx = getBidIndexFromPosition(roundIdx, colIdx)
  if (props.wrongBidIndices && props.wrongBidIndices.includes(bidIdx)) return true
  if (props.wrongBidIndex < 0) return false
  return bidIdx === props.wrongBidIndex
}

function isCorrectBid(roundIdx, colIdx) {
  if (props.correctBidIndex < 0) return false
  const bidIdx = getBidIndexFromPosition(roundIdx, colIdx)
  return bidIdx === props.correctBidIndex
}

function formatBidHtml(bid) {
  return formatBid(bid).html
}

// Returns HTML-ready tooltip content, or '' to suppress the tooltip entirely.
// Prefers the longer `meaningExtended` (richer context: point ranges, suit
// lengths, etc.) when BBA returns it; falls back to the short `meaning`.
function tooltipFor(bidIdx) {
  if (!props.meanings || !props.meanings.length) return ''
  const m = props.meanings.find(x => x.position === bidIdx)
  if (!m) return ''
  const raw = m.meaningExtended || m.meaning
  if (!raw) return ''
  const text = raw.trim()
  const bid = props.bids[bidIdx]
  if (!isMeaningfulText(text, bid)) return ''
  return formatMeaningHtml(text)
}
</script>

<style scoped>
.auction-table {
  background: #fff;
  border: 2px solid #333;
  border-radius: 4px;
  overflow: hidden;
  min-width: 200px;
}

/* Header and every round share ONE set of four rigid column tracks. Because the
   tracks are defined on the grid container (not inferred from each row's
   content), a wide cell — e.g. a stacked "you vs BBA" bid — can never widen its
   column and skew the row. `minmax(0, 1fr)` (paired with min-width:0 on the
   cells) lets an over-wide cell shrink back into its quarter instead of pushing
   the others out. Divergence then costs HEIGHT (a taller cell), never width. */
.header {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  background: #333;
  color: white;
}

.header-cell {
  min-width: 0;
  text-align: center;
  padding: 8px 4px;
  font-weight: bold;
  font-size: 14px;
}

.rounds {
  display: flex;
  flex-direction: column;
}

.round {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border-bottom: 1px solid #ddd;
}

.round:last-child {
  border-bottom: none;
}

.bid-cell {
  min-width: 0;
  text-align: center;
  padding: 8px 4px;
  font-size: 16px;
  min-height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-right: 1px solid #eee;
  position: relative;
}

.bid-tooltip {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  background: #fffbe6;
  color: #222;
  padding: 6px 10px;
  border: 1px solid #d4c97a;
  border-radius: 4px;
  font-size: 13px;
  line-height: 1.45;
  white-space: pre-line;
  pointer-events: none;
  z-index: 20;
  min-width: 90px;
  max-width: 240px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.18);
}

.bid-tooltip::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 5px solid transparent;
  border-top-color: #d4c97a;
}

.bid-tooltip :deep(.t-suit-c),
.bid-tooltip :deep(.t-suit-s) { color: #1a1a1a; }
.bid-tooltip :deep(.t-suit-d),
.bid-tooltip :deep(.t-suit-h) { color: #d32f2f; }

.bid-cell:last-child {
  border-right: none;
}

.bid-cell :deep(.red) {
  color: #d32f2f;
}

.bid-cell :deep(.double) {
  color: #ff5722;
  font-weight: bold;
}

.bid-cell :deep(.redouble) {
  color: #2196f3;
  font-weight: bold;
}

.turn-indicator {
  color: #007bff;
  font-weight: bold;
  font-size: 20px;
  animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.current-turn {
  background: #e3f2fd;
}

/* Stacked-bid display when both user's and BBA's bids are shown together */
.bid-cell.stacked {
  flex-direction: column;
  padding: 4px 6px;
  font-size: 13px;
  gap: 1px;
}

.stacked-row {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  justify-content: center;
}

.stacked-row.clickable {
  cursor: pointer;
  border-radius: 3px;
  padding: 1px 4px;
}

.stacked-row.clickable:hover {
  background: rgba(0, 0, 0, 0.05);
}

.stacked-row.rejected .stacked-bid {
  text-decoration: line-through;
  text-decoration-color: #b00;
  text-decoration-thickness: 2px;
  opacity: 0.6;
}

.stacked-marker {
  font-size: 10px;
  color: #1D9E75;
  width: 10px;
  display: inline-block;
}

.stacked-row.rejected .stacked-marker {
  color: #888;
}

.stacked-label {
  font-size: 10px;
  color: #666;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.wrong-bid {
  background: #ffcdd2;
  box-shadow: inset 0 0 0 2px #ef5350;
}

.correct-bid {
  background: #c8e6c9;
}
</style>

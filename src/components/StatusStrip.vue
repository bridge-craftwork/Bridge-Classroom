<template>
  <!-- Phase-aware reference indicators. Bidding: dealer + vulnerability. Play:
       contract + tricks-vs-target (contract-relative) with a minimal vul glyph.
       Review: contract + result. Fed by useTableStatus — no raw state here. -->
  <div class="status-strip" :class="['phase-' + status.phase, 'density-' + density]">
    <!-- Pre-contract (bidding): the board · dealer · vul glyph replaces the pill
         stack — unless we're at chip density, where the text pills read better than
         a shrunk glyph (item 3, specimen-decided fallback). -->
    <template v-if="!status.contract">
      <VulDiamond v-if="density !== 'chip'" :board="board" :dealer="status.dealer" :vul="status.vul" />
      <template v-else>
        <span class="chip chip-board" v-if="board != null">Board <strong>{{ board }}</strong></span>
        <span class="chip chip-dealer">Dealer <strong>{{ status.dealer || '—' }}</strong></span>
        <span class="chip chip-vul" :class="vulClass">{{ vulLabel }}</span>
      </template>
    </template>

    <!-- Contract known (play/review): the identity chip + a vul glyph/pill. -->
    <template v-else>
      <span class="chip chip-contract">
        <span class="ct" v-html="contractHtml"></span><span v-if="contractDbl" class="dbl">{{ contractDbl }}</span>
        <span v-if="status.declarer" class="by">by {{ status.declarer }}</span>
      </span>
      <span v-if="status.phase === 'play'" class="vul-dot" :class="vulClass" :title="vulTitle"></span>
      <span v-else class="chip chip-vul" :class="vulClass">{{ vulLabel }}</span>
    </template>

    <!-- Play: how the declaring side is tracking toward the contract. -->
    <span v-if="status.phase === 'play' && status.tricks.target != null" class="chip chip-tricks">
      <strong>{{ status.declaringSide }} {{ declaringTricks }}</strong>
      <span class="need">· needs {{ status.tricks.target }}</span>
    </span>

    <!-- Review: the result. -->
    <span
      v-if="status.phase === 'review' && status.result"
      class="chip chip-result"
      :class="status.result.made ? 'made' : 'down'"
    >{{ resultLabel }}</span>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { formatBid } from '../utils/cardFormatting.js'
import VulDiamond from './VulDiamond.vue'

const props = defineProps({
  // The object from useTableStatus: { phase, dealer, vul, contract, declarer,
  // declaringSide, tricks: { ns, ew, target }, result }.
  status: { type: Object, required: true },
  // Board number — folded into the pre-contract vul-diamond glyph (item 3).
  board: { type: [Number, String], default: null },
  // 'md' shows the vul-diamond glyph; 'chip' falls back to text pills (tile width).
  density: { type: String, default: 'md' },
})

// Split off any doubling suffix so formatBid renders the base contract (colored
// suit symbol) and the X / XX rides alongside.
const contractParts = computed(() => {
  const m = /^([1-7])(NT|N|[CDHS])(XX|X)?$/i.exec((props.status.contract || '').trim())
  if (!m) return { base: props.status.contract || '', dbl: '' }
  const base = m[1] + (m[2].toUpperCase() === 'N' ? 'NT' : m[2].toUpperCase())
  return { base, dbl: (m[3] || '').toUpperCase() }
})
const contractHtml = computed(() => formatBid(contractParts.value.base).html)
const contractDbl = computed(() => contractParts.value.dbl)

const declaringTricks = computed(() =>
  props.status.declaringSide === 'NS' ? props.status.tricks.ns : props.status.tricks.ew,
)

const VUL = {
  None: { label: 'None vul', cls: 'vul-none', title: 'Neither side vulnerable' },
  NS: { label: 'NS vul', cls: 'vul-ns', title: 'North–South vulnerable' },
  EW: { label: 'EW vul', cls: 'vul-ew', title: 'East–West vulnerable' },
  All: { label: 'All vul', cls: 'vul-all', title: 'Both sides vulnerable' },
  Both: { label: 'All vul', cls: 'vul-all', title: 'Both sides vulnerable' },
}
const vul = computed(() => VUL[props.status.vul] || VUL.None)
const vulLabel = computed(() => vul.value.label)
const vulClass = computed(() => vul.value.cls)
const vulTitle = computed(() => vul.value.title)

const resultLabel = computed(() => {
  const r = props.status.result
  if (!r) return ''
  if (r.delta === 0) return 'Made exactly'
  if (r.delta > 0) return `Made +${r.delta}`
  return `Down ${-r.delta}`
})
</script>

<style scoped>
.status-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: calc(8px * var(--table-scale));
  font-family: 'DM Sans', system-ui, sans-serif;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: calc(6px * var(--table-scale));
  font-size: calc(13px * var(--table-scale));
  font-weight: 600;
  color: #4a5550;
  background: #eef1ee;
  border-radius: 999px;
  padding: calc(4px * var(--table-scale)) calc(12px * var(--table-scale));
  white-space: nowrap;
}
.chip-contract {
  color: #fff;
  background: #1d9e75;
  font-size: calc(15px * var(--table-scale));
}
.chip-contract .ct :deep(.red) { color: #ffe3e0; }
.chip-contract .dbl { font-weight: 800; letter-spacing: 0.02em; }
.chip-contract .by { font-weight: 500; opacity: 0.9; }
.chip-dealer strong { color: #223; }

/* Vulnerability — pill in bidding/review, glyph in play. */
.chip-vul.vul-ns, .chip-vul.vul-ew, .chip-vul.vul-all { color: #b1352a; background: #fbe6e3; }
.chip-vul.vul-none { color: #5b665f; background: #eef1ee; }
.vul-dot {
  width: calc(10px * var(--table-scale)); height: calc(10px * var(--table-scale)); border-radius: 50%;
  background: #c8cec9; flex: none;
}
.vul-dot.vul-ns, .vul-dot.vul-ew, .vul-dot.vul-all { background: #d43f30; }

.chip-tricks { background: #e4f0ff; color: #2c4a63; }
.chip-tricks strong { color: #17324a; }
.chip-tricks .need { font-weight: 500; opacity: 0.85; }

.chip-result.made { color: #fff; background: #1d9e75; }
.chip-result.down { color: #fff; background: #c0392b; }
</style>

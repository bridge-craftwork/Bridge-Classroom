<template>
  <!-- The teacher's claim at one table: a director's ruling that ends the play.
       Three amounts, worked out here in the teacher's browser by bridge-solver
       (WASM), always in this order — claimable ≤ makable ≤ all:
         Claimable — what the side can guarantee without seeing the hidden cards
                     (the most a player's own claim could have been)
         Makable   — best play by both sides on the actual cards (double dummy)
         All       — every remaining trick, no check
       The table service applies the chosen number unchecked. -->
  <div class="tcm">
    <div class="tcm-title">Claim at {{ name }}</div>
    <div class="tcm-side" role="radiogroup" aria-label="Claim for">
      <button
        v-for="opt in sides"
        :key="opt.key"
        class="tcm-side-btn"
        :class="{ 'tcm-side-on': side === opt.key }"
        role="radio"
        :aria-checked="side === opt.key"
        @click="side = opt.key"
      >{{ opt.label }}</button>
    </div>
    <div class="tcm-options">
      <button
        class="tcm-opt"
        :disabled="options.claimable == null"
        title="What they can guarantee without seeing the hidden cards"
        @click="choose(options.claimable)"
      >
        <span class="tcm-opt-name">Claimable</span>
        <span class="tcm-opt-n">{{ fmt(options.claimable, options.claimableUndecided) }}</span>
      </button>
      <button
        class="tcm-opt"
        :disabled="options.makable == null"
        title="Best play by both sides on the actual cards (double dummy)"
        @click="choose(options.makable)"
      >
        <span class="tcm-opt-name">Makable</span>
        <span class="tcm-opt-n">{{ fmt(options.makable) }}</span>
      </button>
      <button
        class="tcm-opt"
        :disabled="!position"
        title="Every remaining trick"
        @click="choose(remaining)"
      >
        <span class="tcm-opt-name">All</span>
        <span class="tcm-opt-n">{{ remaining }}</span>
      </button>
    </div>
    <p class="tcm-hint">
      <template v-if="error">Couldn't work out Claimable / Makable ({{ error }}); All still works.</template>
      <template v-else-if="loading">Working it out&hellip;</template>
      <template v-else>Tricks for {{ sideLabel }}, of the {{ remaining }} still to play.</template>
    </p>
    <button class="tcm-cancel" @click="$emit('close')">Cancel</button>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { buildClaimPosition } from '../../utils/claimPosition.js'
import { getSolverClient } from '../../utils/solverClient.js'

const SEAT_ORDER = ['N', 'E', 'S', 'W']
const PAIR = { N: 'N/S', S: 'N/S', E: 'E/W', W: 'E/W' }

const props = defineProps({
  // One table from the lobby frame (deal, contract, plays, tricks).
  t: { type: Object, required: true },
  name: { type: String, default: 'this table' },
  // The solver client (injectable for tests).
  solver: { type: Object, default: null },
})
const emit = defineEmits(['claim', 'close'])

const side = ref('declarer')
const declarer = computed(() => props.t.contract?.declarer || null)
const claimer = computed(() => {
  if (!declarer.value) return null
  return side.value === 'declarer'
    ? declarer.value
    : SEAT_ORDER[(SEAT_ORDER.indexOf(declarer.value) + 1) % 4]
})
const sides = computed(() => {
  const d = declarer.value
  if (!d) return []
  const defenders = PAIR[SEAT_ORDER[(SEAT_ORDER.indexOf(d) + 1) % 4]]
  return [
    { key: 'declarer', label: `Declarer (${d})` },
    { key: 'defenders', label: `Defenders (${defenders})` },
  ]
})
const sideLabel = computed(() => (side.value === 'declarer' ? 'declarer' : 'the defenders'))

const position = computed(() => buildClaimPosition({
  deal: props.t.deal,
  contract: props.t.contract,
  plays: props.t.plays,
  tricks: { NS: props.t.tricks?.ns ?? 0, EW: props.t.tricks?.ew ?? 0 },
  claimer: claimer.value,
}))
const remaining = computed(() => 13 - (props.t.tricks?.ns ?? 0) - (props.t.tricks?.ew ?? 0))

const options = ref({ claimable: null, claimableUndecided: false, makable: null })
const loading = ref(false)
const error = ref('')
let token = 0

// Recompute whenever the position changes: a card played at that table, or
// the side switched.
watch(
  () => [position.value?.stamp, claimer.value, props.t.table_id],
  async () => {
    const pos = position.value
    const mine = ++token
    options.value = { claimable: null, claimableUndecided: false, makable: null }
    error.value = ''
    if (!pos) return
    loading.value = true
    try {
      const o = await (props.solver || getSolverClient()).claimOptions(pos)
      if (mine === token) options.value = o
    } catch (err) {
      if (mine === token) error.value = err?.message || 'solver unavailable'
    } finally {
      if (mine === token) loading.value = false
    }
  },
  { immediate: true },
)

function fmt(n, atLeast = false) {
  if (n == null) return loading.value ? '…' : '—'
  return (atLeast ? '≥' : '') + n
}

function choose(tricks) {
  const pos = position.value
  if (tricks == null || !pos) return
  emit('claim', { seat: claimer.value, tricks, playsSeen: pos.stamp })
}
</script>

<style scoped>
.tcm {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  background: #f0fdf6;
  border: 0.5px solid #c8e8d6;
  border-radius: 6px;
}
.tcm-title { font-size: 13px; font-weight: 600; color: #333; }
.tcm-side { display: flex; gap: 4px; flex-wrap: wrap; }
.tcm-side-btn {
  font-size: 12px;
  padding: 3px 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
}
.tcm-side-on { border-color: #1D9E75; color: #1D9E75; font-weight: 600; }
.tcm-options { display: flex; gap: 6px; flex-wrap: wrap; }
.tcm-opt {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 72px;
  padding: 6px 10px;
  border: 1px solid #1D9E75;
  border-radius: 6px;
  background: #fff;
  color: #1D9E75;
  cursor: pointer;
}
.tcm-opt:hover:not(:disabled) { background: #1D9E75; color: #fff; }
.tcm-opt:disabled { opacity: 0.5; cursor: default; }
.tcm-opt-name { font-size: 11px; }
.tcm-opt-n { font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; }
.tcm-hint { margin: 0; font-size: 11px; color: #555; }
.tcm-cancel {
  align-self: flex-start;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid #ccc;
  background: #fff;
  cursor: pointer;
}
</style>

<template>
  <!-- A player's claim: pick how many of the remaining tricks your side will
       take (0 concedes the rest). The table checks it with bridge-solver's
       claim checker (solverClient.js) and either ends the hand or shows why
       not. No override: a claim the checker can't prove isn't a claim.
       Shared by the solo table and the served tables. -->
  <div class="claim-panel">
    <div class="claim-prompt">Claim how many of the {{ remaining }} remaining?</div>
    <div class="claim-buttons">
      <button
        v-for="n in options"
        :key="n"
        class="claim-btn"
        :class="{ 'claim-btn-rejected': rejection && rejection.additional === n }"
        :disabled="checking"
        :title="n === 0 ? 'Concede the rest' : `Claim ${n} more`"
        @click="$emit('claim', n)"
      >{{ n }}</button>
    </div>
    <div v-if="checking" class="claim-checking">Checking the claim&hellip;</div>
    <div v-if="rejection" class="claim-rejection" role="alert">
      <strong>Claim of {{ rejection.additional }} not accepted.</strong>
      <span>{{ rejection.message }}</span>
      <span v-if="limit" class="claim-limit">
        You can guarantee {{ limit.undecided ? 'at least ' : '' }}{{ limit.claimable }}
        more trick{{ limit.claimable === 1 ? '' : 's' }}.
      </span>
    </div>
    <button v-if="!checking" class="claim-cancel" @click="$emit('cancel')">Cancel</button>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  // Tricks still to play, including the one in progress.
  remaining: { type: Number, required: true },
  // A check is in flight: the count buttons are disabled.
  checking: { type: Boolean, default: false },
  // The last rejected claim: { additional, message }, or null.
  rejection: { type: Object, default: null },
  // After a rejection, the most the claimer can guarantee:
  // { claimable, undecided }, or null while unknown.
  limit: { type: Object, default: null },
})
defineEmits(['claim', 'cancel'])

const options = computed(() => Array.from({ length: props.remaining + 1 }, (_, i) => i))
</script>

<style scoped>
.claim-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  background: #f0fdf6;
  border: 0.5px solid #c8e8d6;
  border-radius: 6px;
}
.claim-prompt {
  font-size: 12px;
  color: #444;
}
.claim-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.claim-btn {
  min-width: 30px;
  padding: 4px 8px;
  font-size: 13px;
  border: 1px solid #1D9E75;
  background: #fff;
  color: #1D9E75;
  border-radius: 4px;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}
.claim-btn:hover:not(:disabled) { background: #1D9E75; color: #fff; }
.claim-btn:disabled { opacity: 0.5; cursor: default; }
.claim-btn-rejected { border-color: #b00; color: #b00; }
.claim-checking {
  font-size: 11px;
  color: #1D9E75;
  font-style: italic;
}
.claim-rejection {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  background: #fee;
  border: 0.5px solid #fbb;
  border-radius: 4px;
  font-size: 12px;
  color: #6e1f1f;
  line-height: 1.4;
}
.claim-limit { font-style: italic; }
.claim-cancel {
  align-self: flex-start;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid #ccc;
  background: #fff;
  cursor: pointer;
}
.claim-cancel:hover { border-color: #888; }
</style>

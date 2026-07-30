<template>
  <!-- The SE action cluster — what sits at the BOTTOM of the action corner, under
       the bidding box while the box is shown, and beside itself during cardplay
       (2026-07-29, Rick: "move Undo to the bottom of SE… move Claim down next to
       Undo during cardplay").

       Why here rather than the rail: the action corner already rides the hero's
       bottom (GridArrangement relocates the 'action' role to `actionCornerFor`),
       so this is the corner the player's eyes and hands are in. The cardplay rail
       panel that used to hold Claim was removed in the same change.

       The status line carries what the removed panel was the only home for — the
       bot's "thinking…" and its errors. Those are the two things that must stay
       visible during play: a silent bot failure is indistinguishable from a slow
       one, and BEN can legitimately take ~20s cold. -->
  <div class="ac-cluster">
    <div v-if="botError" class="ac-status ac-error">⚠ {{ botError }}</div>
    <div v-else-if="botStatus" class="ac-status">{{ botStatus }}</div>
    <div v-if="showUndo || showClaim" class="ac-buttons">
      <button
        v-if="showUndo"
        class="ac-btn"
        type="button"
        :disabled="!canUndo"
        title="Undo — steps back to your last decision (bid or card)"
        @click="emit('undo')"
      >
        <span class="ac-ico">⏪</span> Undo
      </button>
      <button
        v-if="showClaim"
        class="ac-btn"
        type="button"
        :disabled="!canClaim"
        title="Claim the rest of the tricks"
        @click="emit('claim')"
      >Claim&hellip;</button>
    </div>
  </div>
</template>

<script setup>
defineProps({
  showUndo: { type: Boolean, default: true },
  canUndo: { type: Boolean, default: false },
  showClaim: { type: Boolean, default: false },
  canClaim: { type: Boolean, default: false },
  // Transient bot state, previously the cardplay rail panel's job.
  botStatus: { type: String, default: null },
  botError: { type: String, default: null },
})
const emit = defineEmits(['undo', 'claim'])
</script>

<style scoped>
/* Button width is pinned to CLUSTER_UNIT.inlineBtnPx so actionClusterReservePx is
   exact by construction rather than an estimate of label width. */
.ac-cluster { display: flex; flex-direction: column; gap: 6px; align-items: center; }
.ac-buttons { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
.ac-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 78px;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid #ccc;
  background: #fff;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}
.ac-btn:hover:not(:disabled) { border-color: #888; }
.ac-btn:disabled { opacity: 0.45; cursor: default; }
.ac-ico { font-size: 12px; }
.ac-status { font-size: 11px; color: #6a726c; text-align: center; }
.ac-error { color: #b3261e; }
</style>

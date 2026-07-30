<template>
  <!-- Deal transport — the NW corner cluster (2026-07-29: relocated from a centred
       row below the table, at Rick's request, because the board number already
       lives in NW and the transport belongs with it).
       Stacked, under whatever else the shell put in the corner.

       Undo is deliberately NOT here any more: it moved to the SE action cluster so
       it sits under the bidding box / beside Claim, where the player's hands are.
       See ActionCluster.vue.

       Presentational only — actions are emits, enablement is props — so the live
       view and the harness scenes render the identical component. -->
  <div class="dc-cluster" :class="{ 'dc-row': !stacked }">
    <button
      v-if="showRestart"
      class="dc-btn"
      type="button"
      :disabled="!canRestart"
      title="Restart this deal from the top"
      @click="emit('restart')"
    >
      <span class="dc-ico">⏮</span> Restart deal
    </button>
    <!-- Under Restart deal, and only once cardplay has finished — replaying just the
         play of a hand you've already bid is a different, narrower action. -->
    <button
      v-if="showRestartCardplay"
      class="dc-btn"
      type="button"
      :disabled="!canRestartCardplay"
      title="Replay the cardplay only, keeping the auction"
      @click="emit('restart-cardplay')"
    >
      <span class="dc-ico">↺</span> Restart cardplay
    </button>
    <button
      v-if="showNext"
      class="dc-btn"
      type="button"
      :disabled="!canNext"
      title="Deal the next board"
      @click="emit('next')"
    >
      <span class="dc-ico">⏭</span> Next deal
    </button>
  </div>
</template>

<script setup>
defineProps({
  showRestart: { type: Boolean, default: true },
  canRestart: { type: Boolean, default: false },
  // The embedded `?pbn` widget owns its own completion flow (a "Done" button
  // handing back to Game Analysis), so it suppresses Next deal entirely.
  showNext: { type: Boolean, default: true },
  canNext: { type: Boolean, default: false },
  showRestartCardplay: { type: Boolean, default: false },
  canRestartCardplay: { type: Boolean, default: false },
  // Stacked is the corner form. Row is kept for any shell that still wants the
  // old horizontal strip.
  stacked: { type: Boolean, default: true },
})
const emit = defineEmits(['restart', 'next', 'restart-cardplay'])
</script>

<style scoped>
/* Width is pinned to CLUSTER_UNIT.stackedBtnPx so the arranger's reserve
   (dealControlsReservePx) is exact by construction, not an estimate of label width. */
.dc-cluster { display: flex; flex-direction: column; align-items: stretch; gap: 8px; }
.dc-row { flex-direction: row; flex-wrap: wrap; justify-content: center; align-items: center; }
.dc-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 148px;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid #ccc;
  background: #fff;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}
.dc-row .dc-btn { min-width: 0; justify-content: center; }
.dc-btn:hover:not(:disabled) { border-color: #888; }
.dc-btn:disabled { opacity: 0.45; cursor: default; }
.dc-ico { font-size: 12px; }
</style>

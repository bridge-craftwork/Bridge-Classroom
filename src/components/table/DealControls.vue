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
  <div class="dc-cluster">
    <button
      v-if="showRestart"
      class="dc-btn"
      type="button"
      :disabled="!canRestart"
      title="Restart this deal from the top"
      aria-label="Restart this deal from the top"
      @click="emit('restart')"
    >⏮</button>
    <!-- Under Restart deal, and only once cardplay has finished — replaying just the
         play of a hand you've already bid is a different, narrower action. -->
    <button
      v-if="showRestartCardplay"
      class="dc-btn"
      type="button"
      :disabled="!canRestartCardplay"
      title="Restart cardplay — replay the play only, keeping the auction"
      aria-label="Restart cardplay — replay the play only, keeping the auction"
      @click="emit('restart-cardplay')"
    >↺</button>
    <button
      v-if="showNext"
      class="dc-btn"
      type="button"
      :disabled="!canNext"
      title="Deal the next board"
      aria-label="Deal the next board"
      @click="emit('next')"
    >⏭</button>
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
})
const emit = defineEmits(['restart', 'next', 'restart-cardplay'])
</script>

<style scoped>
/* Icon row. Sizes come from CLUSTER_UNIT (iconBtnPx / gapPx) so the arranger's
   reserve is exact by construction — the reason the labelled version over-reserved
   is that its min-width was a guess at the widest label. */
/* max-width == CLUSTER_UNIT.maxPerRow icons (70px), so three wrap to 2+1 and the
   cluster never exceeds the board glyph it sits under. */
.dc-cluster { display: flex; flex-direction: row; flex-wrap: wrap; gap: 6px; align-items: center; max-width: 70px; }
.dc-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 6px;
  border: 1px solid #ccc;
  background: #fff;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
.dc-btn:hover:not(:disabled) { border-color: #888; background: #f4f6f4; }
.dc-btn:disabled { opacity: 0.45; cursor: default; }
</style>

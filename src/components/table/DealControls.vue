<template>
  <!-- VCR-style deal transport: undo / restart / next. Presentational only —
       every action is an emit, every enablement is a prop, so the same component
       renders from a live engine (the view) and from a frozen fixture (the
       harness scenes). That shared use is the point: this row is a RELOCATION
       CANDIDATE (below-the-table today, NW next), and a relocation is only a
       one-line move in both places while the markup lives in one file. -->
  <div class="dc-row" :class="{ 'dc-stacked': stacked }">
    <button
      class="dc-btn"
      type="button"
      :disabled="!canUndo"
      title="Undo — steps back to your last decision (bid or card)"
      @click="emit('undo')"
    >
      <span class="dc-ico">⏪</span> Undo
    </button>
    <button
      class="dc-btn"
      type="button"
      :disabled="!canRestart"
      title="Restart this deal from the top"
      @click="emit('restart')"
    >
      <span class="dc-ico">⏮</span> Restart deal
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
  canUndo: { type: Boolean, default: false },
  canRestart: { type: Boolean, default: false },
  canNext: { type: Boolean, default: false },
  // The embedded `?pbn` widget owns its own completion flow (a "Done" button
  // handing back to Game Analysis), so it suppresses Next deal entirely.
  showNext: { type: Boolean, default: true },
  // Column layout for narrow regions — the corner slots are much narrower than
  // the full table width this row sits under today.
  stacked: { type: Boolean, default: false },
})
const emit = defineEmits(['undo', 'restart', 'next'])
</script>

<style scoped>
.dc-row { display: flex; justify-content: center; flex-wrap: wrap; gap: 8px; }
.dc-stacked { flex-direction: column; align-items: stretch; flex-wrap: nowrap; }
.dc-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid #ccc;
  background: #fff;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}
.dc-stacked .dc-btn { justify-content: flex-start; }
.dc-btn:hover:not(:disabled) { border-color: #888; }
.dc-btn:disabled { opacity: 0.45; cursor: default; }
.dc-ico { font-size: 12px; }
</style>

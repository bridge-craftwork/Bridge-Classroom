<template>
  <!-- Shared table-view frame for the solo (/bidding-practice) and host
       (/tables/host) surfaces. Owns ONLY the frame (page wrapper, header row,
       2-column table+rail layout); each surface supplies its own content via
       slots, so they look the same everywhere except where they functionally
       differ. See documentation/design/table-view-unification-plan.md.

       Slots:
         header-left  — title + tags + status
         header-right — action buttons + connection state
         notes        — a full-width strip under the header (kibitz/paused/scenario)
         table        — the BridgeTable / SeatControlTable
         rail         — the right-hand column of cards
         overlays     — modals / toasts / diagnostics (position:fixed; DOM order n/a)

       The content-primitive classes (.tv-card/.tv-btn/… today) are styled by the
       PARENT that fills the slots, because slotted content compiles in the
       parent's scope — this component only styles its own frame. -->
  <div class="ts-page" :class="{ 'ts-embedded': embedded }">
    <div
      v-if="!embedded && ($slots['header-left'] || $slots['header-right'])"
      class="ts-header"
    >
      <div class="ts-header-left"><slot name="header-left" /></div>
      <div class="ts-header-right"><slot name="header-right" /></div>
    </div>

    <slot name="notes" />

    <div class="ts-main">
      <div class="ts-table-wrap"><slot name="table" /></div>
      <div v-if="$slots.rail" class="ts-rail"><slot name="rail" /></div>
    </div>

    <slot name="overlays" />
  </div>
</template>

<script setup>
defineProps({
  // Chromeless mode for the embedded (iframe ?pbn) bidding widget — drops the
  // header so the widget is just the table + rail in a narrow frame.
  embedded: { type: Boolean, default: false },
})
</script>

<style scoped>
.ts-page {
  max-width: 1400px;
  margin: 0 auto;
  padding: 16px;
  font-family: 'Segoe UI', system-ui, sans-serif;
}
.ts-embedded { padding: 0; }

.ts-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.ts-header-left { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ts-header-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

.ts-main {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(240px, 1fr);
  gap: 16px;
  align-items: start;
}
.ts-table-wrap {
  position: relative;
  background: #fbfbf8;
  border: 1px solid #e5e5e0;
  border-radius: 10px;
}
.ts-rail { display: flex; flex-direction: column; gap: 12px; }

/* Stack the rail under the table on narrow frames (embed / small windows). */
@media (max-width: 800px) {
  .ts-main { grid-template-columns: minmax(0, 1fr); }
}
</style>

<template>
  <!-- The strip between the header and the table (TableShell's `#notes` on the solo
       path): which deal this is, plus the actions that change it.

       Extracted 2026-07-29 after it drifted. The scenes hand-copied its markup but
       not its CSS intent — production is a COLUMN with the actions on top, the scene
       had a row — and the mismatch reached a bug report. Chrome that only lives in
       one file cannot drift; that, not reuse, is the reason this is a component.

       Layout note, carried over verbatim from the original: the actions row sits ON
       TOP via `order: -1` so the info line gets the full width underneath, rather
       than being squeezed into a narrow deeply-wrapped column beside a button row
       that refuses to wrap. -->
  <div class="sb" :class="{ 'sb-embedded': embedded }">
    <div v-if="$slots.actions" class="sb-actions"><slot name="actions" /></div>
    <div class="sb-info">
      <div class="sb-name">{{ name }}</div>
      <div v-for="(line, i) in meta" :key="i" class="sb-meta">{{ line }}</div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  // The deal's name — a scenario title, or the no-deal-yet placeholder.
  name: { type: String, required: true },
  // Zero or more sub-lines: the convention cards in play, the deal source, or the
  // priming state's instructions. Plain strings; the caller composes them, because
  // WHICH lines apply is a per-surface question (a served table has no local pool
  // summary, a coached lesson would have neither).
  meta: { type: Array, default: () => [] },
  // The iframe widget drops the bar's chrome; kept as a modifier so the embed can't
  // drift away from the standalone form.
  embedded: { type: Boolean, default: false },
})
</script>

<style scoped>
.sb {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  padding: 10px 14px;
  background: #fff;
  border: 0.5px solid #ddd;
  border-radius: 8px;
}
.sb-embedded { border: 0; padding: 6px 0; background: transparent; }
/* order:-1 — actions above the info line. See the template comment. */
.sb-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; order: -1; }
.sb-info { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 14px; }
.sb-name { font-weight: 600; font-size: 15px; }
.sb-meta { font-size: 12px; color: #6a726c; }
</style>

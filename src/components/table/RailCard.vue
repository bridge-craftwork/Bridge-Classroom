<template>
  <!-- One card in a table's right rail. The rail is a stack of these: Double dummy,
       Play, Kibitzers, PassBot, Result, the waiting cues.

       Extracted 2026-07-29. Every rail card was an ad-hoc `<div class="tv-card">` on
       the server branch and `<div class="bp-card">` on the solo one — the SAME card,
       drawn twice in two CSS namespaces, and a third time by hand in each harness
       scene. That is three places to change and three places to drift, which is what
       happened: the scenes had no rail at all until the 2026-07-29 audit, and the
       scenario bar (same category of chrome) reached a bug report.

       This is deliberately a FRAME, not a set of specific cards. The contents stay
       where they are — they read live engine state and belong to their branch — but
       the box they sit in is now one thing with one name, which is also what makes a
       rail card renderable in the gallery. -->
  <div class="rc" :class="[`rc-${tone}`, { 'rc-quiet': quiet }]">
    <h3 v-if="title" class="rc-title">{{ title }}</h3>
    <slot />
  </div>
</template>

<script setup>
defineProps({
  // Omitted for cards that are a bare cue ("Computing…", "Waiting for East…"),
  // which carry no heading in either branch today.
  title: { type: String, default: '' },
  // 'default' | 'waiting' — waiting cues sit back visually; they're a status, not
  // something to act on.
  tone: { type: String, default: 'default' },
  // Dims the whole card (the off-turn state).
  quiet: { type: Boolean, default: false },
})
</script>

<style scoped>
.rc {
  background: #fff;
  border: 1px solid #e6e8e3;
  border-radius: 12px;
  padding: 12px 14px;
}
.rc-title { margin: 0 0 6px; font-size: 13px; font-weight: 700; }
.rc-waiting { background: #f7f9f6; }
.rc-quiet { opacity: 0.85; }
</style>

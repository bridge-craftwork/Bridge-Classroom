<template>
  <div class="harness-page">
    <div v-if="!comp || !entry" class="harness-miss">
      no specimen: {{ component }}/{{ specimen }}
    </div>
    <div
      v-else
      class="harness-frame"
      :style="{ width: widthPx + 'px', '--table-scale': scale }"
      :data-harness-ready="ready ? '' : null"
    >
      <!-- Specimens are prop files, but the SHELL parts (ScenarioBar, RailCard) are
           frames whose whole point is what goes inside them — with props alone they
           render as empty boxes. `slots` lets a specimen supply illustrative content
           as static markup. Dev-only harness, static strings from our own repo, so
           v-html is safe here in a way it wouldn't be on a product surface. -->
      <component :is="comp" v-bind="entry.props" @card-click="onCardClick">
        <template v-if="entry.slots && entry.slots.default" #default><span v-html="entry.slots.default" /></template>
        <template v-if="entry.slots && entry.slots.actions" #actions><span v-html="entry.slots.actions" /></template>
      </component>
    </div>
  </div>
</template>

<script setup>
// Tier-1 component harness page: mount ONE component from ONE specimen prop-file
// inside a fixed-width frame. No shell, no store, no engine — if a component
// can't render from here, that coupling is the component's bug. Reached only at
// /harness/component/:component/:specimen?w=<width>, behind VITE_HARNESS.
import { computed, ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { COMPONENTS, SPECIMENS } from './registry.js'
import WIDTHS from './widths.json'
import './harness.css'

const route = useRoute()
const component = computed(() => route.params.component)
const specimen = computed(() => route.params.specimen)
const comp = computed(() => COMPONENTS[component.value] || null)
const entry = computed(() => SPECIMENS[component.value]?.[specimen.value] || null)
// ?w=tile|narrow|panel|drill (named) or a raw px number; defaults to panel.
const widthPx = computed(() => WIDTHS[route.query.w] ?? (Number(route.query.w) || WIDTHS.panel))
// ?scale=1|1.25|1.5 → --table-scale on the frame (cascades into the component's
// scoped styles). Defaults to 1 (today's sizes exactly).
const scale = computed(() => Number(route.query.scale) || 1)

// Event bridge for interaction tests (e.g. hit-area proof): surface a
// component's emits on window so a Playwright test can assert a tap "played" a
// card vs opened the popup. Inert for components that never emit card-click.
function onCardClick(payload) {
  ;(window.__harnessEvents ||= []).push({ type: 'card-click', payload })
}

// The walk waits for [data-harness-ready], set after mount + fonts settle.
const ready = ref(false)
onMounted(async () => {
  try { await document.fonts.ready } catch { /* jsdom/no-fonts */ }
  ready.value = true
})
</script>

<style scoped>
/* Scroll rather than clip when a component is wider than the width it was given.
   The drill matrix crosses width x scale independently, so it produces combinations
   the arranger never would (it derives scale FROM the allocation — a 160px region
   never gets 1.5x). Those cells are legitimately impossible; what is NOT acceptable
   is showing a plausible-looking component with its right-hand column silently cut
   off. Reported for DoubleDummyTable at 160/1.5 (+29px); measuring every cell then
   found AuctionTable overflowing the same cell by 170px, unnoticed.

   Scrolling here rather than in the gallery's cell keeps the matrix geometry
   untouched, so the comparison the matrix exists for stays honest. */
.harness-page { padding: 16px; background: #fff; overflow-x: auto; }
/* width is set inline per specimen×width; the component fills or overflows it,
   which is exactly what we want to see at the narrow end. */
.harness-frame { display: inline-block; }
.harness-miss { color: #c00; font: 14px 'Courier New', monospace; }
</style>

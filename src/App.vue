<template>
  <router-view />
  <component :is="BeetleButton" />
</template>

<script setup>
import { defineAsyncComponent, onMounted, onUnmounted } from 'vue'
// Grid-arranger bounding-box diagnostic overlay styles (grid-arranger-spec §5.1),
// available live in the app — inert unless `data-bounding-boxes` is set on <html>, and
// only styles `.grid-table`, so it does nothing on the legacy arrangement.
import './components/table/boundingBoxes.css'
import { initDebugOverlays, toggleDebugOverlays } from './composables/useDebugOverlays.js'

// Bug-report beetle (Slice 1). The GitHub-issue path is public — every user gets
// the button. (The extra LOCAL dev-sink path inside it is separately gated by the
// bcLocalReports localStorage flag; see report/flags.js.) Async so the report lib
// + screenshot rasterizer stay in their own lazily-loaded chunk.
const BeetleButton = defineAsyncComponent(() => import('./report/BeetleButton.vue'))

// Debug-overlay toggle: resolve `?bounding-boxes=1` / stored flag on load, and allow
// live toggling with Alt+B. Alt-chorded + focus-guarded so it can't fire while a
// student is typing (the beetle note, name field, etc.).
initDebugOverlays()
function onKey(e) {
  if (!e.altKey || e.metaKey || e.ctrlKey) return
  if (e.key !== 'b' && e.key !== 'B') return
  const el = document.activeElement
  const tag = el?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
  e.preventDefault()
  toggleDebugOverlays()
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

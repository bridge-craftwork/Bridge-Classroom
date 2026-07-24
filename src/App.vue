<template>
  <router-view />
  <component :is="BeetleButton" />
</template>

<script setup>
import { defineAsyncComponent, onMounted, onUnmounted, watch } from 'vue'
import { useUserStore } from './composables/useUserStore.js'
import { useFriendPresence } from './composables/useFriendPresence.js'
import { useTableSocket } from './composables/useTableSocket.js'
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

// Debug-overlay toggle: resolve `?bounding-boxes=1` / stored flag on load (and re-read
// on hashchange, inside the composable), and allow live toggling with Ctrl+B or Alt+B.
// Keyed on the PHYSICAL key (`e.code === 'KeyB'`), NOT `e.key` — on macOS Option+B emits
// the character "∫", so an `e.key === 'b'` check never fired (2026-07-12 report). Ctrl OR
// Alt (never Cmd, which is bold in inputs), and focus-guarded so it can't fire while a
// student is typing (the beetle note, name field, etc.).
initDebugOverlays()
function onKey(e) {
  if (e.metaKey) return
  if (!e.altKey && !e.ctrlKey) return
  if (e.code !== 'KeyB') return
  const el = document.activeElement
  const tag = el?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
  e.preventDefault()
  toggleDebugOverlays()
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

// ── Friend presence (Phase 3) ──────────────────────────────────────────────
// Driven from the always-mounted root (NOT MainLayout, which unmounts at /table)
// so presence — and our own `at_table` state — survives navigation to a table.
const userStore = useUserStore()
const presence = useFriendPresence()
watch(
  () => userStore.currentUserId.value,
  (id) => (id ? presence.start(id) : presence.stop()),
  { immediate: true },
)
// `at_table` follows the (singleton) table socket: connected while seated at a
// served table, idle otherwise. Solo practice is a different signal (set by the
// solo view), so this only tracks the real multiplayer socket.
const tableSocket = useTableSocket()
watch(
  () => tableSocket.status.value,
  (s) => presence.setAtTable(s === 'connected'),
  { immediate: true },
)
</script>

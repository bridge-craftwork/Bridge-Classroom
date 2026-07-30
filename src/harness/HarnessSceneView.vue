<template>
  <div class="scene-page" :data-harness-ready="ready ? '' : null">
    <div v-if="!fixture" class="scene-miss">no scene: {{ scene }}</div>
    <A1Scene v-else-if="fixture.surface === 'a1'" :fixture="fixture" />
    <B1Scene v-else-if="fixture.surface === 'b1'" :fixture="fixture" />
    <C1Scene v-else-if="fixture.surface === 'c1'" :fixture="fixture" />
    <BServerScene v-else-if="fixture.surface === 'b2' || fixture.surface === 'b3'" :fixture="fixture" />
    <ServerTableScene v-else-if="fixture.surface === 'server'" :fixture="fixture" />
    <TableScene v-else :fixture="fixture" />
  </div>
</template>

<script setup>
// Tier-2 view-scenario page: mount one scene from one frozen fixture,
// full-viewport. The walk sets the browser viewport per named size; the scene's
// own responsive CSS does the rest. `surface: 'server'` fixtures render through
// ServerTableScene (the Phase-0.2 fixture driver → real srv state); everything
// else is a plain TableScene. Reached at /harness/scene/:scene, behind
// VITE_HARNESS.
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import TableScene from './TableScene.vue'
import ServerTableScene from './ServerTableScene.vue'
import A1Scene from './A1Scene.vue'
import B1Scene from './B1Scene.vue'
import C1Scene from './C1Scene.vue'
import BServerScene from './BServerScene.vue'
import './harness.css'
import '../components/table/boundingBoxes.css'

// Both fixture dirs resolve by name: the shared `fixtures/` set (component
// gallery) and the A1-only `fixtures-a1/` set (its own separate gallery). Keeping
// them in separate dirs is what lets each gallery walk only its own scenes.
const modules = { ...import.meta.glob('./fixtures/*.js', { eager: true }), ...import.meta.glob('./fixtures-a1/*.js', { eager: true }), ...import.meta.glob('./fixtures-b/*.js', { eager: true }), ...import.meta.glob('./fixtures-c/*.js', { eager: true }) }
const scenes = {}
for (const [p, m] of Object.entries(modules)) {
  const name = p.match(/\/([^/]+)\.js$/)?.[1]
  if (name) scenes[name] = m.default
}

const route = useRoute()
const scene = computed(() => route.params.scene)
const fixture = computed(() => scenes[scene.value] || null)

// Bounding-box diagnostic toggle: `?bounding-boxes=1` sets `data-bounding-boxes`
// on <html>, which the harness-only boundingBoxes.css keys off. Also live-toggled
// with the `b` key for interactive inspection.
function applyBoundingBoxes() {
  const on = route.query['bounding-boxes'] != null
  document.documentElement.toggleAttribute('data-bounding-boxes', on)
}
function onKey(e) {
  if (e.key === 'b' && !e.metaKey && !e.ctrlKey && !e.altKey) document.documentElement.toggleAttribute('data-bounding-boxes')
}

const ready = ref(false)
onMounted(async () => {
  applyBoundingBoxes()
  window.addEventListener('keydown', onKey)
  try { await document.fonts.ready } catch { /* jsdom */ }
  ready.value = true
})
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<style scoped>
.scene-page { min-height: 100vh; background: #f5f5f3; }
.scene-miss { padding: 24px; color: #c00; font: 14px 'Courier New', monospace; }
</style>

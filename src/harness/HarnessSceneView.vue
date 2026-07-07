<template>
  <div class="scene-page" :data-harness-ready="ready ? '' : null">
    <div v-if="!fixture" class="scene-miss">no scene: {{ scene }}</div>
    <TableScene v-else :fixture="fixture" />
  </div>
</template>

<script setup>
// Tier-2 view-scenario page: mount one TableScene from one frozen fixture,
// full-viewport. The walk sets the browser viewport per named size; the scene's
// own responsive CSS does the rest. Reached at /harness/scene/:scene, behind
// VITE_HARNESS.
import { computed, ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import TableScene from './TableScene.vue'
import './harness.css'

const modules = import.meta.glob('./fixtures/*.js', { eager: true })
const scenes = {}
for (const [p, m] of Object.entries(modules)) {
  const name = p.match(/\/([^/]+)\.js$/)?.[1]
  if (name) scenes[name] = m.default
}

const route = useRoute()
const scene = computed(() => route.params.scene)
const fixture = computed(() => scenes[scene.value] || null)

const ready = ref(false)
onMounted(async () => {
  try { await document.fonts.ready } catch { /* jsdom */ }
  ready.value = true
})
</script>

<style scoped>
.scene-page { min-height: 100vh; background: #f5f5f3; }
.scene-miss { padding: 24px; color: #c00; font: 14px 'Courier New', monospace; }
</style>

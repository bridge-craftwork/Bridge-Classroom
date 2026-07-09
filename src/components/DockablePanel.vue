<template>
  <div
    v-if="visible"
    class="dock-panel"
    :class="{ docked }"
    :style="{ left: pos.x + 'px', top: pos.y + 'px', width: size.w + 'px', height: size.h + 'px' }"
  >
    <div class="dock-titlebar" @pointerdown="startDrag">
      <span class="dock-title">{{ title }}</span>
      <div class="dock-controls">
        <button
          class="dock-btn"
          :class="{ active: docked }"
          @click="toggleDock"
          :title="docked ? 'Float over the page' : 'Dock to the left as a reference'"
        >{{ docked ? '⧉' : '⇤' }}</button>
        <a
          v-if="newTabHref"
          class="dock-btn"
          :href="newTabHref"
          target="_blank"
          rel="noopener noreferrer"
          title="Open in new tab"
        >&#8599;</a>
        <button class="dock-btn close" @click="$emit('close')" title="Close">&times;</button>
      </div>
    </div>
    <div class="dock-body">
      <!-- Overlay to capture pointer events during drag/resize (an iframe body
           would otherwise steal them). Harmless for plain-text bodies. -->
      <div v-if="interacting" class="interaction-overlay"></div>
      <slot :width="size.w" :height="size.h" :docked="docked" />
    </div>
    <div class="resize-handle" @pointerdown="startResize">&#8943;</div>
  </div>
</template>

<script setup>
// Shared floating / dockable window: draggable titlebar, resize handle,
// ⇤ dock / ⧉ float toggle, optional ⇗ open-in-new-tab, ✕ close, and the single
// GLOBAL dock/float preference (uiPrefs.introDock). The body is a slot, so the
// same window frames the A1 lesson-intro PDF and the play-tables' scenario
// description identically. When docked it snaps to the left edge and reports its
// geometry so the host layout can reserve a matching gutter (see MainLayout /
// BiddingPracticeView `.intro-open`); floating overlays with no reflow.
import { reactive, ref, watch } from 'vue'
import { useAppConfig } from '../composables/useAppConfig.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
  title: { type: String, default: '' },
  // When truthy, the ⇗ button renders as an anchor opening this href in a new
  // tab. Omit for bodies with nothing to open (e.g. plain text).
  newTabHref: { type: String, default: '' },
  // Initial geometry (px). Defaults match the original IntroPdfViewer.
  initialX: { type: Number, default: 8 },
  initialY: { type: Number, default: 80 },
  initialWidth: { type: Number, default: 550 },
  initialHeight: { type: Number, default: 700 },
  minWidth: { type: Number, default: 320 },
  minHeight: { type: Number, default: 300 },
  // When set, dragging the box TALLER also widens it: width is floored by
  // (height - titlebar) / aspectFloor. The PDF body uses this so a taller box
  // enlarges the width-tracked text. Plain-text bodies leave it null (free resize).
  aspectFloor: { type: Number, default: null }
})

const emit = defineEmits(['close', 'geometry'])

const pos = reactive({ x: props.initialX, y: props.initialY })
const size = reactive({ w: props.initialWidth, h: props.initialHeight })
const TITLEBAR = 40

// Dock vs float is a single GLOBAL preference (cross-lesson, cross-viewport,
// cross-app), remembered in uiPrefs. Default float. Docking reserves a side
// gutter in the host layout; floating overlays.
const { uiPrefs, setUIPref } = useAppConfig()
const docked = ref(uiPrefs.value.introDock === 'dock')
watch(() => uiPrefs.value.introDock, v => { docked.value = v === 'dock' })
function toggleDock() {
  const next = docked.value ? 'float' : 'dock'
  setUIPref('introDock', next)
  // Snap to the left edge when docking, so the reserved gutter lines up.
  if (next === 'dock') { pos.x = 8; pos.y = 80 }
}

// Report position+size so the host can reserve a gutter matching the panel's
// real right edge (it's draggable and resizable). Emits live; null when hidden.
watch(
  () => [props.visible, pos.x, size.w],
  () => emit('geometry', props.visible ? { x: pos.x, w: size.w } : null),
  { immediate: true }
)

const interacting = ref(false)
const dragOffset = reactive({ x: 0, y: 0, startW: 0, startH: 0 })

// Drag logic
function startDrag(e) {
  if (e.target.closest('button, a')) return
  interacting.value = true
  dragOffset.x = e.clientX - pos.x
  dragOffset.y = e.clientY - pos.y
  document.addEventListener('pointermove', onDrag)
  document.addEventListener('pointerup', stopInteraction)
}
function onDrag(e) {
  pos.x = Math.max(0, e.clientX - dragOffset.x)
  pos.y = Math.max(0, e.clientY - dragOffset.y)
}

// Resize logic
function startResize(e) {
  interacting.value = true
  dragOffset.x = e.clientX
  dragOffset.y = e.clientY
  dragOffset.startW = size.w
  dragOffset.startH = size.h
  document.addEventListener('pointermove', onResize)
  document.addEventListener('pointerup', stopInteraction)
}
function onResize(e) {
  size.h = Math.max(props.minHeight, dragOffset.startH + (e.clientY - dragOffset.y))
  let w = Math.max(props.minWidth, dragOffset.startW + (e.clientX - dragOffset.x))
  if (props.aspectFloor) w = Math.max(w, (size.h - TITLEBAR) / props.aspectFloor)
  size.w = w
}

function stopInteraction() {
  interacting.value = false
  document.removeEventListener('pointermove', onDrag)
  document.removeEventListener('pointermove', onResize)
  document.removeEventListener('pointerup', stopInteraction)
}
</script>

<style scoped>
.dock-panel {
  position: fixed;
  z-index: 900;
  background: white;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 320px;
  min-height: 300px;
}

.dock-titlebar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  cursor: grab;
  user-select: none;
  flex-shrink: 0;
}

.dock-titlebar:active {
  cursor: grabbing;
}

.dock-title {
  font-size: 14px;
  font-weight: 600;
}

.dock-controls {
  display: flex;
  gap: 8px;
  align-items: center;
}

.dock-btn {
  background: none;
  border: none;
  color: white;
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  text-decoration: none;
  opacity: 0.8;
}

.dock-btn:hover {
  opacity: 1;
}

.dock-btn.active {
  opacity: 1;
  background: rgba(255, 255, 255, 0.22);
  border-radius: 4px;
}

.dock-btn.close {
  font-size: 22px;
}

.dock-body {
  flex: 1;
  position: relative;
  overflow: auto;
}

.interaction-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  cursor: grabbing;
}

.resize-handle {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 20px;
  height: 20px;
  cursor: nwse-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: #999;
  background: rgba(255, 255, 255, 0.8);
  border-radius: 4px 0 8px 0;
  user-select: none;
}

.resize-handle:hover {
  color: #666;
  background: rgba(240, 240, 240, 0.9);
}
</style>

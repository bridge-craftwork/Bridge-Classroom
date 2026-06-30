<template>
  <div
    v-if="visible"
    class="intro-pdf-viewer"
    :style="{ left: pos.x + 'px', top: pos.y + 'px', width: size.w + 'px', height: size.h + 'px' }"
  >
    <div class="viewer-titlebar" @pointerdown="startDrag">
      <span class="viewer-title">Lesson Introduction</span>
      <div class="viewer-controls">
        <button class="viewer-btn" @click="openInNewTab" title="Open in new tab">&#8599;</button>
        <button class="viewer-btn close" @click="$emit('close')" title="Close">&times;</button>
      </div>
    </div>
    <div class="viewer-body">
      <!-- Overlay to capture pointer events during drag/resize (iframe steals them) -->
      <div v-if="interacting" class="interaction-overlay"></div>
      <div v-if="loading" class="viewer-loading">Loading PDF...</div>
      <div v-else-if="error" class="viewer-error">{{ error }}</div>
      <iframe v-else-if="iframeSrc" :src="iframeSrc" class="viewer-iframe"></iframe>
    </div>
    <div class="resize-handle" @pointerdown="startResize">&#8943;</div>
  </div>
</template>

<script setup>
import { reactive, ref, computed, watch, onBeforeUnmount } from 'vue'

const props = defineProps({
  url: {
    type: String,
    required: true
  },
  visible: {
    type: Boolean,
    default: false
  }
})

defineEmits(['close'])

const pos = reactive({ x: 8, y: 80 })
const size = reactive({ w: 550, h: 700 })
const interacting = ref(false)
const dragOffset = reactive({ x: 0, y: 0 })

// PDF blob state
const blobUrl = ref(null)
const loading = ref(false)
const error = ref(null)

// Hide sidebar and toolbar in the browser PDF viewer
const iframeSrc = computed(() =>
  blobUrl.value ? blobUrl.value + '#navpanes=0&toolbar=0' : null
)

// Fetch PDF as blob and create object URL with correct MIME type
async function fetchPdf(url) {
  cleanup()
  if (!url) return

  loading.value = true
  error.value = null

  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error('Failed to load PDF')
    const blob = await response.blob()
    const pdfBlob = new Blob([blob], { type: 'application/pdf' })
    blobUrl.value = URL.createObjectURL(pdfBlob)
  } catch (err) {
    error.value = 'Could not load PDF'
    console.error('Failed to fetch intro PDF:', err)
  } finally {
    loading.value = false
  }
}

function cleanup() {
  if (blobUrl.value) {
    URL.revokeObjectURL(blobUrl.value)
    blobUrl.value = null
  }
}

function openInNewTab() {
  if (blobUrl.value) {
    window.open(blobUrl.value, '_blank')
  }
}

// Fetch when visible and URL changes
watch(() => [props.visible, props.url], ([visible, url]) => {
  if (visible && url) {
    fetchPdf(url)
  } else if (!visible) {
    cleanup()
  }
}, { immediate: true })

onBeforeUnmount(cleanup)

// Drag logic
function startDrag(e) {
  if (e.target.closest('button')) return

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
  size.w = Math.max(320, dragOffset.startW + (e.clientX - dragOffset.x))
  size.h = Math.max(300, dragOffset.startH + (e.clientY - dragOffset.y))
}

function stopInteraction() {
  interacting.value = false
  document.removeEventListener('pointermove', onDrag)
  document.removeEventListener('pointermove', onResize)
  document.removeEventListener('pointerup', stopInteraction)
}
</script>

<style scoped>
.intro-pdf-viewer {
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

.viewer-titlebar {
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

.viewer-titlebar:active {
  cursor: grabbing;
}

.viewer-title {
  font-size: 14px;
  font-weight: 600;
}

.viewer-controls {
  display: flex;
  gap: 8px;
  align-items: center;
}

.viewer-btn {
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

.viewer-btn:hover {
  opacity: 1;
}

.viewer-btn.close {
  font-size: 22px;
}

.viewer-body {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.interaction-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  cursor: grabbing;
}

.viewer-iframe {
  width: 100%;
  height: 100%;
  border: none;
}

.viewer-loading,
.viewer-error {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: #666;
  padding: 20px;
}

.viewer-error {
  color: #d32f2f;
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

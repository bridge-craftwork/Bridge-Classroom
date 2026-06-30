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
      <iframe v-else-if="iframeSrc" :src="iframeSrc" class="viewer-iframe" :style="iframeStyle"></iframe>
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

const emit = defineEmits(['close', 'geometry'])

const pos = reactive({ x: 8, y: 80 })
const size = reactive({ w: 550, h: 700 })

// Report position+size so the layout can reserve a gutter that matches the
// viewer's actual right edge (it's draggable and resizable). Emits live.
watch(
  () => [props.visible, pos.x, size.w],
  () => emit('geometry', props.visible ? { x: pos.x, w: size.w } : null),
  { immediate: true }
)
const interacting = ref(false)
const dragOffset = reactive({ x: 0, y: 0 })

// Proportional text. The embedded PDF viewer only fits-to-width at load and won't
// re-fit on resize, and #zoom=page-width won't enlarge past 100%. So we render the
// page at a fixed high zoom (#zoom=200 → crisp 2x raster) into an iframe sized to
// the page's natural width × 2, then CSS-scale that iframe down to the viewer body.
// Scaling DOWN from the 2x render stays sharp, and the scale tracks the window
// size live — so dragging the box bigger enlarges the text smoothly. The page
// width is read from the PDF (pageWidthPx) so it works for any page size.
const ZOOM = 2
const TITLEBAR = 40
const pageWidthPx = ref(528) // 5.5in @96dpi; updated per-PDF from its MediaBox
const baseW = computed(() => pageWidthPx.value * ZOOM)
const pdfScale = computed(() => size.w / baseW.value)
const iframeStyle = computed(() => ({
  width: baseW.value + 'px',
  height: ((size.h - TITLEBAR) / pdfScale.value) + 'px',
  transform: `scale(${pdfScale.value})`,
  transformOrigin: '0 0'
}))

// PDF blob state
const blobUrl = ref(null)
const loading = ref(false)
const error = ref(null)

// Hide sidebar/toolbar; render at a fixed 2x zoom (ZOOM). The iframe is then
// CSS-scaled to the viewer (see iframeStyle).
const iframeSrc = computed(() =>
  blobUrl.value ? blobUrl.value + '#toolbar=0&navpanes=0&zoom=200' : null
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
    const buf = await response.arrayBuffer()
    // Read the page width from the PDF's MediaBox so the CSS scaling matches the
    // actual page (pbs intros are 5.5in; Baker's are Letter 8.5in).
    const head = new TextDecoder('latin1').decode(new Uint8Array(buf))
    const m = head.match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/)
    pageWidthPx.value = m ? (parseFloat(m[3]) - parseFloat(m[1])) * 96 / 72 : 528
    const pdfBlob = new Blob([buf], { type: 'application/pdf' })
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

// Text size tracks the box WIDTH (the page fills the width). To make dragging the
// box TALLER also enlarge the text, widen the box in step with its height: width
// is floored by height/ASPECT, so a taller box is at least proportionally wider
// and the bigger width drives bigger text — with no clipping or sideways scroll.
const ASPECT = (700 - TITLEBAR) / 550 // default body-height : width
function onResize(e) {
  size.h = Math.max(300, dragOffset.startH + (e.clientY - dragOffset.y))
  size.w = Math.max(320, dragOffset.startW + (e.clientX - dragOffset.x), (size.h - TITLEBAR) / ASPECT)
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
  position: absolute;
  top: 0;
  left: 0;
  border: none;
  /* width/height/transform are set inline (CSS-scaled to the viewer body). */
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

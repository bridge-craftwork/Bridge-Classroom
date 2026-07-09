<template>
  <div
    v-if="visible"
    class="intro-pdf-viewer"
    :style="{ left: pos.x + 'px', top: pos.y + 'px', width: size.w + 'px', height: size.h + 'px' }"
  >
    <div class="viewer-titlebar" @pointerdown="startDrag">
      <span class="viewer-title">Lesson Introduction</span>
      <div class="viewer-controls">
        <button
          class="viewer-btn"
          :class="{ active: docked }"
          @click="toggleDock"
          :title="docked ? 'Float over the page' : 'Dock to the left as a reference'"
        >{{ docked ? '⧉' : '⇤' }}</button>
        <button class="viewer-btn" @click="openInNewTab" title="Open in new tab">&#8599;</button>
        <button class="viewer-btn close" @click="$emit('close')" title="Close">&times;</button>
      </div>
    </div>
    <div class="viewer-body">
      <!-- Overlay to capture pointer events during drag/resize (iframe steals them) -->
      <div v-if="interacting" class="interaction-overlay"></div>
      <div v-if="loading" class="viewer-loading">Loading PDF...</div>
      <div v-else-if="error" class="viewer-error">{{ error }}</div>
      <!-- The whole page renders inside a scaled wrapper (no internal PDF scroll),
           with transparent anchors over each PDF link so clicks open a new tab
           instead of the PDF navigating the iframe / the whole app. -->
      <div v-else-if="iframeSrc" class="pdf-sizer" :style="sizerStyle">
        <div class="pdf-scaler" :style="scalerStyle">
          <iframe :src="iframeSrc" class="viewer-iframe"></iframe>
          <a
            v-for="(lnk, i) in links"
            :key="i"
            class="pdf-link"
            :href="lnk.uri"
            target="_blank"
            rel="noopener noreferrer"
            :title="lnk.uri"
            :style="linkStyle(lnk)"
          ></a>
        </div>
      </div>
    </div>
    <div class="resize-handle" @pointerdown="startResize">&#8943;</div>
  </div>
</template>

<script setup>
import { reactive, ref, computed, watch, onBeforeUnmount } from 'vue'
import { useAppConfig } from '../composables/useAppConfig.js'

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

// Dock vs float is a single GLOBAL preference (cross-lesson, cross-viewport,
// cross-app), remembered in uiPrefs. Default float. Docking reserves a side
// gutter in the host layout (see MainLayout .intro-open); floating overlays.
const { uiPrefs, setUIPref } = useAppConfig()
const docked = computed(() => uiPrefs.value.introDock === 'dock')
function toggleDock() {
  const next = docked.value ? 'float' : 'dock'
  setUIPref('introDock', next)
  // Snap to the left edge when docking, so the reserved gutter lines up.
  if (next === 'dock') { pos.x = 8; pos.y = 80 }
}

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
// whole page at a fixed 2x zoom (#zoom=200 → crisp 2x raster) filling a wrapper
// sized to the page's natural size × 2 (read from the PDF MediaBox), then CSS-scale
// that wrapper to the viewer. Scaling DOWN from the 2x render stays sharp; the scale
// tracks the window size, so dragging the box bigger enlarges the text. Rendering
// the full page (not just the body height) means no internal PDF scroll, so the
// link overlays stay aligned as the viewer body scrolls.
const ZOOM = 2
const PT_TO_PX = (96 / 72) * ZOOM // 1 PDF point -> px in the 2x-rendered page
const TITLEBAR = 40
const pageWPt = ref(396)   // 5.5in default; updated per-PDF from MediaBox
const pageHPt = ref(478.8)
const links = ref([])      // [{ uri, rect: [x0,y0,x1,y1] in pt, y from bottom }]
const baseW = computed(() => pageWPt.value * PT_TO_PX)
const baseH = computed(() => pageHPt.value * PT_TO_PX)
const pdfScale = computed(() => size.w / baseW.value)
const scalerStyle = computed(() => ({
  width: baseW.value + 'px',
  height: baseH.value + 'px',
  transform: `scale(${pdfScale.value})`,
  transformOrigin: '0 0'
}))
// A real (non-transformed) box at the SCALED size, so the body gets a correct
// scroll height — the transformed scaler alone wouldn't contribute one.
const sizerStyle = computed(() => ({
  width: (baseW.value * pdfScale.value) + 'px',
  height: (baseH.value * pdfScale.value) + 'px'
}))
// Transparent anchor box over a PDF link, in the wrapper's unscaled coordinates
// (PDF y is measured from the bottom, so flip it).
function linkStyle(lnk) {
  const [x0, y0, x1, y1] = lnk.rect
  return {
    left: (x0 * PT_TO_PX) + 'px',
    top: ((pageHPt.value - y1) * PT_TO_PX) + 'px',
    width: ((x1 - x0) * PT_TO_PX) + 'px',
    height: ((y1 - y0) * PT_TO_PX) + 'px'
  }
}

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
    // Read the page size + link annotations from the PDF text (reportlab writes
    // them in plaintext). Page size drives the CSS scaling (pbs intros are 5.5in;
    // Baker's are Letter 8.5in); links become the transparent new-tab overlays.
    const text = new TextDecoder('latin1').decode(new Uint8Array(buf))
    const mb = text.match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/)
    if (mb) {
      pageWPt.value = parseFloat(mb[3]) - parseFloat(mb[1])
      pageHPt.value = parseFloat(mb[4]) - parseFloat(mb[2])
    }
    links.value = parseLinks(text)
    const pdfBlob = new Blob([buf], { type: 'application/pdf' })
    blobUrl.value = URL.createObjectURL(pdfBlob)
  } catch (err) {
    error.value = 'Could not load PDF'
    console.error('Failed to fetch intro PDF:', err)
  } finally {
    loading.value = false
  }
}

// Parse /Link annotations (URI + Rect) from the PDF text. reportlab emits each as
// an object holding both, e.g. `/A << /S /URI /URI (https://…) >> /Rect [ … ]`.
function parseLinks(pdfText) {
  const out = []
  const objRe = /\d+\s+0\s+obj([\s\S]*?)endobj/g
  let m
  while ((m = objRe.exec(pdfText))) {
    const body = m[1]
    const uri = body.match(/\/URI\s*\(([^)]*)\)/)
    const rect = body.match(/\/Rect\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/)
    if (uri && rect) out.push({ uri: uri[1], rect: rect.slice(1, 5).map(Number) })
  }
  return out
}

function cleanup() {
  if (blobUrl.value) {
    URL.revokeObjectURL(blobUrl.value)
    blobUrl.value = null
  }
  links.value = []
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

.viewer-btn.active {
  opacity: 1;
  background: rgba(255, 255, 255, 0.22);
  border-radius: 4px;
}

.viewer-btn.close {
  font-size: 22px;
}

.viewer-body {
  flex: 1;
  position: relative;
  overflow: auto; /* scrolls the scaled page; overlays scroll with it, staying aligned */
}

.interaction-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  cursor: grabbing;
}

/* Real-sized box (scaled dimensions) that gives the body its scroll height. */
.pdf-sizer {
  position: relative;
}

/* Holds the full-page iframe + link overlays; CSS-scaled to the viewer (inline). */
.pdf-scaler {
  position: absolute;
  top: 0;
  left: 0;
}

.viewer-iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: none;
}

/* Transparent click target sitting over a PDF link; opens it in a new tab. */
.pdf-link {
  position: absolute;
  z-index: 2;
  cursor: pointer;
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

<template>
  <DockablePanel
    :visible="visible"
    title="Lesson Introduction"
    :new-tab-href="blobUrl || ''"
    :initial-width="550"
    :initial-height="700"
    :aspect-floor="ASPECT"
    @close="$emit('close')"
    @geometry="$emit('geometry', $event)"
  >
    <template #default="{ width }">
      <div v-if="loading" class="viewer-loading">Loading PDF...</div>
      <div v-else-if="error" class="viewer-error">{{ error }}</div>
      <!-- The whole page renders inside a scaled wrapper (no internal PDF scroll),
           with transparent anchors over each PDF link so clicks open a new tab
           instead of the PDF navigating the iframe / the whole app. -->
      <div v-else-if="iframeSrc" class="pdf-sizer" :style="sizerStyle(width)">
        <div class="pdf-scaler" :style="scalerStyle(width)">
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
    </template>
  </DockablePanel>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import DockablePanel from './DockablePanel.vue'

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

defineEmits(['close', 'geometry'])

// Proportional text. The embedded PDF viewer only fits-to-width at load and won't
// re-fit on resize, and #zoom=page-width won't enlarge past 100%. So we render the
// whole page at a fixed 2x zoom (#zoom=200 → crisp 2x raster) filling a wrapper
// sized to the page's natural size × 2 (read from the PDF MediaBox), then CSS-scale
// that wrapper to the panel width. Scaling DOWN from the 2x render stays sharp; the
// scale tracks the panel width, so dragging the box bigger enlarges the text.
// Rendering the full page (not just the body height) means no internal PDF scroll,
// so the link overlays stay aligned as the body scrolls.
const ZOOM = 2
const PT_TO_PX = (96 / 72) * ZOOM // 1 PDF point -> px in the 2x-rendered page
const TITLEBAR = 40
// DockablePanel widens the box in step with height using this floor, so dragging
// the box TALLER also enlarges the width-tracked text (default body-height : width).
const ASPECT = (700 - TITLEBAR) / 550
const pageWPt = ref(396)   // 5.5in default; updated per-PDF from MediaBox
const pageHPt = ref(478.8)
const links = ref([])      // [{ uri, rect: [x0,y0,x1,y1] in pt, y from bottom }]
const baseW = computed(() => pageWPt.value * PT_TO_PX)
const baseH = computed(() => pageHPt.value * PT_TO_PX)
// Scale + box sizing track the panel's live width (passed from DockablePanel).
function pdfScale(width) { return width / baseW.value }
function scalerStyle(width) {
  return {
    width: baseW.value + 'px',
    height: baseH.value + 'px',
    transform: `scale(${pdfScale(width)})`,
    transformOrigin: '0 0'
  }
}
// A real (non-transformed) box at the SCALED size, so the body gets a correct
// scroll height — the transformed scaler alone wouldn't contribute one.
function sizerStyle(width) {
  return {
    width: (baseW.value * pdfScale(width)) + 'px',
    height: (baseH.value * pdfScale(width)) + 'px'
  }
}
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
// CSS-scaled to the panel width (see scalerStyle).
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

// Fetch when visible and URL changes
watch(() => [props.visible, props.url], ([visible, url]) => {
  if (visible && url) {
    fetchPdf(url)
  } else if (!visible) {
    cleanup()
  }
}, { immediate: true })

onBeforeUnmount(cleanup)
</script>

<style scoped>
/* Real-sized box (scaled dimensions) that gives the body its scroll height. */
.pdf-sizer {
  position: relative;
}

/* Holds the full-page iframe + link overlays; CSS-scaled to the panel width. */
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
</style>

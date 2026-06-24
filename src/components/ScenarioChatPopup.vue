<template>
  <div
    v-if="visible"
    ref="popoverEl"
    class="sc-popup"
    :style="{ top: pos.top + 'px', left: pos.left + 'px' }"
    role="dialog"
    aria-labelledby="sc-title"
  >
    <div class="sc-header" @mousedown="startDrag" title="Drag to move">
      <h3 id="sc-title" class="sc-title">{{ title }}</h3>
      <button class="sc-x" @click="emit('close')" aria-label="Close" title="Close">×</button>
    </div>
    <div class="sc-body" v-html="html"></div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  title: { type: String, default: 'Scenario' },
  // Raw @chat block text from the .btn file.
  text: { type: String, default: '' },
  // Which edge to open against: 'left' (default) or 'right'.
  side: { type: String, default: 'left' }
})
const emit = defineEmits(['close'])

const popoverEl = ref(null)
const pos = ref({ top: 90, left: 120 })

// Render the BBO-flavoured @chat text: !C/!D/!H/!S → coloured suit symbols,
// "--- Heading" lines → a heading, URLs → links. Line breaks preserved.
const SUIT = { C: ['♣', 'sc-black'], D: ['♦', 'sc-red'], H: ['♥', 'sc-red'], S: ['♠', 'sc-black'], N: ['NT', ''] }
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function inline(s) {
  let h = esc(s).replace(/!([CDHSN])/g, (_, k) => {
    const [sym, cls] = SUIT[k]
    return cls ? `<span class="${cls}">${sym}</span>` : sym
  })
  h = h.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
  return h
}
const html = computed(() =>
  (props.text || '').split('\n').map(line => {
    const t = line.match(/^---\s*(.+)$/)
    return t ? `<div class="sc-heading">${inline(t[1])}</div>` : inline(line)
  }).join('\n')
)

// Position centered-ish on open; wire Esc.
watch(() => props.visible, (open) => {
  if (open) {
    // Open near the left edge, sized to fit the text. Measure after render
    // (nextTick) so a tall popup is clamped to stay on-screen.
    nextTick(() => {
      const el = popoverEl.value
      const w = el?.offsetWidth || 720
      const left = props.side === 'right' ? window.innerWidth - w - 16 : 16
      pos.value = clamp(left, 80, w, el?.offsetHeight || 440)
    })
    window.addEventListener('keydown', onKeydown)
  } else {
    cleanup()
  }
})

function clamp(left, top, w, h) {
  const m = 8
  return {
    left: Math.max(m, Math.min(left, window.innerWidth - w - m)),
    top: Math.max(m, Math.min(top, window.innerHeight - h - m))
  }
}

// --- Dragging (grab the header) ---
let drag = null
function startDrag(e) {
  if (e.target.closest('.sc-x')) return
  drag = { mx: e.clientX, my: e.clientY, top: pos.value.top, left: pos.value.left }
  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', endDrag)
  e.preventDefault()
}
function onDrag(e) {
  if (!drag) return
  const el = popoverEl.value
  pos.value = clamp(
    drag.left + (e.clientX - drag.mx),
    drag.top + (e.clientY - drag.my),
    el?.offsetWidth || 720,
    el?.offsetHeight || 440
  )
}
function endDrag() {
  drag = null
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', endDrag)
}

function onKeydown(e) { if (e.key === 'Escape') emit('close') }

function cleanup() {
  endDrag()
  window.removeEventListener('keydown', onKeydown)
}
onUnmounted(cleanup)
</script>

<style scoped>
/* Sizable (drag the bottom-right corner to resize) + movable (drag the header). */
.sc-popup {
  position: fixed;
  z-index: 2100;
  width: 720px;
  height: auto;          /* fit the text */
  min-width: 320px;
  max-width: calc(100vw - 16px);
  max-height: calc(100vh - 32px);
  background: #fff;
  border: 1px solid var(--card-border, #ddd);
  border-radius: 8px;
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  resize: both;
}

.sc-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px 10px 16px;
  background: #2d6a4f;
  cursor: move;
  user-select: none;
}

.sc-title {
  margin: 0;
  font-size: 19px;
  font-weight: 700;
  color: #fff;
}

.sc-x {
  border: none;
  background: transparent;
  color: #fff;
  font-size: 22px;
  line-height: 1;
  padding: 0 4px;
  cursor: pointer;
  opacity: 0.85;
}
.sc-x:hover { opacity: 1; }

.sc-body {
  flex: 1 1 auto;
  padding: 16px 18px;
  font-size: 18px;
  line-height: 1.55;
  color: #222;
  white-space: pre-wrap;
  overflow: auto;
}

.sc-body :deep(.sc-heading) {
  font-weight: 700;
  font-size: 20px;
  margin-bottom: 8px;
  color: #1b4332;
}
.sc-body :deep(.sc-red) { color: #d32f2f; }
.sc-body :deep(.sc-black) { color: #000; }
.sc-body :deep(a) { color: #1976d2; }
</style>

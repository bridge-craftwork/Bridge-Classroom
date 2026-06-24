<template>
  <div
    v-if="visible"
    ref="popoverEl"
    class="rp-popover"
    :style="{ top: pos.top + 'px', left: pos.left + 'px' }"
    role="dialog"
    aria-labelledby="rp-title"
  >
    <!-- Drag handle -->
    <div class="rp-header" @mousedown="startDrag" title="Drag to move">
      <h2 id="rp-title" class="rp-title">Report a Problem</h2>
      <button class="rp-x" @click="close" aria-label="Close" title="Close">×</button>
    </div>

    <div class="rp-body">
      <!-- Idle / editing -->
      <template v-if="state === 'idle' || state === 'submitting'">
        <p class="rp-sub">
          Spotted something wrong with this board? Tell us in a sentence — it
          goes straight to the people who maintain the lessons.
        </p>
        <textarea
          ref="noteInput"
          v-model="note"
          class="rp-textarea"
          rows="4"
          placeholder="e.g. The recommended bid here looks wrong…"
          :disabled="state === 'submitting'"
          @keydown.enter.exact.prevent="submit"
          @keydown.esc="close"
        ></textarea>
        <div class="rp-hint">Press <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line</div>
        <div class="rp-actions">
          <button class="rp-btn rp-btn-secondary" @click="close" :disabled="state === 'submitting'">Cancel</button>
          <button class="rp-btn rp-btn-primary" @click="submit" :disabled="!note.trim() || state === 'submitting'">
            {{ state === 'submitting' ? 'Sending…' : 'Send report' }}
          </button>
        </div>
      </template>

      <!-- Success -->
      <template v-else-if="state === 'done'">
        <p class="rp-done">✓ Thanks — reported.</p>
        <p class="rp-sub">We’ll take a look. You can keep practicing.</p>
        <div class="rp-actions">
          <button class="rp-btn rp-btn-primary" @click="close">Close</button>
        </div>
      </template>

      <!-- Error / not configured -->
      <template v-else-if="state === 'error'">
        <p class="rp-error">{{ errorMessage }}</p>
        <div class="rp-actions">
          <button class="rp-btn rp-btn-secondary" @click="close">Close</button>
          <button v-if="canRetry" class="rp-btn rp-btn-primary" @click="retry">Try again</button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onUnmounted } from 'vue'
import { useReportProblem } from '../composables/useReportProblem.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
  // Snapshot of lesson/board state captured when the popup was opened.
  context: { type: Object, default: () => ({}) },
  // The Report button's bounding rect, so we can open just below it.
  anchor: { type: Object, default: null }
})
const emit = defineEmits(['close'])

const { submitReport } = useReportProblem()

const note = ref('')
const state = ref('idle')  // idle | submitting | done | error
const errorMessage = ref('')
const canRetry = ref(false)
const noteInput = ref(null)
const popoverEl = ref(null)
const pos = ref({ top: 100, left: 100 })

let autoCloseTimer = null

// Reset, position, and focus whenever the popup opens.
watch(() => props.visible, (open) => {
  if (open) {
    note.value = ''
    state.value = 'idle'
    errorMessage.value = ''
    canRetry.value = false
    place()
    window.addEventListener('keydown', onKeydown)
    nextTick(() => noteInput.value?.focus())
  } else {
    cleanup()
  }
})

// Open right below the button, right-aligned to it, clamped to the viewport.
function place() {
  const a = props.anchor
  nextTick(() => {
    const el = popoverEl.value
    const w = el?.offsetWidth || 360
    const h = el?.offsetHeight || 280
    const gap = 8
    let left, top
    if (a) {
      left = a.right - w
      top = a.bottom + gap
    } else {
      left = window.innerWidth - w - 24
      top = 100
    }
    pos.value = clamp(left, top, w, h)
  })
}

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
  if (e.target.closest('.rp-x')) return  // don't drag when hitting the close button
  drag = { mx: e.clientX, my: e.clientY, top: pos.value.top, left: pos.value.left }
  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', endDrag)
  e.preventDefault()  // avoid selecting text while dragging
}
function onDrag(e) {
  if (!drag) return
  const el = popoverEl.value
  const w = el?.offsetWidth || 360
  const h = el?.offsetHeight || 280
  pos.value = clamp(drag.left + (e.clientX - drag.mx), drag.top + (e.clientY - drag.my), w, h)
}
function endDrag() {
  drag = null
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', endDrag)
}

function onKeydown(e) {
  if (e.key === 'Escape') close()
}

async function submit() {
  const trimmed = note.value.trim()
  if (!trimmed || state.value === 'submitting') return
  state.value = 'submitting'

  const result = await submitReport({ ...props.context, note: trimmed })

  if (result.ok) {
    state.value = 'done'
    // Auto-dismiss after a few seconds; Close also works.
    autoCloseTimer = setTimeout(() => close(), 3000)
  } else {
    state.value = 'error'
    if (result.reason === 'not_configured') {
      errorMessage.value = 'Reporting isn’t set up on this server yet — please let your teacher know.'
      canRetry.value = false
    } else {
      errorMessage.value = 'Sorry, the report didn’t go through. Please try again in a moment.'
      canRetry.value = true
    }
  }
}

function retry() {
  state.value = 'idle'
  errorMessage.value = ''
  nextTick(() => noteInput.value?.focus())
}

function close() {
  cleanup()
  emit('close')
}

function cleanup() {
  if (autoCloseTimer) { clearTimeout(autoCloseTimer); autoCloseTimer = null }
  endDrag()
  window.removeEventListener('keydown', onKeydown)
}

onUnmounted(cleanup)
</script>

<style scoped>
.rp-popover {
  position: fixed;
  z-index: 2000;
  width: 360px;
  max-width: calc(100vw - 16px);
  background: #fff;
  border: 1px solid var(--card-border, #ddd);
  border-radius: var(--radius-card, 8px);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28);
  overflow: hidden;
}

.rp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px 10px 16px;
  background: var(--green-dark, #2d6a4f);
  cursor: move;
  user-select: none;
}

.rp-title {
  font-family: var(--font-heading, 'Source Serif 4', serif);
  font-size: 18px;
  color: #fff;
  margin: 0;
}

.rp-x {
  border: none;
  background: transparent;
  color: #fff;
  font-size: 22px;
  line-height: 1;
  padding: 0 4px;
  cursor: pointer;
  opacity: 0.85;
}
.rp-x:hover { opacity: 1; }

.rp-body {
  padding: 16px;
}

.rp-sub {
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-secondary, #555);
  margin-bottom: 12px;
}

.rp-textarea {
  width: 100%;
  font-family: inherit;
  font-size: 16px;
  line-height: 1.5;
  padding: 10px;
  border: 1px solid var(--card-border, #ccc);
  border-radius: var(--radius-button, 6px);
  resize: vertical;
}

.rp-textarea:focus {
  outline: none;
  border-color: var(--green-mid, #2d6a4f);
  box-shadow: 0 0 0 2px rgba(45, 106, 79, 0.15);
}

.rp-hint {
  font-size: 12px;
  color: #888;
  margin-top: 6px;
}

.rp-hint kbd {
  font-family: monospace;
  background: #f0f0f0;
  border: 1px solid #ddd;
  border-radius: 3px;
  padding: 0 4px;
}

.rp-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}

.rp-btn {
  padding: 9px 16px;
  font-size: 15px;
  font-weight: 600;
  border: none;
  border-radius: var(--radius-button, 6px);
  cursor: pointer;
  transition: background 0.2s;
}

.rp-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.rp-btn-primary {
  background: var(--green-dark, #2d6a4f);
  color: #fff;
}

.rp-btn-primary:not(:disabled):hover {
  background: var(--green-darker, #1b4332);
}

.rp-btn-secondary {
  background: #e0e0e0;
  color: #333;
}

.rp-btn-secondary:not(:disabled):hover {
  background: #d0d0d0;
}

.rp-done {
  font-size: 18px;
  font-weight: 600;
  color: #2e7d32;
  margin-bottom: 8px;
}

.rp-error {
  font-size: 15px;
  line-height: 1.5;
  color: #c62828;
  margin-bottom: 4px;
}
</style>

<!--
  BeetleButton — the in-app problem-report trigger (spec §8).

  SLICE 0 scope: dev-only. A tap captures a screenshot (before any dialog covers
  the screen, §4) and opens ReportDialog, which writes a bundle to the local dev
  sink and hands back a copy-able CC prompt. No GitHub, no sanitization, no
  consent — that arrives in Slice 1, when the same button/dialog gain the privacy
  preview, identity, and a pluggable GitHub sink.

  Mounted once at the app root (App.vue), so it rides every shell automatically.
-->
<template>
  <div class="beetle-root">
    <button
      class="beetle-btn"
      :disabled="capturing"
      :title="capturing ? 'Capturing…' : 'Report a bug (dev): capture a state bundle'"
      aria-label="Report a bug"
      @click="onClick"
    >
      🐞
    </button>
    <transition name="beetle-fade">
      <div v-if="toast" class="beetle-toast">{{ toast }}</div>
    </transition>
  </div>
  <ReportDialog v-if="dialogOpen" :screenshot="screenshot" :client-hints="clientHints" :layout="layout" @close="closeDialog" @saved="onSaved" />
</template>

<script setup>
import { ref } from 'vue'
import { captureScreenshot } from './screenshot.js'
import { collectClientHints } from './env.js'
import { collectLayout } from './layout.js'
import ReportDialog from './ReportDialog.vue'

const capturing = ref(false)
const dialogOpen = ref(false)
const screenshot = ref(null)
const clientHints = ref(null)
const layout = ref(null)
const toast = ref('')
let toastTimer = null

async function onClick() {
  if (capturing.value || dialogOpen.value) return
  capturing.value = true
  try {
    // Freeze the layout snapshot NOW — on the tap, against the real buggy DOM,
    // BEFORE the screenshot's transient style-freeze and before the dialog opens
    // (or a bot/timer mutates the table). This matches what the screenshot shows.
    // collectLayout() is guarded (returns null on any error), but wrap anyway so
    // a capture hiccup can never stop the report.
    layout.value = collectLayoutSafe()

    // §4: capture the screen BEFORE the dialog covers it. Grab the async UA
    // client hints (architecture etc.) in the same beat.
    const [shot, hints] = await Promise.all([
      captureScreenshot().catch((err) => { console.warn('[report] screenshot failed:', err); return null }),
      collectClientHints()
    ])
    screenshot.value = shot
    clientHints.value = hints
  } finally {
    capturing.value = false
    dialogOpen.value = true
  }
}

function collectLayoutSafe() {
  try {
    return collectLayout()
  } catch (err) {
    console.warn('[report] layout capture failed (continuing):', err)
    return null
  }
}

function closeDialog() {
  dialogOpen.value = false
  screenshot.value = null
  clientHints.value = null
  layout.value = null
}

// Report finished (local bundle saved + copied, or GitHub issue filed): close the
// dialog and flash a self-dismissing toast with the sink-specific message.
function onSaved(payload) {
  closeDialog()
  toast.value = payload?.message || '✓ Reported'
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = '' }, 4000)
}
</script>

<style scoped>
.beetle-root {
  position: fixed;
  right: 16px;
  bottom: 96px; /* lifted clear of the footer (Discord/GitHub) + its divider line */
  z-index: 2147483000; /* above app modals; this is a dev tool */
  display: flex;
  flex-direction: column-reverse;
  align-items: flex-end;
  gap: 8px;
  pointer-events: none;
}
.beetle-toast {
  pointer-events: auto;
  max-width: 280px;
  padding: 9px 13px;
  border-radius: 8px;
  background: var(--green-dark, #2d6a4f);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.3);
}
.beetle-fade-enter-active, .beetle-fade-leave-active { transition: opacity 0.25s ease; }
.beetle-fade-enter-from, .beetle-fade-leave-to { opacity: 0; }
.beetle-btn {
  pointer-events: auto;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.15);
  background: #fff8e1;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.55;
  transition: opacity 0.15s ease, transform 0.1s ease;
}
.beetle-btn:hover { opacity: 1; }
.beetle-btn:active { transform: scale(0.94); }
.beetle-btn:disabled { cursor: progress; opacity: 0.4; }
</style>

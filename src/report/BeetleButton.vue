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
  <ReportDialog v-if="dialogOpen" :screenshot="screenshot" :screenshot-boxes="screenshotBoxes" :client-hints="clientHints" :layout="layout" :shell-enrich="shellEnrich" @close="closeDialog" @saved="onSaved" />
</template>

<script setup>
import { ref } from 'vue'
import { captureScreenshot } from './screenshot.js'
import { collectClientHints } from './env.js'
import { collectLayout } from './layout.js'
import { captureReportContext } from './reportContext.js'
import ReportDialog from './ReportDialog.vue'

const capturing = ref(false)
const dialogOpen = ref(false)
const screenshot = ref(null)
// Second screenshot with the bounding-box diagnostic overlay on (grid layouts only).
const screenshotBoxes = ref(null)
const clientHints = ref(null)
const layout = ref(null)
// App-shell forensic context frozen on the tap (the active shell's provider, e.g. the
// A1 grid shell's captureA1Snapshot → enrich fragments). null when no shell registered.
const shellEnrich = ref(null)
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
    // Same beat: freeze the active shell's diagnostic context (arrangement, ledger,
    // phase, gallery-loadable fixture) against the same DOM. Guarded to null.
    shellEnrich.value = captureReportContext()

    // §4: capture the screen BEFORE the dialog covers it. Grab the async UA
    // client hints (architecture etc.) in the same beat.
    const [shot, hints] = await Promise.all([
      captureScreenshot().catch((err) => { console.warn('[report] screenshot failed:', err); return null }),
      collectClientHints()
    ])
    screenshot.value = shot
    clientHints.value = hints
    // Second capture WITH the bounding-box overlay, so a grid-layout bug bundles its own
    // layout X-ray (grid-arranger-spec §5.1). Only when a grid is on screen and the
    // overlay isn't already showing (else the first shot already has it). Guarded to null.
    screenshotBoxes.value = await captureBoundingBoxesShot()
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

// Capture a second screenshot with the arranger's bounding-box overlay turned on. Only
// meaningful on a grid arrangement (the overlay styles `.grid-table`); returns null when
// there's no grid, or when the overlay is already on (the primary shot already shows it).
// Toggles the attribute for the capture and restores it. Fully guarded — a failure here
// must never block the report.
async function captureBoundingBoxesShot() {
  // Guards BEFORE the try, so we never touch the attribute we didn't set: skip when
  // there's no grid, or when the overlay is already on (the primary shot has it).
  if (!document.querySelector('.grid-table')) return null
  if (document.documentElement.hasAttribute('data-bounding-boxes')) return null
  try {
    document.documentElement.setAttribute('data-bounding-boxes', '')
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    return await captureScreenshot().catch(() => null)
  } catch (err) {
    console.warn('[report] bounding-boxes screenshot failed (continuing):', err)
    return null
  } finally {
    document.documentElement.removeAttribute('data-bounding-boxes') // restore (we set it)
  }
}

function closeDialog() {
  dialogOpen.value = false
  screenshot.value = null
  screenshotBoxes.value = null
  clientHints.value = null
  layout.value = null
  shellEnrich.value = null
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

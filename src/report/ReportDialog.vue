<!--
  ReportDialog — the beetle's capture dialog (Slice 0, dev sink only).

  One Submit click saves the bundle AND copies the CC prompt to the clipboard
  (the sink copies first, then writes — see saveToDevSink), then the dialog closes
  and the beetle flashes a toast. No follow-up click.

  The only time a second click appears is the fallback: if auto-copy was blocked
  (typically the very first save, where the folder-picker consumed the click's
  activation), the dialog stays open with the prompt and an explicit Copy button —
  a fresh gesture that always works. After the one-time folder pick, every Submit
  is a single click.

  Slice 1 grows this into the real user-facing dialog (privacy preview + identity
  + GitHub sink). For now it is dev-only and unsanitized.
-->
<template>
  <div class="br-overlay" @click.self="onCancel">
    <div class="br-dialog" role="dialog" aria-labelledby="br-title">
      <div class="br-header">
        <h2 id="br-title" class="br-title">🐞 Report a bug (dev)</h2>
        <button class="br-x" aria-label="Close" @click="onCancel">×</button>
      </div>

      <div class="br-body">
        <!-- Compose -->
        <template v-if="phase === 'compose'">
          <div v-if="screenshotUrl" class="br-shot">
            <img :src="screenshotUrl" alt="Captured screenshot" />
          </div>
          <p v-else class="br-noshot">No screenshot was captured.</p>

          <textarea
            ref="noteEl"
            v-model="note"
            class="br-textarea"
            rows="4"
            placeholder="What went wrong? What did you expect?"
          ></textarea>

          <p class="br-env">{{ envSummary }}</p>

          <div class="br-actions">
            <button class="br-btn br-btn-secondary" @click="onCancel">Cancel</button>
            <button class="br-btn br-btn-primary" :disabled="saving" @click="submit">
              {{ saving ? 'Saving…' : 'Submit' }}
            </button>
          </div>
        </template>

        <!-- Manual-copy fallback (auto-copy was blocked, typically first save) -->
        <template v-else-if="phase === 'manual'">
          <p class="br-saved">✓ Bundle saved</p>
          <p class="br-path"><code>{{ result.path }}</code></p>
          <p class="br-copyfail">Couldn't copy automatically — copy the prompt below.</p>

          <label class="br-prompt-label">Claude Code prompt</label>
          <textarea class="br-prompt" readonly rows="7" :value="result.ccPrompt"></textarea>

          <div class="br-actions">
            <button class="br-btn br-btn-secondary" @click="onCancel">Close</button>
            <button class="br-btn br-btn-primary" @click="copyManual">Copy prompt &amp; close</button>
          </div>
        </template>

        <!-- Error -->
        <template v-else-if="phase === 'error'">
          <p class="br-error">Couldn't save the bundle: {{ errorMessage }}</p>
          <div class="br-actions">
            <button class="br-btn br-btn-secondary" @click="onCancel">Close</button>
            <button class="br-btn br-btn-primary" @click="submit">Try again</button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { collectEnv } from './env.js'
import { collectReport } from './ReportCollector.js'
import { ensureDirHandle, saveToDevSink } from './sinks/devSink.js'
import { writeClipboard } from './clipboard.js'

const props = defineProps({
  // Pre-captured screenshot Blob (captured on the beetle tap, before this opened).
  screenshot: { type: Object, default: null }
})
// `saved` = fully done (bundle written + prompt copied); parent closes + toasts.
const emit = defineEmits(['close', 'saved'])

const phase = ref('compose') // compose | manual | error
const note = ref('')
const saving = ref(false)
const errorMessage = ref('')
const result = ref(null)
const noteEl = ref(null)

const env = collectEnv()
const screenshotUrl = props.screenshot ? URL.createObjectURL(props.screenshot) : null

const envSummary = computed(() => {
  const v = env.viewport || {}
  return [
    env.app && `app: ${env.app}`,
    env.route && `route: ${env.route}`,
    v.w && `${v.w}×${v.h}@${v.dpr}`,
    env.commit && `commit: ${env.commit}`
  ].filter(Boolean).join('  ·  ')
})

onMounted(() => nextTick(() => noteEl.value?.focus()))
onUnmounted(() => { if (screenshotUrl) URL.revokeObjectURL(screenshotUrl) })

async function submit() {
  if (saving.value) return
  saving.value = true
  errorMessage.value = ''
  try {
    // The Submit click is a live gesture — resolve the picker here (first run
    // only) so the File System Access permission prompt is allowed. The sink
    // then copies the prompt before writing files.
    let dirHandle = null
    try {
      dirHandle = await ensureDirHandle()
    } catch {
      dirHandle = null // aborted / unavailable → sink falls back to file download
    }
    const bundle = collectReport({ note: note.value, screenshot: props.screenshot, enrich: { env } })
    result.value = await saveToDevSink(bundle, { dirHandle })

    if (result.value.copied) {
      emit('saved') // parent closes the dialog + flashes the toast
    } else {
      // Auto-copy was blocked (first-run picker ate the activation) — offer a
      // manual copy so the prompt isn't lost. One-time; later saves copy fine.
      phase.value = 'manual'
    }
  } catch (err) {
    console.error('[report] dev sink failed:', err)
    errorMessage.value = err?.message || String(err)
    phase.value = 'error'
  } finally {
    saving.value = false
  }
}

async function copyManual() {
  if (await writeClipboard(result.value?.ccPrompt || '')) emit('saved')
  // If even the manual copy fails, leave the dialog open so the text stays
  // selectable; nothing more we can do programmatically.
}

function onCancel() {
  emit('close')
}
</script>

<style scoped>
.br-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483001;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.br-dialog {
  width: 460px;
  max-width: 100%;
  max-height: calc(100vh - 48px);
  overflow: auto;
  background: #fff;
  border-radius: var(--radius-card, 8px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}
.br-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 10px 16px;
  background: var(--green-dark, #2d6a4f);
}
.br-title {
  margin: 0;
  font-family: var(--font-heading, 'Source Serif 4', serif);
  font-size: 17px;
  color: #fff;
}
.br-x {
  border: none;
  background: transparent;
  color: #fff;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.85;
}
.br-x:hover { opacity: 1; }
.br-body { padding: 16px; }
.br-shot {
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 12px;
  background: #fafafa;
}
.br-shot img { display: block; width: 100%; height: auto; }
.br-noshot { font-size: 13px; color: #999; margin-bottom: 12px; }
.br-textarea {
  width: 100%;
  font-family: inherit;
  font-size: 15px;
  line-height: 1.5;
  padding: 10px;
  border: 1px solid var(--card-border, #ccc);
  border-radius: var(--radius-button, 6px);
  resize: vertical;
}
.br-textarea:focus {
  outline: none;
  border-color: var(--green-mid, #2d6a4f);
  box-shadow: 0 0 0 2px rgba(45, 106, 79, 0.15);
}
.br-env {
  font-family: monospace;
  font-size: 12px;
  color: #666;
  margin: 10px 0 0;
  word-break: break-word;
}
.br-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}
.br-btn {
  padding: 9px 16px;
  font-size: 15px;
  font-weight: 600;
  border: none;
  border-radius: var(--radius-button, 6px);
  cursor: pointer;
}
.br-btn:disabled { opacity: 0.5; cursor: default; }
.br-btn-primary { background: var(--green-dark, #2d6a4f); color: #fff; }
.br-btn-primary:not(:disabled):hover { background: var(--green-darker, #1b4332); }
.br-btn-secondary { background: #e0e0e0; color: #333; }
.br-btn-secondary:not(:disabled):hover { background: #d0d0d0; }
.br-saved { font-size: 17px; font-weight: 600; color: #2e7d32; margin: 0 0 6px; }
.br-path { margin: 0 0 10px; word-break: break-all; }
.br-path code { font-size: 13px; background: #f2f2f2; padding: 2px 6px; border-radius: 4px; }
.br-copyfail { font-size: 13px; color: #c62828; margin: 0 0 12px; }
.br-prompt-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: #555;
  margin-bottom: 4px;
}
.br-prompt {
  width: 100%;
  font-family: monospace;
  font-size: 12px;
  line-height: 1.45;
  padding: 10px;
  border: 1px solid var(--card-border, #ccc);
  border-radius: var(--radius-button, 6px);
  background: #fafafa;
  resize: vertical;
}
.br-error { font-size: 15px; color: #c62828; line-height: 1.5; }
</style>

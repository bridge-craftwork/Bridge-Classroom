<!--
  ReportDialog — the beetle's capture dialog.

  Two sinks:
  • Issue (public, all users): files a GitHub issue via the backend → private
    artifacts repo. Carries the privacy preview + identity (named / contactable /
    anonymous). Sanitization/consent live here, on this sink.
  • Local (Rick + David only, gated by the localStorage flag; default in dev):
    writes the gitignored bundle + copies a CC prompt. Lean, unsanitized, no
    network — the local iteration loop.

  The Local ⟷ Issue toggle only appears when local reports are enabled; its last
  value is remembered. One Submit does the whole thing and closes to a toast.
-->
<template>
  <div class="br-overlay" @click.self="onCancel">
    <div class="br-dialog" role="dialog" aria-labelledby="br-title">
      <div class="br-header">
        <h2 id="br-title" class="br-title">🐞 Report a bug</h2>
        <button class="br-x" aria-label="Close" @click="onCancel">×</button>
      </div>

      <div class="br-body">
        <!-- Compose -->
        <template v-if="phase === 'compose'">
          <!-- Sink toggle (only when Local is enabled) -->
          <div v-if="localEnabled" class="br-toggle" role="tablist" aria-label="Where to send">
            <button
              class="br-toggle-btn" :class="{ active: sink === 'issue' }"
              role="tab" :aria-selected="sink === 'issue'" @click="setSink('issue')"
            >File issue</button>
            <button
              class="br-toggle-btn" :class="{ active: sink === 'local' }"
              role="tab" :aria-selected="sink === 'local'" @click="setSink('local')"
            >Local report</button>
          </div>

          <div v-if="screenshotUrl" class="br-shot">
            <img :src="screenshotUrl" alt="Captured screenshot" />
          </div>
          <p v-else class="br-noshot">No screenshot was captured.</p>

          <textarea
            ref="noteEl" v-model="note" class="br-textarea" rows="4"
            placeholder="What went wrong? What did you expect?"
          ></textarea>

          <!-- Identity + privacy (issue path only) -->
          <template v-if="sink === 'issue'">
            <label class="br-check">
              <input type="checkbox" v-model="anonymous" />
              <span>Report anonymously</span>
            </label>

            <template v-if="!anonymous">
              <div class="br-field">
                <label class="br-label" for="br-name">Name shown on the report</label>
                <input id="br-name" v-model="displayName" class="br-input" type="text" maxlength="60" placeholder="Your name or an alias" />
              </div>
              <label v-if="sessionEmail" class="br-check">
                <input type="checkbox" v-model="contactable" />
                <span>May we contact you? Includes <strong>{{ sessionEmail }}</strong> in the report (never in commits).</span>
              </label>
            </template>

            <details class="br-manifest">
              <summary>What gets sent</summary>
              <ul>
                <li v-for="line in manifest" :key="line">{{ line }}</li>
              </ul>
              <p class="br-manifest-note">Sent privately to the maintainers.</p>
            </details>
          </template>

          <p class="br-env">{{ envSummary }}</p>

          <div class="br-actions">
            <button class="br-btn br-btn-secondary" @click="onCancel">Cancel</button>
            <button class="br-btn br-btn-primary" :disabled="busy || !note.trim()" @click="submit">
              {{ busy ? busyLabel : submitLabel }}
            </button>
          </div>
        </template>

        <!-- Local manual-copy fallback (auto-copy blocked, typically first save) -->
        <template v-else-if="phase === 'manual'">
          <p class="br-saved">✓ Bundle saved</p>
          <p class="br-path"><code>{{ result.path }}</code></p>
          <p class="br-copyfail">Couldn't copy automatically — copy the prompt below.</p>
          <label class="br-label">Claude Code prompt</label>
          <textarea class="br-prompt" readonly rows="7" :value="result.ccPrompt"></textarea>
          <div class="br-actions">
            <button class="br-btn br-btn-secondary" @click="onCancel">Close</button>
            <button class="br-btn br-btn-primary" @click="copyManual">Copy prompt &amp; close</button>
          </div>
        </template>

        <!-- Error -->
        <template v-else-if="phase === 'error'">
          <p class="br-error">{{ errorMessage }}</p>
          <div class="br-actions">
            <button class="br-btn br-btn-secondary" @click="onCancel">Close</button>
            <button v-if="canRetry" class="br-btn br-btn-primary" @click="phase = 'compose'">Back</button>
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
import { fileGithubIssue } from './sinks/githubSink.js'
import { writeClipboard } from './clipboard.js'
import { localReportsEnabled, loadSink, saveSink } from './flags.js'
import { useUserStore } from '@/composables/useUserStore.js'

const props = defineProps({
  screenshot: { type: Object, default: null },
  // Async UA client hints (architecture, platformVersion) captured on the tap.
  clientHints: { type: Object, default: null }
})
const emit = defineEmits(['close', 'saved'])

// Remembered identity preference, shared with the content "Report a Problem".
const ANON_KEY = 'bridgeReportAnonymous'
const NAME_KEY = 'bridgeReportName'
const CONTACT_KEY = 'bridgeReportContact'

const userStore = useUserStore()
const currentUser = userStore.currentUser

const localEnabled = localReportsEnabled()
const sink = ref(localEnabled ? loadSink() : 'issue')

const phase = ref('compose') // compose | manual | error
const note = ref('')
const busy = ref(false)
const errorMessage = ref('')
const canRetry = ref(false)
const result = ref(null)
const noteEl = ref(null)

// Identity (issue path)
const anonymous = ref(readBool(ANON_KEY, true))
const contactable = ref(readBool(CONTACT_KEY, false))
const displayName = ref(loadStr(NAME_KEY) || defaultName())
const sessionEmail = computed(() => (currentUser.value?.email || '').trim())

// Base env + the async client hints (architecture/platformVersion) folded in, so
// both the on-screen summary and the committed bundle carry them.
const env = {
  ...collectEnv(),
  ...(props.clientHints
    ? { architecture: props.clientHints.architecture, platformVersion: props.clientHints.platformVersion, model: props.clientHints.model }
    : {})
}
const screenshotUrl = props.screenshot ? URL.createObjectURL(props.screenshot) : null

const submitLabel = computed(() => (sink.value === 'issue' ? 'Submit report' : 'Submit'))
const busyLabel = computed(() => (sink.value === 'issue' ? 'Filing…' : 'Saving…'))

const envSummary = computed(() => {
  const v = env.viewport || {}
  return [
    env.app && `app: ${env.app}`,
    env.browser && env.browser,
    env.architecture && env.architecture,
    v.w && `${v.w}×${v.h}@${v.dpr}`,
    env.commit && `commit: ${env.commit}`
  ].filter(Boolean).join('  ·  ')
})

const manifest = computed(() => {
  const lines = [
    props.screenshot ? 'A screenshot of this screen (approximate)' : 'No screenshot',
    "This page's address, your app version, and screen size",
    'Your note above'
  ]
  if (anonymous.value) {
    lines.push('No name or contact — filed anonymously')
  } else {
    lines.push(`Your name: ${displayName.value.trim() || '(blank)'}`)
    if (contactable.value && sessionEmail.value) lines.push(`Contact email: ${sessionEmail.value}`)
  }
  return lines
})

onMounted(() => nextTick(() => noteEl.value?.focus()))
onUnmounted(() => { if (screenshotUrl) URL.revokeObjectURL(screenshotUrl) })

function setSink(s) {
  sink.value = s
  saveSink(s)
}

async function submit() {
  if (busy.value || !note.value.trim()) return
  busy.value = true
  errorMessage.value = ''
  try {
    if (sink.value === 'local') await submitLocal()
    else await submitIssue()
  } catch (err) {
    console.error('[report] submit failed:', err)
    errorMessage.value = err?.message || String(err)
    canRetry.value = true
    phase.value = 'error'
  } finally {
    busy.value = false
  }
}

async function submitLocal() {
  let dirHandle = null
  try { dirHandle = await ensureDirHandle() } catch { dirHandle = null }
  const bundle = collectReport({ note: note.value, screenshot: props.screenshot, enrich: { env } })
  result.value = await saveToDevSink(bundle, { dirHandle })
  if (result.value.copied) emit('saved', { message: '✓ Saved and prompt copied to clipboard' })
  else phase.value = 'manual'
}

async function submitIssue() {
  // Persist the identity choices as next-time defaults.
  saveBool(ANON_KEY, anonymous.value)
  saveBool(CONTACT_KEY, contactable.value)
  const name = displayName.value.trim()
  if (name) saveStr(NAME_KEY, name)

  const named = !anonymous.value && !!name
  // Display name goes into the committed context; email never does (body only).
  const reporterRecord = named ? { name } : null
  const bundle = collectReport({
    note: note.value,
    screenshot: props.screenshot,
    enrich: { env, context: { reporter: reporterRecord } }
  })

  const res = await fileGithubIssue({
    context: bundle.context,
    fixture: bundle.fixture,
    screenshotBlob: props.screenshot,
    note: note.value.trim(),
    reporterName: named ? name : null,
    contactEmail: !anonymous.value && contactable.value && sessionEmail.value ? sessionEmail.value : null
  })

  if (res.ok) {
    emit('saved', { message: `✓ Bug reported — issue #${res.issueNumber}` })
  } else if (res.reason === 'not_configured') {
    errorMessage.value = "Bug reporting isn't set up on this server yet."
    canRetry.value = false
    phase.value = 'error'
  } else {
    errorMessage.value = `Sorry, the report didn't go through. ${res.reason || ''}`.trim()
    canRetry.value = true
    phase.value = 'error'
  }
}

async function copyManual() {
  if (await writeClipboard(result.value?.ccPrompt || '')) emit('saved', { message: '✓ Saved and prompt copied to clipboard' })
}

function onCancel() {
  emit('close')
}

// ── identity helpers ────────────────────────────────────────────────────────
function defaultName() {
  const u = currentUser.value
  if (!u) return ''
  const fn = (u.firstName || '').trim()
  const li = (u.lastName || '').trim().charAt(0)
  return li ? `${fn} ${li}` : fn
}
function readBool(key, dflt) {
  try {
    const v = localStorage.getItem(key)
    if (v === null) return dflt
    return v !== 'false'
  } catch { return dflt }
}
function saveBool(key, val) { try { localStorage.setItem(key, String(val)) } catch { /* ignore */ } }
function loadStr(key) { try { return localStorage.getItem(key) || '' } catch { return '' } }
function saveStr(key, val) { try { localStorage.setItem(key, val) } catch { /* ignore */ } }
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
.br-x { border: none; background: transparent; color: #fff; font-size: 22px; line-height: 1; cursor: pointer; opacity: 0.85; }
.br-x:hover { opacity: 1; }
.br-body { padding: 16px; }
.br-toggle {
  display: inline-flex;
  border: 1px solid var(--card-border, #ccc);
  border-radius: var(--radius-button, 6px);
  overflow: hidden;
  margin-bottom: 12px;
}
.br-toggle-btn {
  border: none;
  background: #f3f3f3;
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 600;
  color: #555;
  cursor: pointer;
}
.br-toggle-btn.active { background: var(--green-dark, #2d6a4f); color: #fff; }
.br-shot { border: 1px solid #e0e0e0; border-radius: 6px; overflow: hidden; margin-bottom: 12px; background: #fafafa; }
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
.br-textarea:focus { outline: none; border-color: var(--green-mid, #2d6a4f); box-shadow: 0 0 0 2px rgba(45, 106, 79, 0.15); }
.br-check { display: flex; align-items: flex-start; gap: 8px; margin-top: 12px; font-size: 13px; color: #555; cursor: pointer; line-height: 1.4; }
.br-check input { margin-top: 2px; width: 15px; height: 15px; }
.br-field { margin-top: 10px; }
.br-label { display: block; font-size: 13px; font-weight: 600; color: #555; margin-bottom: 4px; }
.br-input {
  width: 100%;
  font-family: inherit;
  font-size: 14px;
  padding: 8px 10px;
  border: 1px solid var(--card-border, #ccc);
  border-radius: var(--radius-button, 6px);
}
.br-manifest { margin-top: 12px; font-size: 13px; color: #555; }
.br-manifest summary { cursor: pointer; font-weight: 600; }
.br-manifest ul { margin: 8px 0 4px; padding-left: 18px; }
.br-manifest li { margin: 2px 0; }
.br-manifest-note { font-size: 12px; color: #888; margin: 4px 0 0; }
.br-env { font-family: monospace; font-size: 12px; color: #666; margin: 12px 0 0; word-break: break-word; }
.br-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
.br-btn { padding: 9px 16px; font-size: 15px; font-weight: 600; border: none; border-radius: var(--radius-button, 6px); cursor: pointer; }
.br-btn:disabled { opacity: 0.5; cursor: default; }
.br-btn-primary { background: var(--green-dark, #2d6a4f); color: #fff; }
.br-btn-primary:not(:disabled):hover { background: var(--green-darker, #1b4332); }
.br-btn-secondary { background: #e0e0e0; color: #333; }
.br-btn-secondary:not(:disabled):hover { background: #d0d0d0; }
.br-saved { font-size: 17px; font-weight: 600; color: #2e7d32; margin: 0 0 6px; }
.br-path { margin: 0 0 10px; word-break: break-all; }
.br-path code { font-size: 13px; background: #f2f2f2; padding: 2px 6px; border-radius: 4px; }
.br-copyfail { font-size: 13px; color: #c62828; margin: 0 0 12px; }
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

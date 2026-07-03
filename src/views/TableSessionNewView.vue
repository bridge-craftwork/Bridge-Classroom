<template>
  <div class="tn-page">
    <div class="tn-card">
      <h2>New table session</h2>

      <!-- Gate: must be logged in (teacher for class sets) -->
      <template v-if="!currentUser">
        <p>You need to be signed in to host tables. Open the
          <a href="#/">main app</a> and sign in first.</p>
      </template>

      <!-- Success: share the URL -->
      <template v-else-if="created">
        <p class="tn-success">Session is live — share this link with your class:</p>
        <div class="tn-share">
          <input class="tn-share-url" type="text" readonly :value="shareUrl" @focus="$event.target.select()">
          <button class="tn-btn" @click="copyShareUrl">{{ copied ? 'Copied ✓' : 'Copy' }}</button>
        </div>
        <p class="tn-muted">
          This link is permanent — it always points at your latest open
          session, so students can bookmark it.
        </p>
        <div class="tn-actions">
          <button class="tn-btn tn-btn-primary" @click="openConsole">Open teacher console</button>
          <button class="tn-btn" @click="resetForm">Create another</button>
        </div>
      </template>

      <!-- The form -->
      <form v-else @submit.prevent="create">
        <!-- Library-driven session creation: pull a saved class set into
             the PBN box instead of pasting/uploading (teacher/admin). -->
        <div v-if="isTeacher" class="tn-lib">
          <button type="button" class="tn-btn tn-btn-sm" @click="showLibrary = !showLibrary">
            📚 {{ showLibrary ? 'Hide my library' : 'Load from my library' }}
          </button>
          <div v-if="showLibrary" class="tn-lib-panel">
            <DealLibraryPicker
              :owner="currentUser.id"
              :busy-id="libBusyId"
              @select="loadFromLibrary"
            />
          </div>
        </div>

        <label class="tn-label">
          Boards (PBN)
          <textarea
            v-model="pbn"
            class="tn-pbn"
            rows="8"
            placeholder='Paste PBN here — e.g.
[Board "1"]
[Dealer "N"]
[Vulnerable "None"]
[Deal "N:K843.T542.J6.863 AQJ7.K.Q75.AT942 962.AJ7.KT82.J75 T5.Q9863.A943.KQ"]'
          ></textarea>
        </label>
        <div class="tn-row tn-upload-row">
          <input ref="fileInput" type="file" accept=".pbn,.txt" class="tn-file" @change="onFile">
          <span v-if="fileName" class="tn-muted">{{ fileName }}</span>
        </div>

        <!-- Save the current boards as a reusable library file (materialized
             copy) so they're one click away next time. -->
        <div v-if="isTeacher && pbn.trim()" class="tn-row tn-save-lib">
          <input v-model="saveName" class="tn-save-name" placeholder="Save these boards as…">
          <button
            type="button"
            class="tn-btn tn-btn-sm"
            :disabled="saving || !saveName.trim()"
            @click="saveToLibrary"
          >
            {{ saving ? 'Saving…' : '💾 Save to my library' }}
          </button>
          <span v-if="saveMsg" class="tn-muted">{{ saveMsg }}</span>
        </div>

        <div class="tn-row">
          <label class="tn-label tn-inline">
            Tables
            <input v-model.number="tableCount" type="number" min="1" max="20" class="tn-num">
          </label>

          <label class="tn-label tn-inline">
            Seating
            <select v-model="seatPolicyKey" class="tn-select">
              <option value="first_free">First free seat (fill S, W, N, E)</option>
              <option value="one_per_south">One student per table (South)</option>
              <option value="pairs_ns">Pairs, North–South together</option>
              <option value="manual">Manual — I'll seat everyone</option>
            </select>
          </label>

          <label class="tn-label tn-inline">
            Rounds
            <select v-model="kind" class="tn-select">
              <option value="teacher_set">I open boards (class set)</option>
              <option value="adhoc">All boards open (casual)</option>
            </select>
          </label>
        </div>

        <p v-if="kind === 'teacher_set' && !isTeacher" class="tn-error">
          Class sets need a teacher account — pick "casual" or ask for the
          teacher role.
        </p>
        <p v-if="errorMessage" class="tn-error">{{ errorMessage }}</p>

        <button
          class="tn-btn tn-btn-primary tn-create"
          type="submit"
          :disabled="creating || !pbn.trim() || (kind === 'teacher_set' && !isTeacher)"
        >
          {{ creating ? 'Creating…' : 'Create session' }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup>
// TableSessionNewView (#/tables/new) — minimal teacher-facing session
// creation: paste/upload PBN, choose tables + seat policy, create, get the
// shareable evergreen /play/<hostCode> URL. The Mac API pushes the boards
// to the table service and closes any previous open session of this owner.
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '../composables/useUserStore.js'
import { useDealLibrary } from '../composables/useDealLibrary.js'
import DealLibraryPicker from '../components/table/DealLibraryPicker.vue'
import { API_URL } from '../utils/apiUrl.js'

const API_KEY = import.meta.env.VITE_API_KEY || ''

const SEAT_POLICIES = {
  first_free: { mode: 'auto', pattern: 'first_free' },
  one_per_south: { mode: 'auto', pattern: 'one_per_seat', seats: ['S'] },
  pairs_ns: { mode: 'auto', pattern: 'pairs', sides: ['NS'] },
  manual: { mode: 'manual' },
}

const router = useRouter()
const userStore = useUserStore()
const currentUser = userStore.currentUser
const { fetchEntry, createEntry } = useDealLibrary()

const pbn = ref('')
const fileName = ref('')
const tableCount = ref(1)
const seatPolicyKey = ref('first_free')
const kind = ref('teacher_set')
const creating = ref(false)
const errorMessage = ref('')

// Deal-library integration
const showLibrary = ref(false)
const libBusyId = ref('')
const saveName = ref('')
const saving = ref(false)
const saveMsg = ref('')

const created = ref(null) // { sessionId }
const shareUrl = ref('')
const copied = ref(false)

const isTeacher = computed(() =>
  currentUser.value &&
  (currentUser.value.role === 'teacher' || currentUser.value.role === 'admin'))

function onFile(e) {
  const file = e.target.files?.[0]
  if (!file) return
  fileName.value = file.name
  const reader = new FileReader()
  reader.onload = () => { pbn.value = String(reader.result || '') }
  reader.readAsText(file)
}

// Pull a saved library file's materialized PBN into the boards box.
async function loadFromLibrary(entry) {
  libBusyId.value = entry.id
  const detail = await fetchEntry(entry.id)
  libBusyId.value = ''
  if (detail && detail.payload) {
    pbn.value = detail.payload
    fileName.value = entry.name
    showLibrary.value = false
  }
}

// Save the current boards as a reusable library file (kind=file).
async function saveToLibrary() {
  if (!saveName.value.trim() || !pbn.value.trim()) return
  saving.value = true
  saveMsg.value = ''
  const res = await createEntry({
    owner: currentUser.value.id,
    kind: 'file',
    name: saveName.value.trim(),
    payload: pbn.value,
  })
  saving.value = false
  if (res.success) {
    saveMsg.value = 'Saved ✓'
    saveName.value = ''
    setTimeout(() => { saveMsg.value = '' }, 2500)
  } else {
    saveMsg.value = res.error || 'Could not save.'
  }
}

async function apiPost(path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body ?? {}),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Request failed (${res.status})`)
  }
  return res.json()
}

async function create() {
  errorMessage.value = ''
  creating.value = true
  try {
    const data = await apiPost('/table-sessions', {
      owner_user_id: currentUser.value.id,
      kind: kind.value,
      boards_pbn: pbn.value,
      table_count: tableCount.value || 1,
      seat_policy: SEAT_POLICIES[seatPolicyKey.value],
    })

    // The evergreen join URL: /play/<hostCode> for teachers,
    // /table/<inviteCode> otherwise. Generate the code if this owner
    // doesn't have one yet (idempotent server-side).
    let path
    if (isTeacher.value) {
      const code = data.owner_host_code ||
        (await apiPost(`/users/${currentUser.value.id}/host-code`)).code
      path = `#/play/${code}`
    } else {
      const code = data.owner_invite_code ||
        (await apiPost(`/users/${currentUser.value.id}/invite-code`)).code
      path = `#/table/${code}`
    }
    shareUrl.value =
      `${window.location.origin}${window.location.pathname}${path}`
    created.value = { sessionId: data.session.id }
  } catch (err) {
    errorMessage.value = err.message || 'Could not create the session.'
  } finally {
    creating.value = false
  }
}

async function copyShareUrl() {
  try {
    await navigator.clipboard.writeText(shareUrl.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    // Clipboard unavailable — the input is selectable.
  }
}

function openConsole() {
  router.push(`/tables/console/${created.value.sessionId}`)
}

function resetForm() {
  created.value = null
  shareUrl.value = ''
  pbn.value = ''
  fileName.value = ''
}

onMounted(() => {
  userStore.initialize()
})
</script>

<style scoped>
.tn-page { font-family: 'Segoe UI', system-ui, sans-serif; }
.tn-card {
  max-width: 640px;
  margin: 48px auto;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 10px;
  padding: 28px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}
.tn-card h2 { margin: 0 0 14px; }

.tn-label { display: block; font-size: 14px; font-weight: 600; color: #333; margin-bottom: 10px; }
.tn-inline { display: flex; flex-direction: column; gap: 4px; }
.tn-pbn {
  width: 100%;
  box-sizing: border-box;
  margin-top: 4px;
  padding: 10px;
  border: 1px solid #ccc;
  border-radius: 6px;
  font-family: ui-monospace, Menlo, monospace;
  font-size: 13px;
  font-weight: 400;
}
.tn-row { display: flex; gap: 18px; flex-wrap: wrap; align-items: flex-end; margin: 10px 0; }
.tn-upload-row { align-items: center; margin-top: 0; }
.tn-file { font-size: 13px; }
.tn-num { width: 70px; padding: 8px; border: 1px solid #ccc; border-radius: 6px; font-size: 14px; }
.tn-select { padding: 8px; border: 1px solid #ccc; border-radius: 6px; font-size: 14px; }

.tn-btn {
  padding: 8px 16px;
  border: 1px solid #ccc;
  border-radius: 6px;
  background: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.tn-btn:hover:not(:disabled) { border-color: #007bff; }
.tn-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.tn-btn-primary { background: #1d9e75; border-color: #1d9e75; color: #fff; }
.tn-btn-primary:hover:not(:disabled) { background: #178a65; border-color: #178a65; }
.tn-create { margin-top: 8px; }

.tn-muted { color: #777; font-size: 13px; }
.tn-error { color: #c62828; font-size: 14px; }
.tn-success { color: #1b5e20; font-weight: 600; }
.tn-share { display: flex; gap: 8px; margin: 10px 0; }
.tn-share-url {
  flex: 1;
  padding: 9px 10px;
  border: 1px solid #ccc;
  border-radius: 6px;
  font-size: 13px;
  color: #333;
  background: #fafafa;
}
.tn-actions { display: flex; gap: 10px; margin-top: 14px; }

.tn-btn-sm { padding: 6px 12px; font-size: 13px; }
.tn-lib { margin-bottom: 12px; }
.tn-lib-panel {
  margin-top: 8px;
  padding: 10px 12px;
  border: 1px solid #e2e6ea;
  border-radius: 8px;
  background: #fafbfc;
}
.tn-save-lib { align-items: center; margin-top: 8px; }
.tn-save-name {
  flex: 1;
  min-width: 160px;
  padding: 7px 9px;
  border: 1px solid #ccc;
  border-radius: 6px;
  font-size: 13px;
}
</style>

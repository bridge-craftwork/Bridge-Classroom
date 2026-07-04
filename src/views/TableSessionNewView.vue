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

      <!-- The form: session settings + Create up top, the (tall) deal-source
           picker below so the primary controls aren't buried under it. -->
      <form v-else @submit.prevent="create">
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

        <!-- Staged summary sits with Create (its enable condition). -->
        <div v-if="boardCount" class="tn-staged">
          <span class="tn-staged-ok">
            ✓ {{ boardCount }} board{{ boardCount === 1 ? '' : 's' }} staged<template v-if="stagedLabel"> — {{ stagedLabel }}</template>
          </span>
          <button type="button" class="tn-btn tn-btn-sm" @click="clearStaged">Clear</button>
        </div>

        <!-- Save the staged boards as a reusable library file (materialized
             copy) so they're one click away next time. -->
        <div v-if="isTeacher && boardCount" class="tn-row tn-save-lib">
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

        <p v-if="kind === 'teacher_set' && !isTeacher" class="tn-error">
          Class sets need a teacher account — pick "casual" or ask for the
          teacher role.
        </p>
        <p v-if="!boardCount" class="tn-muted tn-hint">
          Pick a deal source below to stage the session's boards.
        </p>
        <p v-if="errorMessage" class="tn-error">{{ errorMessage }}</p>

        <button
          class="tn-btn tn-btn-primary tn-create"
          type="submit"
          :disabled="creating || !boardCount || (kind === 'teacher_set' && !isTeacher)"
        >
          {{ creating ? 'Creating…' : 'Create session' }}
        </button>

        <!-- Deal source: build the session's board set with the unified picker
             (scenarios, curated, club events, library, paste/upload, random).
             "Add to session" materializes the pool into boards_pbn. Height is
             bounded so the picker scrolls internally instead of pushing the
             page down pages-tall. -->
        <div class="tn-source">
          <div class="tn-source-label">Deal source</div>
          <p v-if="sourceError" class="tn-error">{{ sourceError }}</p>
          <DealSourcePicker
            class="tn-picker"
            layout="full"
            mode="materialize"
            :allow="allow"
            :owner="currentUser.id"
            :show-close="false"
            action-label="Add to session"
            @submit="onPickSource"
          />
        </div>
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
import { useDealSourceResolver } from '../composables/useDealSourceResolver.js'
import DealSourcePicker from '../components/dealSource/DealSourcePicker.vue'
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
const { createEntry } = useDealLibrary()
const { materialize } = useDealSourceResolver()

const tableCount = ref(1)
const seatPolicyKey = ref('first_free')
const kind = ref('teacher_set')
const creating = ref(false)
const errorMessage = ref('')

// Staged board set — accumulated multi-board PBN materialized from the picker.
const boardsPbn = ref('')
const boardCount = ref(0)
const stagedSources = ref([])
const sourceError = ref('')

// Deal-library integration (save the staged set back as a reusable file)
const saveName = ref('')
const saving = ref(false)
const saveMsg = ref('')

const created = ref(null) // { sessionId }
const shareUrl = ref('')
const copied = ref(false)

const isTeacher = computed(() =>
  currentUser.value &&
  (currentUser.value.role === 'teacher' || currentUser.value.role === 'admin'))

// Session creation gets every source (spec §6): library is teacher-gated,
// club games need a signed-in owner; the rest are always available.
const allow = computed(() => ({
  tabs: [
    'favorites', 'scenarios', 'curated', 'clubgames',
    ...(isTeacher.value ? ['library'] : []),
    'pbn', 'random', 'history',
  ],
  options: ['fresh'],
}))

const stagedLabel = computed(() => {
  const s = stagedSources.value
  if (!s.length) return ''
  const shown = s.slice(0, 3).join(', ')
  return s.length > 3 ? `${shown}, +${s.length - 3} more` : shown
})

// Renumber [Board "N"] tags sequentially across the whole staged set so an
// appended pool stays a well-formed multi-board file.
function renumber(pbnText) {
  let n = 0
  return pbnText.replace(/\[Board "[^"]*"\]/g, () => `[Board "${++n}"]`)
}

// "Add to session": materialize the picker's selection into boards and append
// them to the staged set (single-click adds one source's boards; Multi adds a
// whole pool).
async function onPickSource(selection) {
  sourceError.value = ''
  try {
    const { boardsPbn: chunk, count } = await materialize(selection)
    boardsPbn.value = renumber(
      boardsPbn.value ? `${boardsPbn.value.trimEnd()}\n${chunk}` : chunk,
    )
    boardCount.value += count
    const labels = (selection.items || []).map((i) => i.label || i.kind)
    stagedSources.value = [...stagedSources.value, ...labels]
  } catch (err) {
    sourceError.value = err.message || 'Could not load those boards.'
  }
}

function clearStaged() {
  boardsPbn.value = ''
  boardCount.value = 0
  stagedSources.value = []
}

// Save the staged boards as a reusable library file (kind=file).
async function saveToLibrary() {
  if (!saveName.value.trim() || !boardsPbn.value.trim()) return
  saving.value = true
  saveMsg.value = ''
  const res = await createEntry({
    owner: currentUser.value.id,
    kind: 'file',
    name: saveName.value.trim(),
    payload: boardsPbn.value,
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
      boards_pbn: boardsPbn.value,
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
  clearStaged()
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
.tn-row { display: flex; gap: 18px; flex-wrap: wrap; align-items: flex-end; margin: 10px 0; }
.tn-num { width: 70px; padding: 8px; border: 1px solid #ccc; border-radius: 6px; font-size: 14px; }

.tn-source { margin-top: 20px; padding-top: 16px; border-top: 1px solid #eee; }
.tn-source-label {
  font-size: 14px;
  font-weight: 600;
  color: #333;
  margin-bottom: 8px;
}
/* Bound the full-layout picker so it scrolls internally, not pages-tall. */
.tn-source :deep(.tn-picker) {
  max-height: 60vh;
}
.tn-hint { margin: 6px 0; }
.tn-staged {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 10px;
  padding: 8px 12px;
  border: 1px solid #cfe8d9;
  border-radius: 8px;
  background: #f1faf5;
}
.tn-staged-ok { color: #1b5e20; font-weight: 600; font-size: 14px; }
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

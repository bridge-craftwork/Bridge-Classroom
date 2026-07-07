<template>
  <div class="th-page">
    <nav class="th-nav">
      <a class="th-logo" href="#/"><span class="suit">&spades;</span> Bridge Classroom &middot; Host a Table</a>
      <span v-if="hasSession" class="th-conn" :class="'th-conn-' + connectionStatus">{{ connectionStatus }}</span>
      <a class="th-back" href="#/">&larr; All tools</a>
    </nav>

    <!-- Not signed in -->
    <div v-if="!currentUser" class="th-card th-center">
      <p>You need to be signed in to host a table.
        Open the <a href="#/">main app</a> and sign in first.</p>
    </div>

    <!-- Resolving / creating the session -->
    <div v-else-if="resolving" class="th-card th-center">
      <p>Setting up your table&hellip;</p>
    </div>

    <div v-else-if="startError" class="th-card th-center">
      <p class="th-error">{{ startError }}</p>
      <button class="th-btn th-btn-primary" @click="ensureSession">Try again</button>
    </div>

    <!-- The host surface: a slim host strip over the seated player table. -->
    <main v-else class="th-main">
      <!-- Host strip: deal source + invite + test players + end. The host is a
           seated player (as_player), so the table itself is the TableView below. -->
      <div class="th-controls">
        <button class="th-btn th-btn-primary" :disabled="!connected" @click="showPicker = true">
          Deal source&hellip;
        </button>

        <div class="th-invite">
          <button class="th-btn" :disabled="!shareUrl" :title="shareUrl || 'Generating your link…'" @click="copyShareUrl">
            {{ copied ? 'Copied!' : 'Copy invite link' }}
          </button>
          <input v-if="shareUrl" class="th-invite-url" :value="shareUrl" readonly @focus="$event.target.select()">
        </div>

        <label class="th-spawn" title="Open N tabs that each join as a test player (allow pop-ups)">
          <input v-model.number="spawnCount" type="number" min="1" max="3" class="th-num" :disabled="!shareUrl">
          <button class="th-btn" :disabled="!shareUrl" @click="spawnPlayers">🧪 Test players</button>
        </label>

        <button class="th-btn th-btn-danger" :disabled="!hasSession" @click="endSession">End table</button>
      </div>

      <p v-if="loadError" class="th-error th-inline">{{ loadError }}</p>

      <!-- The seated player table (the host plays their own hand). Empty seats
           are bots; invitees drop into open seats. -->
      <UnifiedTable server @exit="onExitTable" />
    </main>

    <!-- Deal-source picker modal (materialize the whole set onto the table) -->
    <div v-if="showPicker" class="th-modal-backdrop" @click.self="showPicker = false">
      <DealSourcePicker
        layout="compact"
        mode="materialize"
        :allow="pickerAllow"
        :owner="currentUser?.id || null"
        action-label="Load onto table"
        @submit="onLoadSource"
        @close="showPicker = false"
      />
    </div>
  </div>
</template>

<script setup>
// TableHostView (#/tables/host) — the single-table, non-teacher "host a table"
// surface. It reuses the server table-service exactly like the teacher console
// (the session owner is the see-all controller — see bridge-table-service
// ws.rs: `is_teacher = sub == owner_sub || role == "teacher"`), but scoped to
// ONE casual (adhoc) table with none of the multi-table console chrome.
//
// Slice 1 (this file): create/resume an adhoc 1-table session, connect as owner,
// show the table, pick a deal source, and hand out the invite link. Seat
// drag-and-drop + the host taking a seat to play come in a later slice.
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '../composables/useUserStore.js'
import { useRemoteTable } from '../composables/useRemoteTable.js'
import { useTeacherConsole } from '../composables/useTeacherConsole.js'
import { useDealSourceResolver } from '../composables/useDealSourceResolver.js'
import { useTableHandoff } from '../composables/useTableHandoff.js'
import DealSourcePicker from '../components/dealSource/DealSourcePicker.vue'
import UnifiedTable from './BiddingPracticeView.vue'
import { API_URL } from '../utils/apiUrl.js'
import { testStudentName } from '../utils/testStudents.js'

const API_KEY = import.meta.env.VITE_API_KEY || ''

const router = useRouter()
const userStore = useUserStore()
const currentUser = userStore.currentUser
const table = useRemoteTable()
// The console composable is used ONLY to send the host-control frames
// (load_boards) — they ride the same useTableSocket singleton the seated player
// connection uses, and the server accepts them from the owner sub. The host is
// a seated PLAYER (as_player), so there's no lobby/deck feed here (that's the
// teacher console's see-all path).
const console_ = useTeacherConsole()
const { materialize } = useDealSourceResolver()
const handoff = useTableHandoff()

const { connectionStatus, sessionClosed } = table

const connected = computed(() => connectionStatus.value === 'connected')
const sessionId = ref(null)
const hasSession = computed(() => !!sessionId.value && !sessionClosed.value)
const resolving = ref(true)
const startError = ref('')
const ending = ref(false) // host clicked "End table" (vs an unexpected close)
let recoveredOnce = false

const pickerAllow = {
  tabs: ['favorites', 'scenarios', 'curated', 'clubgames', 'library', 'pbn', 'random', 'history'],
  options: ['fresh'],
}
const showPicker = ref(false)
const loadError = ref('')

// ── Invite link (evergreen host code → /play/:code join URL) ────────────────
const shareUrl = ref('')
const copied = ref(false)
async function fetchHostCode() {
  if (!currentUser.value) return null
  try {
    const res = await fetch(`${API_URL}/users/${currentUser.value.id}/host-code`, {
      method: 'POST',
      headers: { 'x-api-key': API_KEY },
    })
    const data = await res.json()
    if (data.code) {
      shareUrl.value = `${window.location.origin}${window.location.pathname}#/play/${data.code}`
      return data.code
    }
  } catch {
    /* best-effort; Copy link stays disabled */
  }
  return null
}
async function copyShareUrl() {
  if (!shareUrl.value) return
  try {
    await navigator.clipboard.writeText(shareUrl.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    /* clipboard unavailable */
  }
}

// ── Testing: spawn a few player tabs ────────────────────────────────────────
// Each opens the invite link with ?student=<name>, which forces a named-guest
// (player) join — bypassing the owner/teacher recognition that would otherwise
// send you to the console. Bots fill any seats you don't spawn.
const spawnCount = ref(3)
function spawnPlayers() {
  if (!shareUrl.value) return
  const n = Math.max(1, Math.min(Number(spawnCount.value) || 1, 3))
  for (let i = 1; i <= n; i++) {
    const name = encodeURIComponent(testStudentName(i))
    window.open(`${shareUrl.value}?student=${name}&bot=rules`, `bc-test-player-${i}`)
  }
}

// ── Deal source → materialize the whole set onto the table ──────────────────
async function onLoadSource(selection) {
  loadError.value = ''
  try {
    const { boardsPbn, label } = await materialize(selection)
    console_.loadBoards(boardsPbn, label)
    showPicker.value = false
  } catch (e) {
    loadError.value = e?.message || 'Could not load that source.'
  }
}

// ── Session lifecycle ───────────────────────────────────────────────────────
// Resume the owner's open session if there is one, else create a casual
// single-table session. The Mac API enforces one open session per owner.
// `forceCreate` skips the resume (used by the recovery watcher when a resumed
// session turns out to be gone — e.g. the table-service restarted and dropped
// its in-memory sessions while the DB still lists it open).
async function ensureSession({ forceCreate = false } = {}) {
  if (!currentUser.value) { resolving.value = false; return }
  resolving.value = true
  startError.value = ''
  try {
    const code = await fetchHostCode() // also populates the invite link
    let id = null
    if (!forceCreate && code) {
      try {
        const res = await fetch(`${API_URL}/play/${code}`)
        const data = await res.json()
        if (data?.session?.id) id = data.session.id
      } catch { /* no open session → create one */ }
    }
    if (!id) id = await createSession()
    if (!id) throw new Error('Could not start your table.')
    sessionId.value = id
    // Join SEATED (as_player) so the host plays their own hand — while still
    // holding the host-control frames (deal source / seating) from the seat.
    table.join({ sessionId: id, userId: currentUser.value.id, asPlayer: true })
  } catch (e) {
    startError.value = e?.message || 'Could not set up your table.'
  } finally {
    resolving.value = false
  }
}

// A resumed session can be dead on the service (restart drops in-memory
// sessions; the DB still shows it open) → the join returns unknown_session and
// useRemoteTable flips sessionClosed. A host always wants a table, so instead of
// the dead "Session ended" screen, silently start a fresh one (once). An
// explicit End (ending=true) is left alone.
watch(sessionClosed, (closed) => {
  if (!closed || ending.value || recoveredOnce) return
  recoveredOnce = true
  resolving.value = true
  teardown()
  ensureSession({ forceCreate: true })
})

// "Invite friends" hand-off from the solo Practice Table: once this session is
// connected, materialize the deal source the solo table was using onto it (once).
// A direct visit to /tables/host hands off nothing, so this is a no-op there.
let handoffApplied = false
watch(connected, (isConnected) => {
  if (!isConnected || handoffApplied) return
  const pending = handoff.takePending()
  if (!pending) return
  handoffApplied = true
  onLoadSource(pending)
}, { immediate: true })

async function createSession() {
  const res = await fetch(`${API_URL}/table-sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify({
      owner_user_id: currentUser.value.id,
      kind: 'adhoc',
      boards_pbn: '',
      table_count: 1,
      seat_policy: { mode: 'auto', pattern: 'first_free' },
    }),
  })
  if (!res.ok) throw new Error((await res.text()) || `Failed (${res.status})`)
  const data = await res.json()
  return data?.session?.id || null
}

async function endSession() {
  if (!window.confirm('End this table for everyone?')) return
  ending.value = true
  try {
    await fetch(
      `${API_URL}/table-sessions/${sessionId.value}?owner_user_id=${encodeURIComponent(currentUser.value.id)}`,
      { method: 'DELETE', headers: { 'x-api-key': API_KEY } }
    )
  } catch { /* best-effort; the closed event tears down the UI */ }
  teardown()
  router.push('/')
}

function teardown() {
  console_.detach()
  table.leave()
  sessionId.value = null
}

// TableView's "back to lobby" (shown when the session ends) → home.
function onExitTable() {
  teardown()
  router.push('/')
}

onMounted(() => {
  userStore.initialize()
  ensureSession()
})
onBeforeUnmount(teardown)
</script>

<style scoped>
.th-page {
  min-height: 100vh;
  background: #f7f7f5;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #222;
}
.th-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 24px;
  border-bottom: 0.5px solid #ddd;
  background: #fff;
}
.th-logo { font-size: 15px; font-weight: 500; color: #222; text-decoration: none; }
.th-logo .suit { color: #1D9E75; margin-right: 6px; }
.th-back { font-size: 12px; color: #666; text-decoration: none; }
.th-back:hover { color: #222; }
.th-conn { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #888; }
.th-conn-connected { color: #1D9E75; }
.th-conn-error, .th-conn-unavailable { color: #c62828; }

.th-card {
  max-width: 560px;
  margin: 48px auto;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 10px;
  padding: 24px;
}
.th-center { text-align: center; }

.th-main { max-width: 900px; margin: 0 auto; padding: 20px 24px; }

.th-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  background: #fff;
  border: 0.5px solid #ddd;
  border-radius: 10px;
  padding: 12px 14px;
}
.th-spawn { display: flex; align-items: center; gap: 6px; }
.th-num {
  width: 48px;
  padding: 5px 6px;
  border: 1px solid #ccc;
  border-radius: 6px;
  font-size: 13px;
}
.th-invite { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.th-invite-url {
  width: 260px;
  max-width: 40vw;
  font-size: 12px;
  padding: 5px 8px;
  border: 1px solid #ccc;
  border-radius: 6px;
  background: #fafbfc;
  color: #444;
}

.th-btn {
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid #ccc;
  background: #fff;
  font-size: 13px;
  cursor: pointer;
}
.th-btn:hover:not(:disabled) { border-color: #888; }
.th-btn:disabled { opacity: 0.45; cursor: default; }
.th-btn-primary { background: #1D9E75; color: #fff; border-color: #1D9E75; }
.th-btn-primary:hover:not(:disabled) { background: #167a5a; border-color: #167a5a; }
.th-btn-danger { color: #c62828; border-color: #e2b6b6; margin-left: 4px; }
.th-btn-danger:hover:not(:disabled) { border-color: #c62828; }

.th-error { color: #c62828; font-size: 14px; }
.th-inline { margin: 10px 0 0; }

.th-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 4vh 16px;
  box-sizing: border-box;
  z-index: 60;
}
</style>

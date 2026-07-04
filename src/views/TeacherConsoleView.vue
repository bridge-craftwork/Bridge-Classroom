<template>
  <div class="tc-page">
    <!-- Gate: needs a signed-in (teacher) user -->
    <div v-if="!currentUser" class="tc-card tc-gate">
      <h2>Teacher console</h2>
      <p>You need to be signed in as a teacher. Open the
        <a href="#/">main app</a> and sign in first.</p>
    </div>

    <!-- Session over -->
    <div v-else-if="sessionClosed" class="tc-card tc-gate">
      <h2>Session ended</h2>
      <p>This table session is closed.</p>
      <button class="tc-btn tc-btn-primary" @click="router.push('/tables/new')">
        Start a new session
      </button>
    </div>

    <template v-else>
      <!-- Header -->
      <div class="tc-header">
        <div class="tc-header-left">
          <h2 class="tc-title">Teacher console</h2>
          <span class="tc-conn" :class="'tc-conn-' + connectionStatus">{{ connectionStatus }}</span>
        </div>
        <div class="tc-header-right">
          <button
            class="tc-btn"
            :disabled="!shareUrl"
            :title="shareUrl || 'Generating your class link…'"
            @click="copyShareUrl"
          >
            {{ copied ? 'Link copied ✓' : '🔗 Copy class link' }}
          </button>
          <button class="tc-btn tc-btn-danger" @click="endSession">End session</button>
        </div>
      </div>

      <p v-if="!lobby" class="tc-muted">Connecting to the session…</p>

      <!-- Deal source + lockstep board navigation (Shark control panel) -->
      <div v-if="lobby" class="tc-deal-bar">
        <div class="tc-deal-status">
          <template v-if="deck.loaded">
            <strong class="tc-deal-label">{{ deck.label || 'Deal set' }}</strong>
            <span class="tc-muted">board {{ deck.board }} of {{ deck.total }}</span>
          </template>
          <span v-else class="tc-muted">No deal loaded — pick a source to deal onto every table →</span>
        </div>
        <div class="tc-deal-actions">
          <button
            class="tc-btn tc-btn-small"
            :disabled="!deck.loaded || deck.board <= 1 || !connected"
            title="Back every table up one board"
            @click="console_.prevBoard()"
          >‹ Prev</button>
          <button
            class="tc-btn tc-btn-small"
            :disabled="!deck.loaded || deck.board >= deck.total || !connected"
            title="Advance every table one board"
            @click="console_.nextBoard()"
          >Next ›</button>
          <span class="tc-goto">
            Go to
            <input
              v-model.number="gotoInput"
              type="number"
              min="1"
              :max="deck.total || 1"
              class="tc-goto-input"
              :disabled="!deck.loaded || !connected"
            />
            <button class="tc-btn tc-btn-small" :disabled="!deck.loaded || !connected" @click="doGoto">Go</button>
          </span>
          <button class="tc-btn tc-btn-primary" :disabled="!connected" @click="showPicker = true">
            {{ deck.loaded ? 'Change deal source…' : 'Load deal source…' }}
          </button>
        </div>
      </div>

      <!-- Deal-source picker modal → materialize → load onto all tables -->
      <div v-if="showPicker" class="tc-modal-backdrop" @click.self="showPicker = false">
        <div class="tc-modal-shell">
          <DealSourcePicker
            class="tc-picker"
            layout="compact"
            mode="materialize"
            :allow="pickerAllow"
            :owner="currentUser.id"
            action-label="Load onto tables"
            @submit="onLoadSource"
            @close="showPicker = false"
          />
          <p v-if="loadError" class="tc-load-error">{{ loadError }}</p>
        </div>
      </div>

      <!-- Live multi-table monitor -->
      <div v-if="lobby" class="tc-grid">
        <div
          v-for="t in lobby.tables"
          :key="t.table_id"
          class="tc-panel"
          :class="{ 'tc-table-watched': t.table_id === kibitzTableId }"
        >
          <MiniTable
            :t="t"
            :name="tableName(t.table_id)"
            :loaded="deck.loaded"
            @kibitz="watchTable(t.table_id)"
            @advance="console_.forceAdvance(t.table_id)"
            @seat-click="(seat) => toggleMenu(t.table_id, seat)"
          />

          <!-- Seat action menu -->
          <div v-if="menu && menu.tableId === t.table_id" class="tc-menu">
            <template v-if="isHuman(t, menu.seat)">
              <div class="tc-menu-title">
                {{ menu.seat }} — {{ t.seats[menu.seat].name }}
              </div>
              <button class="tc-btn tc-btn-small" @click="doBoot(t.table_id, menu.seat)">
                Boot to kibitzer
              </button>
              <p class="tc-menu-hint">
                Booted players keep watching; assign them a new seat from the
                kibitzer list. (Moving a seated player = boot, then assign.)
              </p>
            </template>
            <template v-else>
              <div class="tc-menu-title">Seat {{ menu.seat }} (bot)</div>
              <template v-if="lobby.kibitzers.length">
                <button
                  v-for="k in lobby.kibitzers"
                  :key="k.sub"
                  class="tc-btn tc-btn-small"
                  @click="doAssign(t.table_id, menu.seat, k.sub)"
                >
                  Seat {{ k.name }}
                </button>
              </template>
              <p v-else class="tc-menu-hint">
                No unseated players to assign — the seat stays a bot.
              </p>
            </template>
          </div>

        </div>

        <!-- Kibitzers roster -->
        <div class="tc-table tc-kibitzers">
          <div class="tc-table-head">
            <span class="tc-table-name">Kibitzers</span>
            <span class="tc-tag">{{ lobby.kibitzers.length }}</span>
          </div>
          <ul v-if="lobby.kibitzers.length" class="tc-kib-list">
            <li v-for="k in lobby.kibitzers" :key="k.sub">
              {{ k.name }} <span class="tc-muted">watching {{ tableName(k.table_id) }}</span>
            </li>
          </ul>
          <p v-else class="tc-muted">Nobody is waiting for a seat.</p>
        </div>
      </div>

      <!-- Kibitz panel: full read-only table view over the same socket -->
      <div v-if="kibitzTableId" class="tc-kibitz-panel">
        <div class="tc-kibitz-bar">
          <span class="tc-table-name">Watching {{ tableName(kibitzTableId) }}</span>
          <button class="tc-btn tc-btn-small" @click="stopWatching">Stop watching</button>
        </div>
        <TableView @exit="stopWatching" />
      </div>
    </template>
  </div>
</template>

<script setup>
// TeacherConsoleView (#/tables/console/:sessionId) — the Shark-style class
// console. One teacher WS connection does everything: the server recognizes
// the owner/teacher ticket, streams `lobby` frames (whole-session state,
// folded by useTeacherConsole) and accepts open_boards / assign_seat / boot
// / force_advance / kibitz. Kibitzing streams one table's snapshot+events
// through useRemoteTable, rendered by the same TableView players use
// (teacher has no seat, so it's naturally read-only — undo still works).
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import TableView from './TableView.vue'
import MiniTable from '../components/table/MiniTable.vue'
import DealSourcePicker from '../components/dealSource/DealSourcePicker.vue'
import { useRemoteTable } from '../composables/useRemoteTable.js'
import { useTeacherConsole } from '../composables/useTeacherConsole.js'
import { useDealSourceResolver } from '../composables/useDealSourceResolver.js'
import { useUserStore } from '../composables/useUserStore.js'
import { API_URL } from '../utils/apiUrl.js'

const API_KEY = import.meta.env.VITE_API_KEY || ''
const SEAT_ORDER = ['N', 'E', 'S', 'W']

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const table = useRemoteTable()
const console_ = useTeacherConsole()
const { materialize } = useDealSourceResolver()

const { connectionStatus, sessionClosed } = table
const { lobby, deck, kibitzTableId } = console_
const currentUser = userStore.currentUser

const connected = computed(() => connectionStatus.value === 'connected')

const sessionId = computed(() => route.params.sessionId)
const menu = ref(null) // { tableId, seat } — the open seat-action menu

// ── Runtime deal source + lockstep board nav (roadmap §Phase 3.1) ──────────
const showPicker = ref(false)
const loadError = ref('')
const gotoInput = ref(1)
const pickerAllow = computed(() => ({
  tabs: ['favorites', 'scenarios', 'curated', 'clubgames', 'library', 'pbn', 'random', 'history'],
  options: ['fresh'],
}))

// Picker → materialize the whole selection → replace the session's loaded set
// on every table (lockstep). label is auto-generated by the resolver.
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

function doGoto() {
  const n = Number(gotoInput.value)
  if (!deck.value.loaded || !n) return
  console_.gotoBoard(Math.max(1, Math.min(n, deck.value.total)))
}

function tableName(tableId) {
  const m = String(tableId || '').match(/-t(\d+)$/)
  return m ? `Table ${m[1]}` : String(tableId)
}

function isHuman(t, seat) {
  return t.seats?.[seat]?.kind === 'human'
}

function seatName(t, seat) {
  const occ = t.seats?.[seat]
  return occ && occ.kind === 'human' ? occ.name : 'Bot'
}

function isMenuOpen(tableId, seat) {
  return !!menu.value && menu.value.tableId === tableId && menu.value.seat === seat
}

function toggleMenu(tableId, seat) {
  menu.value = isMenuOpen(tableId, seat) ? null : { tableId, seat }
}

function doBoot(tableId, seat) {
  console_.boot(tableId, seat)
  menu.value = null
}

function doAssign(tableId, seat, sub) {
  console_.assignSeat(tableId, seat, sub)
  menu.value = null
}

function watchTable(tableId) {
  console_.kibitz(tableId)
}

function stopWatching() {
  console_.stopKibitz()
}

// Evergreen class link (/play/<hostCode>): the teacher's permanent join URL,
// always resolving to their open session — copyable straight from the console.
const shareUrl = ref('')
const copied = ref(false)
async function ensureShareUrl() {
  if (!currentUser.value) return
  try {
    const res = await fetch(`${API_URL}/users/${currentUser.value.id}/host-code`, {
      method: 'POST',
      headers: { 'x-api-key': API_KEY },
    })
    const data = await res.json()
    if (data.code) {
      shareUrl.value = `${window.location.origin}${window.location.pathname}#/play/${data.code}`
    }
  } catch {
    /* best-effort; the button just stays disabled */
  }
}
async function copyShareUrl() {
  if (!shareUrl.value) return
  try {
    await navigator.clipboard.writeText(shareUrl.value)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    /* clipboard unavailable */
  }
}

async function endSession() {
  if (!window.confirm('End this session for everyone?')) return
  try {
    await fetch(
      `${API_URL}/table-sessions/${sessionId.value}?owner_user_id=${encodeURIComponent(currentUser.value.id)}`,
      { method: 'DELETE', headers: { 'x-api-key': API_KEY } }
    )
    // The service broadcasts session_closed; the WS layer flips
    // sessionClosed and this view shows its end card.
  } catch {
    // Best-effort; the lobby frame / closed event tells the real story.
  }
}

function joinSession() {
  if (!currentUser.value || !sessionId.value) return
  console_.attach()
  // ?bot=random|rules|slow on the console URL flips every table in the
  // session to that bot backend (testing: 'slow' = human-paced N/S).
  const bot = typeof route.query.bot === 'string' && route.query.bot ? route.query.bot : null
  table.join({ sessionId: sessionId.value, userId: currentUser.value.id, bot })
}

// Route changes reuse this component (old console → new console): rebuild
// the connection for the new session id.
watch(sessionId, (id, old) => {
  if (id === old) return
  menu.value = null
  console_.detach() // clears the stale lobby frame + kibitz selection
  table.leave() // also resets sessionClosed from a previous session
  joinSession()
})

onMounted(() => {
  userStore.initialize()
  joinSession()
  ensureShareUrl()
})

onBeforeUnmount(() => {
  table.leave()
  console_.detach()
})
</script>

<style scoped>
.tc-page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 16px;
  font-family: 'Segoe UI', system-ui, sans-serif;
}

.tc-card {
  max-width: 460px;
  margin: 80px auto;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 10px;
  padding: 28px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}
.tc-gate { text-align: center; }

.tc-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.tc-header-left, .tc-header-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.tc-title { margin: 0; font-size: 22px; }

.tc-tag {
  background: #f0f0f0;
  border-radius: 12px;
  padding: 3px 10px;
  font-size: 13px;
  color: #444;
}
.tc-conn { font-size: 13px; color: #666; }
.tc-conn-connected { color: #1d9e75; }
.tc-conn-reconnecting, .tc-conn-connecting, .tc-conn-minting { color: #e6a700; }
.tc-conn-error, .tc-conn-unavailable { color: #c62828; }

.tc-btn {
  padding: 8px 14px;
  border: 1px solid #ccc;
  border-radius: 6px;
  background: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.tc-btn:hover:not(:disabled) { border-color: #007bff; }
.tc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.tc-btn-primary { background: #1d9e75; border-color: #1d9e75; color: #fff; }
.tc-btn-primary:hover:not(:disabled) { background: #178a65; border-color: #178a65; }
.tc-btn-danger { color: #c62828; border-color: #e8b4b4; }
.tc-btn-danger:hover { border-color: #c62828; }
.tc-btn-small { padding: 5px 10px; font-size: 13px; }

.tc-muted { color: #888; font-size: 13px; }

/* Deal source + lockstep nav bar */
.tc-deal-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
  padding: 10px 14px;
  border: 1px solid #dbe6e0;
  border-radius: 10px;
  background: #f5faf7;
}
.tc-deal-status { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; min-width: 0; }
.tc-deal-label { font-size: 15px; color: #1b5e20; }
.tc-deal-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tc-goto { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: #555; }
.tc-goto-input {
  width: 56px;
  padding: 5px 6px;
  border: 1px solid #ccc;
  border-radius: 6px;
  font-size: 13px;
}

.tc-modal-backdrop {
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
.tc-modal-shell { display: flex; flex-direction: column; gap: 8px; }
.tc-load-error {
  color: #c62828;
  font-size: 13px;
  background: #fff;
  border-radius: 8px;
  padding: 6px 10px;
  margin: 0;
}

/* Live monitor grid: density first — fit as many mini-tables as the
   viewport allows (Rick: see everything happening across all tables). */
.tc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
  gap: 10px;
}
.tc-panel { position: relative; min-width: 0; }
.tc-table {
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 10px;
  padding: 14px;
}
.tc-table-watched :deep(.mt) { border-color: #1d4e89; box-shadow: 0 0 0 1px #1d4e89; }
.tc-table-watched { border-color: #1d9e75; box-shadow: 0 0 0 1px #1d9e75; }
.tc-table-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.tc-table-name { font-weight: 700; font-size: 15px; }
.tc-phase {
  font-size: 12px;
  border-radius: 10px;
  padding: 2px 8px;
  text-transform: capitalize;
}
.tc-phase-bidding { background: #fff8e1; color: #8d6e00; }
.tc-phase-play { background: #e3f2fd; color: #1565c0; }
.tc-phase-complete { background: #e8f5e9; color: #1b5e20; }

.tc-table-stats { font-size: 13px; color: #555; margin-bottom: 8px; }
.tc-ready { color: #1d9e75; font-weight: 600; }

.tc-seats { display: flex; gap: 6px; flex-wrap: wrap; }
.tc-seat {
  display: flex;
  align-items: center;
  gap: 5px;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: #f7f7f7;
  padding: 4px 8px;
  font-size: 13px;
  cursor: pointer;
}
.tc-seat:hover { border-color: #007bff; }
.tc-seat-human { background: #eef7f2; }
.tc-seat-open { border-color: #007bff; }
.tc-seat-letter { font-weight: 700; }
.tc-seat-name { color: #444; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tc-dot { width: 7px; height: 7px; border-radius: 50%; background: #1d9e75; }
.tc-dot-off { background: #bbb; }
.tc-check { color: #1d9e75; font-weight: 700; }

.tc-menu {
  margin-top: 8px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background: #fafafa;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
}
.tc-menu-title { font-size: 13px; font-weight: 700; color: #333; }
.tc-menu-hint { font-size: 12px; color: #888; margin: 2px 0 0; }

.tc-table-actions { display: flex; gap: 8px; margin-top: 10px; }

.tc-kibitzers { background: #fcfcf9; }
.tc-kib-list { margin: 4px 0 0; padding-left: 18px; font-size: 14px; color: #444; }
.tc-kib-list li { margin: 3px 0; }

.tc-kibitz-panel {
  margin-top: 18px;
  border: 2px solid #1d9e75;
  border-radius: 12px;
  background: #fdfdfb;
}
.tc-kibitz-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid #e0e0e0;
}
</style>

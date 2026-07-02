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
          <span v-if="lobby" class="tc-tag">
            Boards open <strong>{{ lobby.boards.open }} / {{ lobby.boards.total }}</strong>
          </span>
          <span class="tc-conn" :class="'tc-conn-' + connectionStatus">{{ connectionStatus }}</span>
        </div>
        <div class="tc-header-right">
          <button
            class="tc-btn tc-btn-primary"
            :disabled="!lobby || lobby.boards.open >= lobby.boards.total || connectionStatus !== 'connected'"
            title="Open the next board for every table (tables advance when their players are ready)"
            @click="openNextRound"
          >
            Open next board
            <template v-if="lobby && lobby.boards.open < lobby.boards.total">
              (#{{ lobby.boards.open + 1 }})
            </template>
          </button>
          <button class="tc-btn tc-btn-danger" @click="endSession">End session</button>
        </div>
      </div>

      <p v-if="!lobby" class="tc-muted">Connecting to the session…</p>

      <!-- Table grid -->
      <div v-if="lobby" class="tc-grid">
        <div
          v-for="t in lobby.tables"
          :key="t.table_id"
          class="tc-table"
          :class="{ 'tc-table-watched': t.table_id === kibitzTableId }"
        >
          <div class="tc-table-head">
            <span class="tc-table-name">{{ tableName(t.table_id) }}</span>
            <span class="tc-tag">Board {{ t.board_no }}</span>
            <span class="tc-phase" :class="'tc-phase-' + t.phase">{{ t.phase }}</span>
          </div>

          <div class="tc-table-stats">
            <span>Tricks NS {{ t.tricks.ns }} · EW {{ t.tricks.ew }}</span>
            <span v-if="t.next_to_act && t.phase !== 'complete'">· {{ t.next_to_act }} to act</span>
            <span v-if="t.ready.length" class="tc-ready">· ready: {{ t.ready.join(' ') }}</span>
          </div>

          <!-- Seat chips -->
          <div class="tc-seats">
            <button
              v-for="seat in SEAT_ORDER"
              :key="seat"
              class="tc-seat"
              :class="{
                'tc-seat-human': isHuman(t, seat),
                'tc-seat-open': isMenuOpen(t.table_id, seat),
              }"
              @click="toggleMenu(t.table_id, seat)"
            >
              <span class="tc-seat-letter">{{ seat }}</span>
              <span class="tc-seat-name">{{ seatName(t, seat) }}</span>
              <span
                v-if="isHuman(t, seat)"
                class="tc-dot"
                :class="{ 'tc-dot-off': !t.seats[seat].connected }"
              ></span>
              <span v-if="t.ready.includes(seat)" class="tc-check">✓</span>
            </button>
          </div>

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

          <div class="tc-table-actions">
            <button class="tc-btn tc-btn-small" @click="watchTable(t.table_id)">
              {{ t.table_id === kibitzTableId ? 'Watching ✓' : 'Kibitz' }}
            </button>
            <button
              class="tc-btn tc-btn-small"
              title="Move this table to its next board now, skipping the ready check"
              @click="console_.forceAdvance(t.table_id)"
            >
              Force advance
            </button>
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
import { useRemoteTable } from '../composables/useRemoteTable.js'
import { useTeacherConsole } from '../composables/useTeacherConsole.js'
import { useUserStore } from '../composables/useUserStore.js'
import { API_URL } from '../utils/apiUrl.js'

const API_KEY = import.meta.env.VITE_API_KEY || ''
const SEAT_ORDER = ['N', 'E', 'S', 'W']

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const table = useRemoteTable()
const console_ = useTeacherConsole()

const { connectionStatus, sessionClosed } = table
const { lobby, kibitzTableId } = console_
const currentUser = userStore.currentUser

const sessionId = computed(() => route.params.sessionId)
const menu = ref(null) // { tableId, seat } — the open seat-action menu

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

function openNextRound() {
  if (!lobby.value) return
  console_.openBoards(lobby.value.boards.open + 1)
}

function watchTable(tableId) {
  console_.kibitz(tableId)
}

function stopWatching() {
  console_.stopKibitz()
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
  table.join({ sessionId: sessionId.value, userId: currentUser.value.id })
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

/* Table grid */
.tc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
}
.tc-table {
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 10px;
  padding: 14px;
}
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

<template>
  <div class="tv-page">
    <!-- Session closed overlay: terminal — the parent owns navigation. -->
    <div v-if="sessionClosed" class="tv-closed-card">
      <h2>Session ended</h2>
      <p>The teacher has ended this table session. Thanks for playing!</p>
      <button class="tv-btn tv-btn-primary" @click="$emit('exit')">Back to the lobby</button>
    </div>

    <template v-else>
      <div class="tv-header">
        <div class="tv-header-left">
          <span class="tv-title">{{ tableTitle }}</span>
          <span v-if="boardNumber !== null" class="tv-tag">Board {{ boardNumber }}</span>
          <span v-if="dealer" class="tv-tag">Dealer {{ dealer }}</span>
          <span class="tv-tag" :class="{ 'tv-tag-vul': vulnerable !== 'None' }">
            {{ vulnerable === 'None' ? 'None vul' : vulnerable + ' vul' }}
          </span>
          <span v-if="contract" class="tv-tag tv-tag-contract">
            <span v-html="contractHtml"></span> by {{ declarer }}
          </span>
          <span v-else-if="phase === 'bidding'" class="tv-tag">Bidding</span>
          <span
            v-if="botMode"
            class="tv-tag tv-tag-bots"
            title="Empty seats are played by practice bots"
          >
            {{ botMode === 'random' ? 'practice bots' : 'bots: ' + botMode }}
          </span>
          <button
            v-if="canToggleHands"
            class="tv-tag tv-tag-toggle"
            :title="showAllHands
              ? 'Teacher view: all hands visible. Click to see only what a player would.'
              : 'Player view: hidden hands stay hidden. Click to reveal all hands.'"
            @click="toggleShowAllHands"
          >
            {{ showAllHands ? '👁 all hands' : '👁 my view' }}
          </button>
        </div>
        <div class="tv-header-right">
          <span class="tv-conn" :class="'tv-conn-' + connectionStatus">
            {{ connectionLabel }}
          </span>
          <button
            class="tv-btn"
            :disabled="seq === 0 || connectionStatus !== 'connected'"
            title="Rewind the last action (anyone at the table may undo)"
            @click="onUndo"
          >
            Undo
          </button>
        </div>
      </div>

      <!-- Seats strip -->
      <div class="tv-seats">
        <div
          v-for="seat in SEAT_ORDER"
          :key="seat"
          class="tv-seat"
          :class="{
            'tv-seat-you': seat === yourSeat,
            'tv-seat-turn': seat === nextToAct && phase !== 'complete',
          }"
        >
          <span class="tv-seat-letter">{{ seat }}</span>
          <span class="tv-seat-name">
            {{ seatLabel(seat) }}<span v-if="seat === yourSeat"> (you)</span>
          </span>
          <span
            v-if="seats[seat] && seats[seat].kind === 'human'"
            class="tv-seat-dot"
            :class="{ 'tv-seat-dot-off': !seats[seat].connected }"
            :title="seats[seat].connected ? 'connected' : 'disconnected'"
          ></span>
          <span
            v-if="readySeats.includes(seat)"
            class="tv-seat-ready"
            title="Ready for the next board"
          >✓</span>
          <span
            v-if="handCounts[seat] && phase === 'play'"
            class="tv-seat-count"
            :title="`${handCounts[seat]} card${handCounts[seat] === 1 ? '' : 's'} left in this hand`"
          >
            {{ handCounts[seat] }} card{{ handCounts[seat] === 1 ? '' : 's' }}
          </span>
        </div>
      </div>

      <p v-if="!yourSeat && !seeAll" class="tv-kibitz-note">
        The table is full — you're kibitzing.
      </p>

      <div class="tv-main">
        <div class="tv-table-wrap">
          <BridgeTable
            :hands="hands"
            :hidden-seats="displayHiddenSeats"
            :show-hcp="false"
            :clickable-seat="clickableSeat"
            :hide-played-cards="true"
            @card-click="onCardClick"
          >
            <template #center>
              <TrickArea
                v-if="phase === 'play' || phase === 'complete'"
                :current-trick="currentTrick"
                :last-finished-trick="lastFinishedTrick"
                :tricks-taken="tricksTaken"
                :next-seat="nextToAct"
                :bot-loading="botThinking"
                bot-name="Bot"
              />
              <div v-else class="tv-center">
                <div class="tv-center-line">Dealer {{ dealer || '—' }}</div>
                <div class="tv-center-line">
                  {{ vulnerable === 'None' ? 'None vul' : vulnerable + ' vul' }}
                </div>
              </div>
            </template>
          </BridgeTable>
        </div>

        <div class="tv-rail">
          <div class="tv-card">
            <h3>Auction</h3>
            <AuctionTable
              :bids="auction"
              :dealer="dealer || 'N'"
              :current-bid-index="auction.length"
              :show-turn-indicator="phase === 'bidding'"
            />
          </div>

          <div v-if="isYourBid" class="tv-card">
            <h3>Your bid</h3>
            <BiddingBox
              :last-bid="lastSuitBid"
              :can-double="canDouble"
              :can-redouble="canRedouble"
              @bid="onBid"
            />
          </div>

          <div v-else-if="phase === 'bidding' && nextToAct" class="tv-card tv-waiting">
            Waiting for {{ turnLabel }}…
          </div>

          <div v-if="phase === 'play'" class="tv-card">
            <h3>Play</h3>
            <div class="tv-status-line">
              Tricks <strong>NS {{ tricksTaken.NS }} · EW {{ tricksTaken.EW }}</strong>
            </div>
            <div v-if="clickableSeat" class="tv-status-line tv-your-turn">
              Your turn — play from {{ clickableSeat === yourSeat ? 'your hand' : 'dummy' }}.
            </div>
            <div v-else-if="nextToAct" class="tv-status-line">
              Waiting for {{ turnLabel }}…
              <span v-if="botThinking" class="tv-bot-note">(bots can take up to ~20s)</span>
            </div>
          </div>

          <div v-if="phase === 'complete'" class="tv-card">
            <h3>Result</h3>
            <div class="tv-status-line tv-result-line">
              <span v-if="resultBanner" v-html="resultBanner"></span>
              <template v-else-if="contract">
                <span v-html="contractHtml"></span> by {{ declarer }} —
                declarer took {{ declarerTricks }} trick{{ declarerTricks === 1 ? '' : 's' }}.
              </template>
              <template v-else>Passed out.</template>
            </div>
            <div class="tv-status-line">
              Tricks <strong>NS {{ tricksTaken.NS }} · EW {{ tricksTaken.EW }}</strong>
            </div>

            <!-- Session rounds: ready-up gate (session tables only) -->
            <template v-if="sessionId && yourSeat">
              <button
                class="tv-btn tv-btn-primary tv-ready-btn"
                :disabled="iAmReady || connectionStatus !== 'connected'"
                @click="onReady"
              >
                {{ iAmReady ? 'Ready ✓' : 'Ready for next board' }}
              </button>
              <div v-if="readySeats.length" class="tv-status-line tv-ready-line">
                Ready: {{ readyNames }}
              </div>
              <div v-if="iAmReady" class="tv-status-line tv-ready-wait">
                Waiting for the others — or for the teacher to open the next board.
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- Toasts -->
      <transition name="tv-fade">
        <div v-if="errorMessage" class="tv-toast tv-toast-error">{{ errorMessage }}</div>
      </transition>
      <transition name="tv-fade">
        <div v-if="undoBy" class="tv-toast">{{ undoBy }} undid the last action</div>
      </transition>

      <!-- Diagnostics (URL-gated: any ?debug value on the route shows it) -->
      <TableDiagnostics v-if="showDiagnostics" />
    </template>
  </div>
</template>

<script setup>
// TableView — the table surface for one seat (or kibitz view) of a live
// table. Pure presentation over the useRemoteTable singleton: the PARENT
// (TableLobbyView, TeacherConsoleView) owns the socket lifecycle — joining,
// identity, and leave() — so this component works identically for players,
// guests, and the teacher's kibitz panel (where yourSeat is null and every
// interaction is naturally disabled).
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import BridgeTable from '../components/BridgeTable.vue'
import BiddingBox from '../components/BiddingBox.vue'
import AuctionTable from '../components/AuctionTable.vue'
import TrickArea from '../components/TrickArea.vue'
import TableDiagnostics from '../components/table/TableDiagnostics.vue'
import { useRemoteTable } from '../composables/useRemoteTable.js'
import { SUIT_SYMBOLS } from '../utils/cardFormatting.js'

const SEAT_ORDER = ['N', 'E', 'S', 'W']
const SEAT_NAMES = { N: 'North', E: 'East', S: 'South', W: 'West' }

// ?debug=1 (any value) on the route shows the diagnostics panel — state
// dump + protocol frame log, see TableDiagnostics.vue.
const route = useRoute()
const showDiagnostics = computed(() => route.query.debug !== undefined)

defineEmits(['exit'])

const table = useRemoteTable()

const {
  connectionStatus,
  sessionId, tableId, yourSeat, role, seeAll, botMode,
  seq, boardNumber, dealer, vulnerable, phase,
  auction, contract, declarer, dummySeat,
  nextToAct, hands, handCounts,
  currentTrick, lastFinishedTrick, tricksTaken, seats,
  readySeats, boardComplete, sessionClosed,
  hiddenSeats, clickableSeat,
  isYourBid, lastSuitBid, canDouble, canRedouble,
  errorMessage, undoBy,
} = table

// ── Teacher hand-visibility toggle ─────────────────────────────────────
// The server sends teachers unredacted hands (see-all) even when seated at
// the demo table. That's right for teaching, wrong for a teacher playing a
// practice board — so teachers get an "All hands / My view" toggle. Purely
// a display filter: the data is already in this client either way.
const SHOW_ALL_HANDS_KEY = 'bridgeTableShowAllHands'
const showAllHands = ref(localStorage.getItem(SHOW_ALL_HANDS_KEY) !== '0')

function toggleShowAllHands() {
  showAllHands.value = !showAllHands.value
  localStorage.setItem(SHOW_ALL_HANDS_KEY, showAllHands.value ? '1' : '0')
}

// Offer the toggle only to viewers the server over-shares with: teacher
// tickets and see-all (kibitz) connections.
const canToggleHands = computed(() => seeAll.value || role.value === 'teacher')

// Dummy is public knowledge once the opening lead has been made.
const dummyPublic = computed(() =>
  phase.value === 'play' &&
  (currentTrick.plays.length > 0 || tricksTaken.value.NS + tricksTaken.value.EW > 0))

// What BridgeTable actually hides: the server's redaction, plus — in "My
// view" — every hand a normal player at this seat couldn't see.
const displayHiddenSeats = computed(() => {
  if (!canToggleHands.value || showAllHands.value || phase.value === 'complete') {
    return hiddenSeats.value
  }
  return SEAT_ORDER.filter(s => {
    if (!hands.value[s]) return true
    if (s === yourSeat.value) return false
    if (s === dummySeat.value && dummyPublic.value) return false
    return true
  })
})

const connectionLabel = computed(() => ({
  connected: 'Connected',
  connecting: 'Connecting…',
  minting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  unavailable: 'Unavailable',
  error: 'Connection error',
  idle: 'Offline',
}[connectionStatus.value] || connectionStatus.value))

// "abc123-t2" → "Table 2"; the demo room and odd ids show as-is.
const tableTitle = computed(() => {
  const id = tableId.value
  if (!id) return 'Table'
  const m = id.match(/-t(\d+)$/)
  return m ? `Table ${m[1]}` : `Table ${id}`
})

// "4SX" → "4♠X" with suit coloring; "3N" → "3NT".
function formatContract(text) {
  const m = text.match(/^(\d)([CDHSN])(X{0,2})$/)
  if (!m) return text
  const [, level, strain, dbl] = m
  if (strain === 'N') return `${level}NT${dbl}`
  const color = strain === 'H' || strain === 'D' ? '#d32f2f' : '#1a1a1a'
  return `${level}<span style="color:${color}">${SUIT_SYMBOLS[strain]}</span>${dbl}`
}

const contractHtml = computed(() =>
  contract.value?.text ? formatContract(contract.value.text) : '')

const declarerTricks = computed(() => {
  if (!declarer.value) return 0
  return declarer.value === 'N' || declarer.value === 'S'
    ? tricksTaken.value.NS
    : tricksTaken.value.EW
})

// The authoritative result from the board_complete event (contract,
// made/down or passed out); falls back to the derived line when a viewer
// joined after the event fired.
const resultBanner = computed(() => {
  const r = boardComplete.value
  if (!r) return ''
  if (r.passedOut) return 'Passed out.'
  const c = r.contract
  if (!c) return ''
  const made = c.made
  const outcome = made > 0
    ? `made with ${made} overtrick${made === 1 ? '' : 's'}`
    : made === 0
      ? 'made exactly'
      : `down ${-made}`
  return `${formatContract(c.text)} by ${c.declarer} — ${outcome} ` +
    `(${c.declarerTricks} trick${c.declarerTricks === 1 ? '' : 's'}).`
})

const iAmReady = computed(() =>
  !!yourSeat.value && readySeats.value.includes(yourSeat.value))

const readyNames = computed(() =>
  readySeats.value.map(s => SEAT_NAMES[s] || s).join(', '))

// Empty seats are played by the server's bots.
function seatLabel(seat) {
  const occ = seats.value[seat]
  if (!occ || occ.kind === 'empty') return 'Bot'
  return occ.name || 'Player'
}

const turnLabel = computed(() => {
  const seat = nextToAct.value
  if (!seat) return ''
  return `${SEAT_NAMES[seat]} (${seatLabel(seat)})`
})

// True when the seat on turn is a bot-played (empty) seat — bots can be slow
// (BEN early-trick plays run 10-20s), so the UI says someone is thinking.
const botThinking = computed(() => {
  const seat = nextToAct.value
  if (!seat || phase.value === 'complete') return false
  const occ = seats.value[seat]
  return !occ || occ.kind === 'empty'
})

function onBid(call) {
  table.sendBid(call)
}

function onCardClick({ seat, suit, rank }) {
  table.sendCard(seat, suit, rank)
}

function onUndo() {
  table.sendUndo()
}

function onReady() {
  table.sendReady()
}
</script>

<style scoped>
.tv-page {
  max-width: 1100px;
  margin: 0 auto;
  padding: 16px;
  font-family: 'Segoe UI', system-ui, sans-serif;
}

/* Session-closed card */
.tv-closed-card {
  max-width: 420px;
  margin: 80px auto;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 10px;
  padding: 28px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  text-align: center;
}
.tv-closed-card h2 { margin: 0 0 8px; }

/* Buttons */
.tv-btn {
  padding: 8px 16px;
  border: 1px solid #ccc;
  border-radius: 6px;
  background: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.tv-btn:hover:not(:disabled) { border-color: #007bff; }
.tv-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.tv-btn-primary {
  background: #1d9e75;
  border-color: #1d9e75;
  color: #fff;
}
.tv-btn-primary:hover:not(:disabled) { background: #178a65; border-color: #178a65; }

/* Header */
.tv-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.tv-header-left { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tv-header-right { display: flex; align-items: center; gap: 10px; }
.tv-title { font-size: 20px; font-weight: 700; margin-right: 4px; }
.tv-tag {
  background: #f0f0f0;
  border-radius: 12px;
  padding: 3px 10px;
  font-size: 13px;
  color: #444;
}
.tv-tag-vul { background: #ffebee; color: #c62828; }
.tv-tag-contract { background: #e8f5e9; color: #1b5e20; font-weight: 600; }
.tv-tag-bots { background: #ede7f6; color: #4527a0; }
.tv-tag-toggle {
  background: #e3f2ec; color: #1d6e50; border: 1px solid #bcd9cc;
  cursor: pointer; font: inherit; font-size: inherit;
}
.tv-tag-toggle:hover { background: #d2e9de; }

.tv-conn { font-size: 13px; color: #666; }
.tv-conn-connected { color: #1d9e75; }
.tv-conn-reconnecting, .tv-conn-connecting, .tv-conn-minting { color: #e6a700; }
.tv-conn-error, .tv-conn-unavailable { color: #c62828; }

/* Seats strip */
.tv-seats {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.tv-seat {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #f5f5f5;
  border: 2px solid transparent;
  border-radius: 8px;
  padding: 5px 12px;
  font-size: 14px;
}
.tv-seat-you { background: #e3f2fd; }
.tv-seat-turn { border-color: #1d9e75; }
.tv-seat-letter {
  font-weight: 700;
  color: #333;
  width: 14px;
}
.tv-seat-name { color: #444; }
.tv-seat-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #1d9e75;
}
.tv-seat-dot-off { background: #bbb; }
.tv-seat-ready { color: #1d9e75; font-weight: 700; }
.tv-seat-count { color: #888; font-size: 12px; }

.tv-kibitz-note { color: #b26a00; font-size: 14px; margin: 0 0 8px; }

/* Main layout */
.tv-main {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(240px, 1fr);
  gap: 16px;
  align-items: start;
}
.tv-table-wrap {
  background: #fbfbf8;
  border: 1px solid #e5e5e0;
  border-radius: 10px;
}
.tv-rail { display: flex; flex-direction: column; gap: 12px; }
.tv-card {
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 12px;
}
.tv-card h3 { margin: 0 0 8px; font-size: 15px; color: #333; }
.tv-waiting { color: #666; font-style: italic; }

.tv-center { text-align: center; color: #555; font-size: 14px; }
.tv-center-line { margin: 2px 0; }

.tv-status-line { font-size: 14px; color: #444; margin: 4px 0; }
.tv-your-turn { color: #1d9e75; font-weight: 600; }
.tv-bot-note { color: #999; font-size: 12px; }
.tv-result-line { font-weight: 600; }

.tv-ready-btn { margin-top: 8px; width: 100%; }
.tv-ready-line { color: #1d9e75; }
.tv-ready-wait { color: #888; font-style: italic; }

/* Toasts */
.tv-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: #333;
  color: #fff;
  padding: 10px 18px;
  border-radius: 8px;
  font-size: 14px;
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.25);
  z-index: 100;
}
.tv-toast-error { background: #c62828; }
.tv-fade-enter-active, .tv-fade-leave-active { transition: opacity 0.25s; }
.tv-fade-enter-from, .tv-fade-leave-to { opacity: 0; }

@media (max-width: 800px) {
  .tv-main { grid-template-columns: 1fr; }
}
</style>

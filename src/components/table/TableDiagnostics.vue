<template>
  <section class="diag">
    <div class="diag-header">
      <strong>Diagnostics</strong>
      <span class="diag-hint">shown because the URL has ?debug — remove it to hide</span>
      <button class="diag-btn" @click="copyState">{{ copied ? 'Copied!' : 'Copy state' }}</button>
    </div>

    <div class="diag-grid">
      <div class="diag-card">
        <h4>Connection</h4>
        <dl>
          <dt>status</dt>
          <dd :class="'diag-status-' + connectionStatus">{{ connectionStatus }}</dd>
          <dt>session</dt>
          <dd>{{ sessionId || '—' }}</dd>
          <dt>table</dt>
          <dd>{{ tableId || '—' }}</dd>
          <dt>you</dt>
          <dd>{{ yourName || '—' }} ({{ role || 'guest' }}) seat {{ yourSeat || '—' }}</dd>
          <dt>bot mode</dt>
          <dd>{{ botMode || '—' }}</dd>
          <dt>see all</dt>
          <dd>{{ seeAll ? 'yes (teacher/kibitz)' : 'no' }}</dd>
        </dl>
      </div>

      <div class="diag-card">
        <h4>Board</h4>
        <dl>
          <dt>seq</dt>
          <dd>{{ seq }}</dd>
          <dt>board</dt>
          <dd>{{ boardNumber ?? '—' }} · dealer {{ dealer || '—' }} · {{ vulnerable || '—' }} vul</dd>
          <dt>phase</dt>
          <dd>{{ phase || '—' }}</dd>
          <dt>contract</dt>
          <dd>{{ contract ? contract.text + ' by ' + declarer : '—' }}</dd>
          <dt>turn</dt>
          <dd>{{ nextToAct || '—' }}</dd>
          <dt>tricks</dt>
          <dd>NS {{ tricksTaken.NS }} · EW {{ tricksTaken.EW }}</dd>
          <dt>trick now</dt>
          <dd>{{ trickNow }}</dd>
          <dt>my legal</dt>
          <dd>{{ legalNow }}</dd>
        </dl>
      </div>

      <div class="diag-card">
        <h4>Seats</h4>
        <table class="diag-seats">
          <tbody>
            <tr v-for="d in ['N', 'E', 'S', 'W']" :key="d">
              <td class="diag-seat-dir">{{ d }}</td>
              <td>{{ seatLabel(d) }}</td>
              <td>
                <span :class="seatClass(d)">{{ seatStatus(d) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <dl>
          <dt>hand counts</dt>
          <dd>{{ handCountsLine }}</dd>
          <dt>boards open</dt>
          <dd>{{ boardsOpen ? boardsOpen.open + '/' + boardsOpen.total : '—' }}</dd>
        </dl>
      </div>
    </div>

    <div class="diag-card diag-log">
      <h4>
        Frames <span class="diag-hint">newest first · {{ frames.length }} kept</span>
      </h4>
      <div class="diag-log-scroll">
        <details v-for="f in frames" :key="f.id" class="diag-frame">
          <summary>
            <span class="diag-frame-time">{{ timeOf(f.at) }}</span>
            <span :class="f.dir === 'in' ? 'diag-dir-in' : 'diag-dir-out'">{{
              f.dir === 'in' ? '◂' : '▸'
            }}</span>
            <span class="diag-frame-line">{{ summaryOf(f.msg) }}</span>
          </summary>
          <pre>{{ pretty(f.msg) }}</pre>
        </details>
      </div>
    </div>
  </section>
</template>

<script setup>
// URL-gated diagnostics for the multiplayer table (?debug=1 on the route).
// Read-only: mirrors useRemoteTable state plus the socket layer's rolling
// frame log so table issues can be reported with exact protocol traffic.
import { computed, ref } from 'vue'
import { useRemoteTable } from '../../composables/useRemoteTable.js'
import { useTableSocket } from '../../composables/useTableSocket.js'

const {
  connectionStatus,
  sessionId,
  tableId,
  yourName,
  role,
  yourSeat,
  seeAll,
  botMode,
  seq,
  boardNumber,
  dealer,
  vulnerable,
  phase,
  contract,
  declarer,
  nextToAct,
  currentTrick,
  tricksTaken,
  seats,
  boardsOpen,
  handCounts,
  legalCards,
} = useRemoteTable()

const { frameLog } = useTableSocket()

const frames = computed(() => frameLog.value.slice().reverse())

// currentTrick is a reactive object ({leader, plays:[{seat,suit,rank}]}),
// not a ref.
const trickNow = computed(() => {
  if (!currentTrick.plays?.length) return '—'
  const plays = currentTrick.plays.map((p) => `${p.seat}:${p.suit}${p.rank}`).join(' ')
  return `led ${currentTrick.leader} · ${plays}`
})

const legalNow = computed(() =>
  legalCards.value?.length ? legalCards.value.map((c) => c.suit + c.rank).join(' ') : '—'
)

const handCountsLine = computed(() => {
  const hc = handCounts.value || {}
  return ['N', 'E', 'S', 'W'].map((d) => `${d}:${hc[d] ?? '?'}`).join(' ')
})

function seatLabel(d) {
  const s = seats.value?.[d]
  if (!s || s.kind === 'empty') return 'bot (empty)'
  return s.name || s.kind
}

function seatStatus(d) {
  const s = seats.value?.[d]
  if (!s || s.kind === 'empty') return 'bot'
  return s.connected ? 'connected' : 'DISCONNECTED'
}

function seatClass(d) {
  const s = seats.value?.[d]
  if (!s || s.kind === 'empty') return 'diag-seat-bot'
  return s.connected ? 'diag-seat-ok' : 'diag-seat-bad'
}

function timeOf(at) {
  return at.toTimeString().slice(0, 8) + '.' + String(at.getMilliseconds()).padStart(3, '0')
}

// One-line gist per frame: enough to scan the flow without expanding.
function summaryOf(msg) {
  const bits = [msg.t]
  if (msg.kind) bits.push(msg.kind)
  if (msg.seat) bits.push(msg.seat)
  if (msg.call) bits.push(msg.call)
  if (msg.card) bits.push(msg.card)
  if (msg.by_bot) bits.push(`bot:${msg.via || '?'}`)
  if (typeof msg.seq === 'number') bits.push(`#${msg.seq}`)
  if (msg.t === 'welcome') bits.push(msg.bot_mode || '')
  if (msg.t === 'error') bits.push(msg.code || '')
  return bits.filter(Boolean).join(' · ')
}

function pretty(msg) {
  return JSON.stringify(msg, null, 2)
}

// "Copy state" → JSON snapshot of everything above, for pasting into a bug
// report (or straight to Claude).
const copied = ref(false)

async function copyState() {
  const snapshot = {
    at: new Date().toISOString(),
    connection: connectionStatus.value,
    sessionId: sessionId.value,
    tableId: tableId.value,
    you: { name: yourName.value, role: role.value, seat: yourSeat.value, seeAll: seeAll.value },
    botMode: botMode.value,
    seq: seq.value,
    board: { number: boardNumber.value, dealer: dealer.value, vulnerable: vulnerable.value },
    phase: phase.value,
    contract: contract.value,
    declarer: declarer.value,
    nextToAct: nextToAct.value,
    tricks: tricksTaken.value,
    currentTrick: { leader: currentTrick.leader, plays: currentTrick.plays },
    seats: seats.value,
    boardsOpen: boardsOpen.value,
    handCounts: handCounts.value,
    legalCards: legalCards.value,
    frames: frameLog.value.map((f) => ({ at: f.at.toISOString(), dir: f.dir, msg: f.msg })),
  }
  try {
    await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2))
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    // Clipboard can be denied — fall back to console so it's still grabbable.
    // eslint-disable-next-line no-console
    console.log('[table diagnostics]', snapshot)
  }
}
</script>

<style scoped>
.diag {
  margin-top: 16px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: #d7dce2;
  background: #14181d;
  border: 1px solid #2a323b;
  border-radius: 8px;
  padding: 10px 12px;
  text-align: left;
}
.diag-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.diag-header strong {
  color: #7fd0a0;
  font-size: 13px;
}
.diag-hint {
  color: #6b7683;
  font-size: 11px;
}
.diag-btn {
  margin-left: auto;
  background: #1f2830;
  color: #d7dce2;
  border: 1px solid #33404c;
  border-radius: 5px;
  padding: 2px 10px;
  font: inherit;
  cursor: pointer;
}
.diag-btn:hover {
  background: #2a3641;
}
.diag-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 10px;
}
.diag-card {
  background: #191f26;
  border: 1px solid #242d36;
  border-radius: 6px;
  padding: 8px 10px;
}
.diag-card h4 {
  margin: 0 0 6px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #8fa1b3;
}
.diag-card dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 10px;
  margin: 0;
}
.diag-card dt {
  color: #6b7683;
}
.diag-card dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.diag-status-connected {
  color: #7fd0a0;
}
.diag-status-reconnecting,
.diag-status-connecting,
.diag-status-minting {
  color: #e8c268;
}
.diag-status-error,
.diag-status-unavailable {
  color: #e88e8e;
}
.diag-seats {
  border-collapse: collapse;
  margin-bottom: 6px;
  width: 100%;
}
.diag-seats td {
  padding: 1px 8px 1px 0;
}
.diag-seat-dir {
  color: #8fa1b3;
  font-weight: 700;
}
.diag-seat-ok {
  color: #7fd0a0;
}
.diag-seat-bad {
  color: #e88e8e;
  font-weight: 700;
}
.diag-seat-bot {
  color: #8fa1b3;
}
.diag-log {
  margin-top: 10px;
}
.diag-log-scroll {
  max-height: 260px;
  overflow-y: auto;
}
.diag-frame summary {
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 1px 0;
  list-style-position: inside;
}
.diag-frame summary::marker {
  color: #47535f;
}
.diag-frame-time {
  color: #6b7683;
}
.diag-dir-in {
  color: #7fb8d0;
}
.diag-dir-out {
  color: #e8c268;
}
.diag-frame pre {
  margin: 2px 0 6px 18px;
  padding: 6px 8px;
  background: #10141a;
  border-radius: 4px;
  overflow-x: auto;
  color: #b6c2cd;
}
</style>

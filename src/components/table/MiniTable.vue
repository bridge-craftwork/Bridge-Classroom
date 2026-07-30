<template>
  <div class="mt">
    <!-- Head: identity + state at a glance -->
    <div class="mt-head">
      <button class="mt-name" title="Open the full live view of this table" @click="$emit('kibitz')">
        {{ name }}
      </button>
      <template v-if="loaded">
        <span class="mt-chip">Bd {{ t.board_no }}</span>
        <span v-if="t.contract" class="mt-chip mt-chip-contract">
          <span v-html="suitHtml(t.contract.text)"></span> by {{ t.contract.declarer }}
        </span>
        <span v-else class="mt-chip" :class="'mt-phase-' + t.phase">{{ t.phase }}</span>
        <span v-if="t.phase !== 'bidding' && !t.result?.bid_only" class="mt-chip">NS {{ t.tricks.ns }} · EW {{ t.tricks.ew }}</span>
      </template>
      <span v-else class="mt-chip mt-chip-nodeal">no deal</span>
      <span class="mt-head-spacer"></span>
      <button
        class="mt-icon"
        title="Move this table to its next board now"
        @click="$emit('advance')"
      >⏭</button>
    </div>

    <!-- Compass diagram: N top, W/E flanking the trick, S bottom -->
    <div class="mt-compass">
      <div class="mt-pos mt-pos-n">
        <div class="mt-who" :class="{ 'mt-turn': isOnTurn('N') }">
          <span class="mt-seat">N{{ isOnTurn('N') ? '▸' : '' }}</span>
          <button class="mt-player" :title="playerTitle('N')" @click="$emit('seat-click', 'N')">
            {{ playerName('N') }}<span v-if="isHuman('N')" class="mt-dot" :class="{ 'mt-dot-off': !t.seats.N.connected }"></span>
          </button>
        </div>
        <div class="mt-cards" v-html="handHtml('N')"></div>
      </div>

      <div class="mt-pos mt-pos-w">
        <div class="mt-who" :class="{ 'mt-turn': isOnTurn('W') }">
          <span class="mt-seat">W{{ isOnTurn('W') ? '▸' : '' }}</span>
          <button class="mt-player" :title="playerTitle('W')" @click="$emit('seat-click', 'W')">
            {{ playerName('W') }}<span v-if="isHuman('W')" class="mt-dot" :class="{ 'mt-dot-off': !t.seats.W.connected }"></span>
          </button>
        </div>
        <div class="mt-cards mt-cards-side" v-html="handHtmlSide('W')"></div>
      </div>

      <div class="mt-pos mt-pos-c">
        <div v-if="!loaded" class="mt-center-note">no deal</div>
        <template v-else-if="t.phase === 'play' && t.current_trick && t.current_trick.plays.length">
          <div v-for="p in t.current_trick.plays" :key="p.seat" class="mt-trick-card">
            {{ p.seat }}&thinsp;<span v-html="cardHtml(p.card)"></span>
          </div>
        </template>
        <div v-else-if="t.phase === 'play'" class="mt-center-note">{{ t.next_to_act }} to lead</div>
        <div v-else-if="t.phase === 'complete'" class="mt-center-note mt-center-result">
          <template v-if="t.result?.bid_only">bid only<br />no play</template>
          <template v-else-if="t.result && t.result.contract">
            {{ resultWord }}<br />
            {{ t.result.contract.declarer_tricks }} tricks
          </template>
          <template v-else>Passed<br />out</template>
        </div>
        <div v-else class="mt-center-note">bidding</div>
      </div>

      <div class="mt-pos mt-pos-e">
        <div class="mt-who" :class="{ 'mt-turn': isOnTurn('E') }">
          <span class="mt-seat">E{{ isOnTurn('E') ? '▸' : '' }}</span>
          <button class="mt-player" :title="playerTitle('E')" @click="$emit('seat-click', 'E')">
            {{ playerName('E') }}<span v-if="isHuman('E')" class="mt-dot" :class="{ 'mt-dot-off': !t.seats.E.connected }"></span>
          </button>
        </div>
        <div class="mt-cards mt-cards-side" v-html="handHtmlSide('E')"></div>
      </div>

      <div class="mt-pos mt-pos-s">
        <div class="mt-who" :class="{ 'mt-turn': isOnTurn('S') }">
          <span class="mt-seat">S{{ isOnTurn('S') ? '▸' : '' }}</span>
          <button class="mt-player" :title="playerTitle('S')" @click="$emit('seat-click', 'S')">
            {{ playerName('S') }}<span v-if="isHuman('S')" class="mt-dot" :class="{ 'mt-dot-off': !t.seats.S.connected }"></span>
          </button>
        </div>
        <div class="mt-cards" v-html="handHtml('S')"></div>
      </div>
    </div>

    <!-- Auction: micro grid, dealer-aligned -->
    <div v-if="auctionRows.length" class="mt-auction">
      <div class="mt-auction-row mt-auction-header">
        <span v-for="s in SEAT_ORDER_WNES" :key="s">{{ s }}</span>
      </div>
      <div v-for="(row, i) in auctionRows" :key="i" class="mt-auction-row">
        <span
          v-for="(call, j) in row"
          :key="j"
          :class="{ 'mt-call-last': i === auctionRows.length - 1 && j === lastCallCol }"
          v-html="call === null ? '' : suitHtml(call)"
        ></span>
      </div>
    </div>
  </div>
</template>

<script setup>
// MiniTable — one live table panel in the teacher's multi-table monitor,
// laid out as the classic compass diagram (N top, W/E flanking the trick,
// S bottom) so a teacher can internalize each hand at a glance. N/S hands
// are one line; W/E stack two suits per line to keep the panel narrow.
// Pure presentation over the enriched lobby feed; all interaction emits.
import { computed } from 'vue'

const SEAT_ORDER = ['N', 'E', 'S', 'W']
const SEAT_ORDER_WNES = ['W', 'N', 'E', 'S']
const SUIT_ORDER = ['S', 'H', 'D', 'C']
const SUIT_SYM = { S: '♠', H: '♥', D: '♦', C: '♣' }
const RANK_VALUE = { A: 14, K: 13, Q: 12, J: 11, T: 10, 9: 9, 8: 8, 7: 7, 6: 6, 5: 5, 4: 4, 3: 3, 2: 2 }

const props = defineProps({
  t: { type: Object, required: true },
  name: { type: String, required: true },
  // False while the session has no deal loaded: show seats but no cards/board
  // (the lobby still carries a placeholder board server-side).
  loaded: { type: Boolean, default: true },
})
defineEmits(['kibitz', 'advance', 'seat-click'])

// `result.contract.made` is a RELATIVE figure from the service (0 = made
// exactly, +N overtricks, -N down), so the obvious `made ? 'Made' : 'Down'`
// read a contract made exactly — the commonest result there is — as "Down".
const resultWord = computed(() => {
  const made = props.t.result?.contract?.made
  if (typeof made !== 'number') return ''
  return made < 0 ? `Down ${-made}` : made === 0 ? 'Made' : `Made +${made}`
})

function isHuman(seat) {
  return props.t.seats?.[seat]?.kind === 'human'
}

function playerName(seat) {
  return isHuman(seat) ? props.t.seats[seat].name : 'Bot'
}

function playerTitle(seat) {
  return isHuman(seat)
    ? `${props.t.seats[seat].name} — seat actions`
    : 'Empty seat (bot) — seat actions'
}

function isOnTurn(seat) {
  return props.t.next_to_act === seat && props.t.phase !== 'complete'
}

function sym(suitChar) {
  const red = suitChar === 'H' || suitChar === 'D'
  return `<span class="${red ? 'mt-red' : 'mt-black'}">${SUIT_SYM[suitChar]}</span>`
}

function suitRanks(seat) {
  const cards = props.t.hands?.[seat] || []
  const bySuit = { S: [], H: [], D: [], C: [] }
  for (const c of cards) bySuit[c[0]]?.push(c[1])
  for (const s of SUIT_ORDER) {
    bySuit[s] = bySuit[s]
      .sort((a, b) => RANK_VALUE[b] - RANK_VALUE[a])
      .map((r) => (r === 'T' ? '10' : r))
      .join('')
  }
  return bySuit
}

// One line: ♠KQ83 ♥1054 ♦J6 ♣863 (N/S). Blank until a deal is loaded.
function handHtml(seat) {
  if (!props.loaded) return ''
  const r = suitRanks(seat)
  return SUIT_ORDER.map((s) => `${sym(s)}${r[s] || '—'}`).join(' ')
}

// Two lines of two suits (W/E side columns).
function handHtmlSide(seat) {
  if (!props.loaded) return ''
  const r = suitRanks(seat)
  return (
    `${sym('S')}${r.S || '—'} ${sym('H')}${r.H || '—'}<br>` +
    `${sym('D')}${r.D || '—'} ${sym('C')}${r.C || '—'}`
  )
}

function cardHtml(code) {
  return `${sym(code[0])}${code[1] === 'T' ? '10' : code[1]}`
}

// "1H" → 1♥ with color; "3N"/"3NX" → 3NT/3NTX; Pass → P; X/XX as-is.
function suitHtml(call) {
  if (call === 'Pass') return '<span class="mt-pass">P</span>'
  const m = String(call).match(/^(\d)([SHDCN])(X{0,2})$/)
  if (!m) return String(call)
  const body = m[2] === 'N' ? 'NT' : sym(m[2])
  return `${m[1]}${body}${m[3]}`
}

// Auction rows in fixed W N E S columns (nulls pad before the dealer).
const auctionRows = computed(() => {
  const calls = props.t.auction || []
  if (!calls.length) return []
  const offset = SEAT_ORDER_WNES.indexOf(props.t.dealer || 'N')
  const cells = new Array(offset).fill(null).concat(calls)
  const rows = []
  for (let i = 0; i < cells.length; i += 4) {
    const row = cells.slice(i, i + 4)
    while (row.length < 4) row.push(null)
    rows.push(row)
  }
  return rows
})

const lastCallCol = computed(() => {
  const rows = auctionRows.value
  if (!rows.length) return -1
  const last = rows[rows.length - 1]
  for (let j = last.length - 1; j >= 0; j--) if (last[j] !== null) return j
  return -1
})
</script>

<style scoped>
.mt {
  background: #fff;
  border: 1px solid #dde3e8;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12.5px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.mt-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.mt-name {
  border: none; background: none; font-weight: 700; font-size: 13.5px;
  color: #1d4e89; cursor: pointer; padding: 0;
}
.mt-name:hover { text-decoration: underline; }
.mt-chip {
  background: #f0f3f6; border-radius: 4px; padding: 1px 6px;
  font-size: 11px; color: #445; white-space: nowrap;
}
.mt-chip-contract { background: #e8f1fb; font-weight: 600; }
.mt-chip-nodeal { background: #eceff2; color: #8a97a3; font-style: italic; }
.mt-phase-bidding { background: #fdf3d8; }
.mt-phase-play { background: #e3f2ec; }
.mt-phase-complete { background: #ece8f6; }
.mt-head-spacer { flex: 1; }
.mt-icon { border: none; background: none; cursor: pointer; font-size: 13px; padding: 0 2px; opacity: 0.55; }
.mt-icon:hover { opacity: 1; }

/* Compass: N / W-center-E / S */
.mt-compass {
  display: grid;
  grid-template-columns: 1fr minmax(64px, auto) 1fr;
  grid-template-areas:
    "n n n"
    "w c e"
    "s s s";
  gap: 2px 8px;
  align-items: center;
}
.mt-pos-n { grid-area: n; text-align: center; }
.mt-pos-s { grid-area: s; text-align: center; }
.mt-pos-w { grid-area: w; }
.mt-pos-e { grid-area: e; text-align: right; }
.mt-pos-c {
  grid-area: c;
  text-align: center;
  align-self: stretch;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  background: #f7f9f7;
  border-radius: 6px;
  padding: 3px 6px;
  min-height: 48px;
}
.mt-who {
  display: inline-flex; align-items: center; gap: 4px;
  border-radius: 4px; padding: 0 4px;
}
.mt-pos-n .mt-who, .mt-pos-s .mt-who { justify-content: center; }
.mt-turn { background: #fff3c8; }
.mt-seat { font-weight: 700; color: #333; }
.mt-player {
  border: none; background: none; padding: 0; cursor: pointer;
  font-size: 11px; color: #667; max-width: 110px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mt-player:hover { color: #1d4e89; text-decoration: underline; }
.mt-dot {
  display: inline-block; width: 6px; height: 6px; border-radius: 50%;
  background: #2fa572; margin-left: 3px; vertical-align: middle;
}
.mt-dot-off { background: #d33; }
.mt-cards {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px; letter-spacing: 0.02em; white-space: nowrap;
}
.mt-cards-side { line-height: 1.35; }
.mt-cards :deep(.mt-red), .mt-pos-c :deep(.mt-red), .mt-chip :deep(.mt-red), .mt-auction :deep(.mt-red) { color: #c62828; }
.mt-cards :deep(.mt-black), .mt-pos-c :deep(.mt-black), .mt-chip :deep(.mt-black), .mt-auction :deep(.mt-black) { color: #111; }
.mt-trick-card { font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
.mt-center-note { font-size: 10.5px; color: #8a97a3; text-transform: uppercase; letter-spacing: 0.05em; }
.mt-center-result { color: #333; font-weight: 600; text-transform: none; font-size: 12px; }

.mt-auction { border-top: 1px dashed #e3e8ec; padding-top: 4px; font-size: 11.5px; }
.mt-auction-row { display: grid; grid-template-columns: repeat(4, 1fr); text-align: center; }
.mt-auction-header { color: #99a; font-size: 10px; }
.mt-auction :deep(.mt-pass) { color: #9aa; }
.mt-call-last { background: #eef6ff; border-radius: 3px; font-weight: 600; }
</style>

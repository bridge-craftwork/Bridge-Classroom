// useRemoteTable — mirrors server events from the bridge-table-service into
// the reactive shape the presentation components (BridgeTable, BiddingBox,
// AuctionTable, TrickArea) already consume in solo mode. The server is the
// sole authority: this composable never decides legality, it only tracks
// state from events and replaces it wholesale whenever a snapshot arrives
// (join, reconnect, undo). Client-side legality via cardplayRules.js is a
// UX hint only — illegal sends would be rejected by the server anyway.
//
// Singleton pattern (module-level state) per project convention.

import { ref, reactive, computed } from 'vue'
import { useTableSocket } from './useTableSocket.js'
import { getLegalCards, handToCards } from '../utils/cardplayRules.js'

const SEAT_ORDER = ['N', 'E', 'S', 'W']
const SUIT_KEY = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' }
const RANK_VALUE = {
  A: 14, K: 13, Q: 12, J: 11, T: 10,
  9: 9, 8: 8, 7: 7, 6: 6, 5: 5, 4: 4, 3: 3, 2: 2,
}

// How long a completed trick stays face-up before it clears. The server
// paces bots ~1s between tricks, so this fills the gap without hiding the
// next trick's opening play (an incoming play clears it immediately).
const TRICK_LINGER_MS = 1200

const socket = useTableSocket()

// ── Module-level singleton state ───────────────────────────────────────

const tableId = ref(null)
const yourName = ref('')
const role = ref('')
const yourSeat = ref(null)
// Server-confirmed bot backend for empty seats ('' until the welcome says).
const botMode = ref('')

const seq = ref(0)
const board = ref(null) // { number, dealer, vulnerable }
const phase = ref(null) // 'bidding' | 'play' | 'complete'
const auction = ref([]) // PBN calls: '1H', '1N', 'Pass', 'X', 'XX'
const contract = ref(null) // { text, declarer } or null
const nextToAct = ref(null)
// Visible hands per seat: { spades: [...], ... } or null when hidden.
const hands = ref({ N: null, E: null, S: null, W: null })
// Remaining-card counts per seat (also tracked for hidden hands).
const handCounts = ref({ N: 0, E: 0, S: 0, W: 0 })
const currentTrick = reactive({ leader: null, plays: [] }) // plays: [{seat, suit, rank}]
const lastFinishedTrick = ref(null) // { leader, plays, winner }
const tricksTaken = ref({ NS: 0, EW: 0 })
// { N: {kind:'human',name,connected} | {kind:'empty'}, ... } — empty seats
// are played by the server's bots.
const seats = ref({})

const errorMessage = ref('')
const undoBy = ref('')

let trickLingerTimer = null
let errorTimer = null
let undoTimer = null
// One dummy-reveal resync per opening lead (see below).
let dummyResyncRequested = false
let unsubscribe = null

// ── Small pure helpers ─────────────────────────────────────────────────

function codeToPlay(seat, code) {
  return { seat, suit: code[0], rank: code[1] }
}

// ["SA","HK",...] → { spades:['A',...], hearts:[...], ... }, ranks high→low.
function cardsToHand(codes) {
  const hand = { spades: [], hearts: [], diamonds: [], clubs: [] }
  for (const code of codes) {
    const key = SUIT_KEY[code[0]]
    if (key) hand[key].push(code[1])
  }
  for (const key of Object.keys(hand)) {
    hand[key].sort((a, b) => RANK_VALUE[b] - RANK_VALUE[a])
  }
  return hand
}

function removeCardFromHand(hand, suit, rank) {
  const key = SUIT_KEY[suit]
  if (!hand || !key) return
  const idx = hand[key].indexOf(rank)
  if (idx !== -1) hand[key].splice(idx, 1)
}

// Client-side auction folding — only used between the auction-ending pass
// and the next snapshot (bid_made events don't carry the contract).
function isAuctionOver(calls) {
  if (calls.length < 4) return false
  if (!calls.slice(-3).every(c => c === 'Pass')) return false
  if (calls.every(c => c === 'Pass')) return calls.length === 4
  return calls.slice(0, -3).some(c => c !== 'Pass')
}

function seatAtIndex(dealer, idx) {
  return SEAT_ORDER[(SEAT_ORDER.indexOf(dealer) + idx) % 4]
}

function determineContract(calls, dealer) {
  if (calls.every(c => c === 'Pass')) return null // passed out
  let last = null
  let lastIdx = -1
  for (let i = calls.length - 1; i >= 0; i--) {
    if (calls[i] !== 'Pass' && calls[i] !== 'X' && calls[i] !== 'XX') {
      last = calls[i]
      lastIdx = i
      break
    }
  }
  if (!last) return null
  let dbl = ''
  for (let i = calls.length - 1; i > lastIdx; i--) {
    if (calls[i] === 'XX') { dbl = 'XX'; break }
    if (calls[i] === 'X') { dbl = 'X'; break }
  }
  const strain = last.replace(/^\d/, '')
  const lastSeat = seatAtIndex(dealer, lastIdx)
  const side = (lastSeat === 'N' || lastSeat === 'S') ? ['N', 'S'] : ['E', 'W']
  // Declarer: first player on the winning side to name the final strain.
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i]
    if (c === 'Pass' || c === 'X' || c === 'XX') continue
    if (c.replace(/^\d/, '') === strain && side.includes(seatAtIndex(dealer, i))) {
      return { text: last + dbl, declarer: seatAtIndex(dealer, i) }
    }
  }
  return { text: last + dbl, declarer: lastSeat }
}

function partnerOf(seat) {
  return SEAT_ORDER[(SEAT_ORDER.indexOf(seat) + 2) % 4]
}

// BiddingBox emits notrump as '1NT'; the wire protocol (like PBN and the
// snapshot auction) uses '1N'. Exported for tests.
export function toServerCall(call) {
  return call.replace(/^(\d)NT$/, '$1N')
}

function clearTrickLinger() {
  if (trickLingerTimer) { clearTimeout(trickLingerTimer); trickLingerTimer = null }
  lastFinishedTrick.value = null
}

function showError(msg) {
  errorMessage.value = msg
  if (errorTimer) clearTimeout(errorTimer)
  errorTimer = setTimeout(() => { errorMessage.value = '' }, 5000)
}

// ── Derived ────────────────────────────────────────────────────────────

const dealer = computed(() => board.value?.dealer || null)
const vulnerable = computed(() => board.value?.vulnerable || 'None')
const boardNumber = computed(() => board.value?.number ?? null)
const declarer = computed(() => contract.value?.declarer || null)
const dummySeat = computed(() => (declarer.value ? partnerOf(declarer.value) : null))

const hiddenSeats = computed(() => SEAT_ORDER.filter(s => !hands.value[s]))

// The seat whose cards this viewer may click: your own seat on your turn,
// or dummy's when you're declarer and dummy is on turn.
const clickableSeat = computed(() => {
  if (phase.value !== 'play' || !yourSeat.value || !nextToAct.value) return null
  if (nextToAct.value === yourSeat.value) return yourSeat.value
  if (declarer.value === yourSeat.value && nextToAct.value === dummySeat.value) {
    return dummySeat.value
  }
  return null
})

// Legal-card hints for the clickable seat (follow-suit filtering).
const legalCards = computed(() => {
  const seat = clickableSeat.value
  if (!seat || !hands.value[seat]) return []
  return getLegalCards(handToCards(hands.value[seat]), currentTrick.plays)
})

const isYourBid = computed(() =>
  phase.value === 'bidding' && !!yourSeat.value && nextToAct.value === yourSeat.value)

// BiddingBox props, mirrored from the solo view's trailing-pass logic.
const lastSuitBid = computed(() => {
  for (let i = auction.value.length - 1; i >= 0; i--) {
    const c = auction.value[i]
    if (c !== 'Pass' && c !== 'X' && c !== 'XX') return c
  }
  return null
})

function trailingSinceLastNonPass() {
  const trailing = []
  for (let i = auction.value.length - 1; i >= 0; i--) {
    if (auction.value[i] === 'Pass') trailing.push('Pass')
    else { trailing.push(auction.value[i]); break }
  }
  return trailing
}

const canDouble = computed(() => {
  const trailing = trailingSinceLastNonPass()
  const lastNonPass = trailing[trailing.length - 1]
  if (!lastNonPass || lastNonPass === 'Pass') return false
  if (lastNonPass === 'X' || lastNonPass === 'XX') return false
  return trailing.length % 2 === 1
})

const canRedouble = computed(() => {
  const trailing = trailingSinceLastNonPass()
  if (trailing[trailing.length - 1] !== 'X') return false
  return trailing.length % 2 === 1
})

// ── Server message handling ────────────────────────────────────────────

function applySnapshot(state) {
  seq.value = state.seq
  board.value = state.board
  phase.value = state.phase
  auction.value = [...(state.auction || [])]
  contract.value = state.contract
    ? { text: state.contract.text, declarer: state.contract.declarer }
    : null
  nextToAct.value = state.next_to_act || null

  const newHands = { N: null, E: null, S: null, W: null }
  const newCounts = { N: 0, E: 0, S: 0, W: 0 }
  for (const seat of SEAT_ORDER) {
    const h = state.hands?.[seat]
    if (!h) continue
    if (h.visible) {
      newHands[seat] = cardsToHand(h.cards)
      newCounts[seat] = h.cards.length
    } else {
      newCounts[seat] = h.count
    }
  }
  hands.value = newHands
  handCounts.value = newCounts

  clearTrickLinger()
  if (state.current_trick) {
    currentTrick.leader = state.current_trick.leader
    currentTrick.plays = state.current_trick.plays.map(p => codeToPlay(p.seat, p.card))
  } else {
    currentTrick.leader = null
    currentTrick.plays = []
  }
  tricksTaken.value = { NS: state.tricks?.ns ?? 0, EW: state.tricks?.ew ?? 0 }
  if (state.your_seat) yourSeat.value = state.your_seat

  // Re-arm the dummy-reveal resync only while the opening lead hasn't been
  // made in this (possibly rewound) state. If the snapshot already reflects
  // a made lead, the server has shown everything it will show — never
  // re-request, or a redaction disagreement would loop resyncs.
  const playedCount =
    (tricksTaken.value.NS + tricksTaken.value.EW) * 4 + currentTrick.plays.length
  dummyResyncRequested = playedCount > 0
}

// Bid/play events carry the table seq. Stale events (replays after a
// snapshot already covered them) are dropped; a gap means we missed
// events, so we resync rather than apply out of order.
function guardSeq(ev) {
  if (typeof ev.seq !== 'number') return true
  if (ev.seq <= seq.value) return false
  if (ev.seq > seq.value + 1) {
    socket.resync()
    return false
  }
  seq.value = ev.seq
  return true
}

function handleBidMade(ev) {
  if (!guardSeq(ev)) return
  auction.value = [...auction.value, ev.call]
  nextToAct.value = ev.next_to_act || null
  if (isAuctionOver(auction.value)) {
    // Events don't carry the contract — fold it client-side until the next
    // snapshot corrects any drift. (Server rule: first on the winning side
    // to name the final strain declares.)
    const c = determineContract(auction.value, dealer.value)
    if (c) {
      contract.value = c
      phase.value = 'play'
    } else {
      contract.value = null
      phase.value = 'complete' // passed out
    }
  }
}

function handleCardPlayed(ev) {
  if (!guardSeq(ev)) return
  clearTrickLinger() // an incoming play must never hide behind a lingering trick
  const play = codeToPlay(ev.seat, ev.card)
  if (currentTrick.plays.length === 0) currentTrick.leader = play.seat
  currentTrick.plays.push(play)

  removeCardFromHand(hands.value[play.seat], play.suit, play.rank)
  handCounts.value = {
    ...handCounts.value,
    [play.seat]: Math.max(0, handCounts.value[play.seat] - 1),
  }

  nextToAct.value = ev.next_to_act || null
  if (ev.tricks) tricksTaken.value = { NS: ev.tricks.ns, EW: ev.tricks.ew }

  if (ev.trick_winner) {
    lastFinishedTrick.value = {
      leader: currentTrick.leader,
      plays: currentTrick.plays.slice(),
      winner: ev.trick_winner,
    }
    currentTrick.leader = ev.trick_winner
    currentTrick.plays = []
    trickLingerTimer = setTimeout(() => {
      trickLingerTimer = null
      lastFinishedTrick.value = null
    }, TRICK_LINGER_MS)
  }

  if (tricksTaken.value.NS + tricksTaken.value.EW === 13) {
    phase.value = 'complete'
  }

  // PROTOCOL GAP WORKAROUND: the server reveals dummy in snapshots once the
  // opening lead is made, but never pushes a snapshot at that moment — the
  // card_played event can't carry dummy's cards (it's broadcast, snapshots
  // are per-viewer). Rejoining fetches a fresh redacted snapshot, so we
  // resync once when dummy should now be visible but isn't.
  if (
    phase.value === 'play' &&
    dummySeat.value &&
    !hands.value[dummySeat.value] &&
    !dummyResyncRequested
  ) {
    dummyResyncRequested = true
    socket.resync()
  }
}

function handleMessage(msg) {
  switch (msg.t) {
    case 'welcome':
      tableId.value = msg.table_id
      yourName.value = msg.name
      role.value = msg.role
      yourSeat.value = msg.seat || null
      botMode.value = msg.bot_mode || ''
      // PROTOCOL GAP WORKAROUND: the server broadcasts the seat_update for a
      // join BEFORE the joining connection subscribes to the room, so the
      // joiner never sees its own seating (or who else is already seated).
      // Seed our own chip from the welcome; other humans show as "Bot" until
      // the next seat_update reaches us. Real fix: seats in the snapshot.
      if (msg.seat && !seats.value[msg.seat]) {
        seats.value = {
          ...seats.value,
          [msg.seat]: { kind: 'human', name: msg.name, connected: true },
        }
      }
      break
    case 'snapshot':
      applySnapshot(msg.state)
      break
    case 'event':
      switch (msg.kind) {
        case 'seat_update':
          seats.value = msg.seats || {}
          break
        case 'bid_made':
          handleBidMade(msg)
          break
        case 'card_played':
          handleCardPlayed(msg)
          break
        case 'undo':
          // A per-viewer snapshot follows (undo can re-hide information);
          // just surface who rewound and wait for it.
          seq.value = typeof msg.seq === 'number' ? msg.seq : seq.value
          clearTrickLinger()
          undoBy.value = msg.by || ''
          if (undoTimer) clearTimeout(undoTimer)
          undoTimer = setTimeout(() => { undoBy.value = '' }, 4000)
          break
        default:
          break
      }
      break
    case 'error':
      showError(msg.msg || msg.code || 'Server rejected the request')
      break
    default:
      break
  }
}

// ── Public actions ─────────────────────────────────────────────────────

async function join({ sessionId, userId = null, guestName = null, bot = null }) {
  resetTableState()
  if (!unsubscribe) unsubscribe = socket.onMessage(handleMessage)
  return socket.connect({ sessionId, userId, guestName, bot })
}

function leave() {
  socket.disconnect()
  if (unsubscribe) { unsubscribe(); unsubscribe = null }
  resetTableState()
}

function sendBid(call) {
  if (!isYourBid.value) return { ok: false, reason: 'not your turn to bid' }
  const ok = socket.send({ t: 'bid', call: toServerCall(call) })
  return { ok, reason: ok ? '' : 'not connected' }
}

function sendCard(seat, suit, rank) {
  if (seat !== clickableSeat.value) {
    return { ok: false, reason: 'not your turn' }
  }
  // Client-side hint only — the server re-validates.
  const legal = legalCards.value.some(c => c.suit === suit && c.rank === rank)
  if (!legal) {
    showError('You must follow suit if you can.')
    return { ok: false, reason: 'illegal play' }
  }
  const ok = socket.send({ t: 'play', card: `${suit}${rank}` })
  return { ok, reason: ok ? '' : 'not connected' }
}

// Unlimited any-actor undo (Shark-style): rewind the last action.
function sendUndo() {
  if (seq.value === 0) return { ok: false, reason: 'nothing to undo' }
  const ok = socket.send({ t: 'undo', to_seq: seq.value - 1 })
  return { ok, reason: ok ? '' : 'not connected' }
}

function resetTableState() {
  tableId.value = null
  yourName.value = ''
  role.value = ''
  yourSeat.value = null
  botMode.value = ''
  seq.value = 0
  board.value = null
  phase.value = null
  auction.value = []
  contract.value = null
  nextToAct.value = null
  hands.value = { N: null, E: null, S: null, W: null }
  handCounts.value = { N: 0, E: 0, S: 0, W: 0 }
  currentTrick.leader = null
  currentTrick.plays = []
  clearTrickLinger()
  tricksTaken.value = { NS: 0, EW: 0 }
  seats.value = {}
  errorMessage.value = ''
  undoBy.value = ''
  dummyResyncRequested = false
}

// ── Exported reactive surface ──────────────────────────────────────────

export function useRemoteTable() {
  return {
    // connection (proxied from the socket layer)
    connectionStatus: socket.status,
    connectionError: socket.lastError,
    // identity
    tableId,
    yourName,
    role,
    yourSeat,
    botMode,
    // table state
    seq,
    board,
    boardNumber,
    dealer,
    vulnerable,
    phase,
    auction,
    contract,
    declarer,
    dummySeat,
    nextToAct,
    hands,
    handCounts,
    currentTrick,
    lastFinishedTrick,
    tricksTaken,
    seats,
    // derived
    hiddenSeats,
    clickableSeat,
    legalCards,
    isYourBid,
    lastSuitBid,
    canDouble,
    canRedouble,
    // feedback
    errorMessage,
    undoBy,
    // actions
    join,
    leave,
    sendBid,
    sendCard,
    sendUndo,
    // exposed for unit tests (message folding without a live socket)
    _handleMessage: handleMessage,
    _resetTableState: resetTableState,
  }
}

// useServerTable — the server-mode logic for the unified table shell
// (BiddingPracticeView). Extracted verbatim from the old TableView.vue so the
// one shell can render a live table-service seat/kibitz view driven by
// ServerEngine, while the solo path keeps its own (LocalEngine) setup. The
// PARENT still owns the socket lifecycle (join/identity/leave) via useRemoteTable;
// this only presents its reactive state + the seat actions.
//
// Everything the server template binds to is returned here (prefixed `server.`
// in the shell), so there are no name collisions with the solo bindings.

import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useDealSource } from './useDealSource.js'
import { useRemoteTable } from './useRemoteTable.js'
import { useServerEngine } from './engines/serverEngine.js'
import { SUIT_SYMBOLS } from '../utils/cardFormatting.js'

const SEAT_ORDER = ['N', 'E', 'S', 'W']
const SEAT_NAMES = { N: 'North', E: 'East', S: 'South', W: 'West' }

export function useServerTable() {
  // ?debug=1 (any value) on the route shows the diagnostics panel.
  const route = useRoute()
  const showDiagnostics = computed(() => route.query.debug !== undefined)

  // Deal-source picker (demo room only). "Deal source…" opens the picker;
  // "Next deal" repeats the sticky source.
  const dealModalOpen = ref(false)
  const dealSource = useDealSource()

  function onNextDeal() {
    const rotate =
      localStorage.getItem('bridgeTableRotateDeals') === '1' ? Math.floor(Math.random() * 4) : 0
    dealSource.nextDeal(rotate)
  }

  const table = useRemoteTable()

  const {
    connectionStatus,
    sessionId, tableId, yourSeat, yourSeats, myToken, roster,
    role, seeAll, isHost, botMode, boardMode,
    seq, boardNumber, dealer, vulnerable, phase,
    auction, contract, declarer, dummySeat,
    nextToAct, hands, handCounts,
    currentTrick, lastFinishedTrick, tricksTaken, seats,
    readySeats, boardComplete, sessionClosed,
    dealLoaded, setLabel, hasHumanSeat,
    clickableSeat, activeSeat,
    isYourBid, lastSuitBid, canDouble, canRedouble,
    errorMessage, undoBy,
  } = table

  // ── Double-dummy review overlay (via the TableEngine analysis hook) ─────
  // Computed client-side at board-complete (server has un-redacted all four
  // hands for review). Behind the engine interface — a future
  // server-computes-and-broadcast swap is contained to serverEngine.js.
  const engine = useServerEngine()
  const { capabilities } = engine

  const doubleDummy = ref(null)
  let ddToken = 0

  // Capture the full 13-card deal the moment it's dealt. The server now un-redacts
  // all hands, so the raw `hands` ref EMPTIES as cards are played — by board end
  // it's all-empty. Double-dummy must run on the captured deal, not the played-down
  // hands (otherwise the DD table comes up blank).
  const fullDeal = ref(null)
  function handTotal(h) {
    return h ? (h.spades?.length || 0) + (h.hearts?.length || 0) + (h.diamonds?.length || 0) + (h.clubs?.length || 0) : 0
  }
  watch(hands, (h) => {
    if (SEAT_ORDER.every(s => handTotal(h[s]) === 13)) {
      fullDeal.value = JSON.parse(JSON.stringify(h))
    }
  }, { deep: true, immediate: true })

  const ddFinalContract = computed(() =>
    contract.value?.text
      ? { contract: contract.value.text, declarer: declarer.value }
      : { contract: '', declarer: null })

  watch([() => phase.value, fullDeal], async ([ph, deal]) => {
    if (!(capabilities.doubleDummy && ph === 'complete' && deal)) {
      doubleDummy.value = null
      ddToken++
      return
    }
    if (doubleDummy.value) return
    const token = ++ddToken
    const dd = await engine.getDoubleDummy({ hands: deal, vulnerable: vulnerable.value })
    if (token === ddToken) doubleDummy.value = dd
  })

  // ── Teacher hand-visibility toggle ─────────────────────────────────────
  const SHOW_ALL_HANDS_KEY = 'bridgeTableShowAllHands'
  const showAllHands = ref(localStorage.getItem(SHOW_ALL_HANDS_KEY) !== '0')

  function toggleShowAllHands() {
    showAllHands.value = !showAllHands.value
    localStorage.setItem(SHOW_ALL_HANDS_KEY, showAllHands.value ? '1' : '0')
  }

  const canToggleHands = computed(() => seeAll.value || role.value === 'teacher')

  const dummyPublic = computed(() =>
    phase.value === 'play' &&
    (currentTrick.plays.length > 0 || tricksTaken.value.NS + tricksTaken.value.EW > 0))

  const canDeal = computed(() => tableId.value === 'demo' && !!yourSeat.value)

  // URL-supplied deal (?pbn=<single-board PBN>): applied once, when seated.
  let urlDealApplied = false
  watch([() => connectionStatus.value, () => yourSeat.value], () => {
    if (urlDealApplied || connectionStatus.value !== 'connected') return
    if (!canDeal.value) return
    const pbn = typeof route.query.pbn === 'string' ? route.query.pbn.trim() : ''
    if (!pbn) return
    urlDealApplied = true
    table.sendDeal({ source: 'pbn', pbn })
  })

  // Pre-deal (host table at Board 0) we still want the four seats on the table
  // so the host can invite/seat friends before picking a deal source. Feed
  // empty-suit placeholder hands so the compass renders the seat chips (with
  // their bot/host occupants) instead of collapsing to a bare "waiting" box.
  const EMPTY_HAND = () => ({ spades: [], hearts: [], diamonds: [], clubs: [] })
  const displayHands = computed(() =>
    dealLoaded.value
      ? hands.value
      : { N: EMPTY_HAND(), E: EMPTY_HAND(), S: EMPTY_HAND(), W: EMPTY_HAND() })
  const myTurnToBid = computed(() => dealLoaded.value && isYourBid.value)

  // Client-side redaction. The server now broadcasts ALL hands (redaction moved
  // here), so this is the SOLE gate on what a viewer sees — for every viewer, not
  // just teachers. Reveal everything when a host/teacher has "all hands" on, or at
  // board end (review). Otherwise reveal only the seats you occupy (multi-seat
  // Sit), dummy once it's public, and the declarer's hand when you're a human
  // dummy for a bot declarer. (Robust whether or not the server still redacts:
  // a seat with no cards is hidden regardless.)
  const displayHiddenSeats = computed(() => {
    // Pre-deal: nothing to hide — show every seat chip (empty placeholder hands)
    // so the host sees the full table (bots + self) and can seat friends.
    if (!dealLoaded.value) return []
    if ((canToggleHands.value && showAllHands.value) || phase.value === 'complete') {
      return []
    }
    const mine = yourSeats.value
    // Kibitzer (no seat) — watching, not playing: reveal ALL four hands.
    if (mine.length === 0) return []
    return SEAT_ORDER.filter(s => {
      if (!hands.value[s]) return true
      if (mine.includes(s)) return false
      if (s === dummySeat.value && dummyPublic.value) return false
      if (s === declarer.value && mine.includes(dummySeat.value) && dummyPublic.value) {
        return false
      }
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

  const tableTitle = computed(() => {
    const id = tableId.value
    if (!id) return 'Table'
    const m = id.match(/-t(\d+)$/)
    return m ? `Table ${m[1]}` : `Table ${id}`
  })

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

  const resultBanner = computed(() => {
    const r = boardComplete.value
    if (!r) return ''
    if (r.passedOut) return 'Passed out.'
    const c = r.contract
    if (!c) return ''
    if (r.bidOnly) {
      return `Contract: ${formatContract(c.text)} by ${c.declarer} — bid-only board, no play.`
    }
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

  function seatLabel(seat) {
    const occ = seats.value[seat]
    if (!occ || occ.kind === 'empty') return 'Bot'
    return occ.name || 'Player'
  }

  // The human occupant's name for a seat, or null for an empty/bot seat. Feeds
  // SeatIndicator (which shows its own 'Bot' emptyLabel + the name ladder).
  function occupantName(seat) {
    const occ = seats.value[seat]
    return occ && occ.kind === 'human' ? (occ.name || 'Player') : null
  }

  // Humans with no seat — the kibitz box (host can drag them onto seats).
  const kibitzers = computed(() =>
    (roster.value || []).filter(r => !r.seats || r.seats.length === 0))

  // Name for empty (bot) seats: bidding is always BBA; cardplay is the session's
  // bot backend. e.g. rules → "BBA+RulesBot".
  const botLabel = computed(() => {
    const cp = { random: 'Random', rules: 'RulesBot', ben: 'BEN' }[botMode.value]
    return cp ? `BBA+${cp}` : 'Bot'
  })

  // Per-seat occupant map for BridgeTable's over-the-board SeatIndicators:
  // humans carry a connection state (greens the badge); empty seats are bots.
  const seatOccupants = computed(() => {
    const out = {}
    for (const s of SEAT_ORDER) {
      const occ = seats.value[s]
      out[s] = occ && occ.kind === 'human'
        ? { name: occ.name || 'Player', connected: occ.connected !== false }
        : { name: botLabel.value }
    }
    return out
  })

  const turnLabel = computed(() => {
    const seat = nextToAct.value
    if (!seat) return ''
    return `${SEAT_NAMES[seat]} (${seatLabel(seat)})`
  })

  const botThinking = computed(() => {
    const seat = nextToAct.value
    if (!seat || phase.value === 'complete') return false
    const occ = seats.value[seat]
    return !occ || occ.kind === 'empty'
  })

  function onBid(call) { table.sendBid(call) }
  function onCardClick({ seat, suit, rank }) { table.sendCard(seat, suit, rank) }
  function onUndo() { table.sendUndo() }
  function onReady() { table.sendReady() }
  // Host paces a session table: jump to the next board without waiting on ready.
  function onHostNextDeal() { table.sendForceAdvance() }
  // Host-only seat management (seat-addressed): move / vacate / place-or-Sit.
  function onAssignSeat(args) { return table.sendAssignSeat(args) }
  // Show a host "Next deal" on a session table (the demo room uses onNextDeal /
  // canDeal instead). Available once a real deal is on the table.
  const canHostAdvance = computed(() => isHost.value && !!sessionId.value && dealLoaded.value)
  // Seat management is a SESSION operation (Session::assign_seat). Require a
  // real session, not just host role — the sessionless demo room (/#/table/demo)
  // reports is_host for a teacher ticket but can't fulfil assign_seat, so the
  // Sit/Remove menu + kibitz drop must stay hidden there. Host tables
  // (/#/tables/host) carry a sessionId, so they keep it.
  const canManageSeats = computed(() => isHost.value && !!sessionId.value)

  return {
    SEAT_ORDER,
    // state (from useRemoteTable)
    connectionStatus, sessionId, tableId, yourSeat, yourSeats, myToken, roster,
    activeSeat, role, seeAll, isHost, botMode, boardMode,
    seq, boardNumber, dealer, vulnerable, phase,
    auction, contract, declarer, dummySeat,
    nextToAct, hands, handCounts,
    currentTrick, lastFinishedTrick, tricksTaken, seats,
    readySeats, boardComplete, sessionClosed,
    dealLoaded, setLabel, clickableSeat, hasHumanSeat,
    canDouble, canRedouble, errorMessage, undoBy,
    // analysis
    capabilities, doubleDummy, ddFinalContract,
    // derived / display
    showDiagnostics, dealModalOpen, dealSource,
    showAllHands, canToggleHands, canDeal,
    displayHands, myTurnToBid, displayHiddenSeats,
    connectionLabel, tableTitle, contractHtml, declarerTricks,
    resultBanner, iAmReady, readyNames, turnLabel, botThinking,
    lastSuitBid,
    canHostAdvance, canManageSeats, seatOccupants, kibitzers,
    // actions
    onNextDeal, toggleShowAllHands, seatLabel, occupantName,
    onBid, onCardClick, onUndo, onReady, onHostNextDeal, onAssignSeat,
  }
}

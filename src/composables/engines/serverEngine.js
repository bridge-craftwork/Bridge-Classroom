// ServerEngine — the server-mode table engine (TableEngine impl over
// bridge-table-service). Real seats, invite, multi-human, server bots; plus the
// host-UI derivations the served shell binds (redaction, roster/kibitz, seat
// management, PassBot, ready/result, DD overlay).
//
// Stage C1 (unification): this absorbed the old `useServerTable` view adapter, so
// there is now ONE server object instead of a thin contract façade + a fat view
// layer. `BiddingPracticeView`'s server branch consumes it directly (as
// `server.*`); the `useTableEngine('server')` factory returns it as the
// contract impl. The PARENT still owns the socket lifecycle (join/identity/leave)
// via useRemoteTable — the `connect`/`leave` contract methods just forward to it.
//
// Everything the server template binds is returned here, namespaced so it can't
// collide with the solo (LocalEngine) bindings.

import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useDealSource } from '../useDealSource.js'
import { useRemoteTable } from '../useRemoteTable.js'
import { useTableSocket } from '../useTableSocket.js'
import { useDealSourceResolver } from '../useDealSourceResolver.js'
import { SUIT_SYMBOLS } from '../../utils/cardFormatting.js'
import { SERVER_CAPABILITIES } from './tableEngine.js'
import { fetchDoubleDummy } from '../../utils/ddsClient.js'
import { fetchAuction } from '../../utils/bbaClient.js'
import { bidderDivergence } from '../../utils/handAnalysis.js'

// Default convention card for the BBA reference auction on a shared table (no
// scenario context server-side) — mirrors LocalEngine's non-scenario default.
const DEFAULT_CARD = '21GF-DEFAULT'

const SEAT_ORDER = ['N', 'E', 'S', 'W']
const SEAT_NAMES = { N: 'North', E: 'East', S: 'South', W: 'West' }

export function useServerEngine() {
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
    passSides, botsPaused,
    boardComplete, sessionClosed,
    dealLoaded, setLabel, hasHumanSeat,
    clickableSeat, activeSeat,
    isYourBid, lastSuitBid, canDouble, canRedouble,
    errorMessage, undoBy,
  } = table

  const capabilities = SERVER_CAPABILITIES
  const socket = useTableSocket()
  const { materialize } = useDealSourceResolver()

  // ── Analysis hooks (TableEngine contract) ──────────────────────────────
  // Double-dummy + BBA reference auction are computed CLIENT-SIDE at
  // board-complete, when the server has un-redacted all four hands for review —
  // nothing to cheat with. A future server-computes-and-broadcast swap is
  // contained to this file.
  async function getDoubleDummy(deal) {
    try { return await fetchDoubleDummy(deal) } catch { return null }
  }
  async function getExpectedAuction(deal, { scenario = null, conventions = null, auctionPrefix = null } = {}) {
    try {
      const opts = { deal, auctionPrefix }
      if (conventions) opts.conventions = conventions
      else if (scenario) opts.scenario = scenario
      else opts.conventions = { ns: DEFAULT_CARD, ew: DEFAULT_CARD }
      return await fetchAuction(opts)
    } catch { return null }
  }
  // narrative needs authored server-side content — still local-only.
  async function getNarrative() { return null }

  // ── Double-dummy review overlay ────────────────────────────────────────
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
    const dd = await getDoubleDummy({ hands: deal, vulnerable: vulnerable.value })
    if (token === ddToken) doubleDummy.value = dd
  })

  // ── BBA "expected auction" comparison (per-viewer, your-seat divergence) ──
  // Mirrors the solo table's you-vs-BBA bidding feedback, computed CLIENT-SIDE at
  // review from the un-redacted deal (nothing to cheat with — the auction is
  // already locked). Two deliberate scoping choices:
  //   • PER-VIEWER preference (localStorage, sharing the solo table's key so the
  //     setting is one preference wherever there's an auction to compare); and
  //   • PER-SEAT diff — each client compares only ITS OWN seat's calls against
  //     the BBA reference, so a multi-human table shows each player just their
  //     own divergences. bidderDivergence + AuctionTable are both built around a
  //     single "You vs BBA" perspective, so a kibitzer (no seat) sees no overlay.
  const BBA_COMPARE_KEY = 'bp.cardplayShowBbaCompare'
  const showBbaCompare = ref(localStorage.getItem(BBA_COMPARE_KEY) !== '0')
  function toggleBbaCompare() {
    showBbaCompare.value = !showBbaCompare.value
    try { localStorage.setItem(BBA_COMPARE_KEY, showBbaCompare.value ? '1' : '0') } catch { /* private mode */ }
  }

  // The BBA reference auction for the current board, fetched once the auction is
  // settled (phase play/complete) and the full deal is captured. Tokened like the
  // DD overlay so a fast next-board can't land a stale reference; reset to null
  // whenever the board changes so the next settled auction refetches.
  const expectedAuction = ref(null)
  let bbaToken = 0
  const auctionSettled = computed(() => phase.value === 'play' || phase.value === 'complete')
  watch(() => boardNumber.value, () => { expectedAuction.value = null; bbaToken++ })
  watch([auctionSettled, fullDeal, showBbaCompare], async ([settled, deal, show]) => {
    if (!(capabilities.bbaExpectedAuction && settled && deal && show)) return
    if (expectedAuction.value) return
    const token = ++bbaToken
    // No scenario/conventions server-side — getExpectedAuction falls back to the
    // default convention card (same as the solo table's non-scenario sources).
    const res = await getExpectedAuction({ hands: deal, dealer: dealer.value, vulnerable: vulnerable.value })
    if (token === bbaToken) expectedAuction.value = res
  }, { immediate: true })

  // Per-seat divergence map for AuctionTable ({ idx: { user, bba } }), scoped to
  // YOUR seat and gated on the preference. bidderDivergence returns { actual, bba };
  // AuctionTable expects the acting side under `user` (labelled "You"), so remap.
  // Empty (no overlay) when off, unseated, or the reference isn't ready yet.
  const divergedBids = computed(() => {
    if (!showBbaCompare.value || !yourSeat.value) return {}
    const exp = expectedAuction.value
    if (!exp?.auction) return {}
    const diffs = bidderDivergence(auction.value, exp.auction, dealer.value, yourSeat.value)
    const out = {}
    for (const [idx, d] of Object.entries(diffs)) out[idx] = { user: d.actual, bba: d.bba }
    return out
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

  // Pre-deal (host table at Board 0) there are no hands; the compass still
  // renders the four seat chips from occupants via BridgeTable's `identityOnly`
  // mode (no cards, no "0 cards"), so the host can see who's seated and
  // invite/seat friends before picking a deal source.
  const displayHands = computed(() =>
    dealLoaded.value ? hands.value : { N: null, E: null, S: null, W: null })
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

  // Were cards actually played on this board? A bid-only board is COMPLETE the
  // moment the auction ends, with every trick count still zero — so anything
  // deriving a result, a trick total or a made/down figure has to ask this
  // first, or it reports a played-out board that never happened (roadmap
  // 2026-07-30 §2.1/§2.3; the "Down 9" family).
  //
  // board_complete.bidOnly is the authoritative answer once the event arrives.
  // boardMode covers the two cases where it hasn't: a board still in progress,
  // and a REJOIN — where the snapshot hands us phase 'complete' with no
  // board_complete event behind it.
  const boardPlayed = computed(() =>
    boardComplete.value ? !boardComplete.value.bidOnly : boardMode.value !== 'bid-only')

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

  function seatLabel(seat) {
    const occ = seats.value[seat]
    if (!occ || occ.kind === 'bot') return 'Bot'
    if (occ.kind === 'empty') return 'Open seat'
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

  // Name for a bot seat: <bidder>+<cardplay>. Cardplay is the session's bot
  // backend (rules → "RulesBot"); the bidder is BBA, or "Pass" when this seat's
  // SIDE is a PassBot side. e.g. E on a pass-EW table → "Pass+RulesBot".
  const cardplayBot = computed(() =>
    ({ random: 'Random', rules: 'RulesBot', ben: 'BEN' }[botMode.value] || null))
  function seatSide(seat) { return seat === 'N' || seat === 'S' ? 'NS' : 'EW' }
  function botLabelFor(seat) {
    const cp = cardplayBot.value
    if (!cp) return 'Bot'
    const bidder = (passSides.value || []).includes(seatSide(seat)) ? 'Pass' : 'BBA'
    return `${bidder}+${cp}`
  }

  // Per-seat occupant map for BridgeTable's over-the-board SeatIndicators:
  // - human → name + connection state (greens/greys the badge)
  // - bot   → the bot label ("BBA+RulesBot")
  // - empty → "Open seat" flagged empty (no bot; the table pauses on its turn)
  const seatOccupants = computed(() => {
    const out = {}
    for (const s of SEAT_ORDER) {
      const occ = seats.value[s]
      if (occ && occ.kind === 'human') {
        out[s] = { name: occ.name || 'Player', connected: occ.connected !== false }
      } else if (occ && occ.kind === 'reserved') {
        // Held for an invited friend until they join (Phase 4).
        out[s] = { name: occ.name || 'Invited', reserved: true }
      } else if (occ && occ.kind === 'empty') {
        out[s] = { name: 'Open seat', empty: true }
      } else {
        out[s] = { name: botLabelFor(s) }
      }
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
    // A bot is "thinking" only when the LOCAL human isn't the one to play. When
    // you're declarer playing from a bot-occupied DUMMY (or otherwise control the
    // on-turn seat), clickableSeat points at it and YOU play — not a bot. Without
    // this guard the centre showed "Bot thinking…" while it was actually the human
    // declarer's turn to play dummy, reading as a stuck hand (2026-07-14 report).
    if (clickableSeat.value) return false
    return seats.value[seat]?.kind === 'bot'
  })

  // An EMPTY (open) seat is on turn → the game is PAUSED here until the host
  // seats a player or a bot. Drives the "waiting for <seat>" affordance.
  const pausedSeat = computed(() => {
    const seat = nextToAct.value
    if (!seat || phase.value === 'complete') return null
    return seats.value[seat]?.kind === 'empty' ? seat : null
  })
  const pausedLabel = computed(() =>
    pausedSeat.value ? `${SEAT_NAMES[pausedSeat.value] || pausedSeat.value} is empty — seat a player or a bot` : '')

  // PassBot state + toggle (host, per side): passSides is ['NS'|'EW', ...].
  function onKick(token) { return table.sendKick(token) }
  function onSetPassSides(sides) { return table.sendPassSides(sides) }
  function togglePassSide(side) {
    const cur = new Set(passSides.value || [])
    if (cur.has(side)) cur.delete(side)
    else cur.add(side)
    return table.sendPassSides([...cur])
  }
  // Bots paused/running (host). While paused, Undo steps back one action.
  function onPauseBots(on) { return table.sendPauseBots(on) }

  function onBid(call) { table.sendBid(call) }
  function onCardClick({ seat, suit, rank }) { table.sendCard(seat, suit, rank) }
  function onUndo() { table.sendUndo() }
  // The host paces the table to the next board. Since ready-up was retired
  // (roadmap 2026-07-30 §1.1) this is the ONLY way a session table advances —
  // no per-seat gate is left that an idle-but-connected player could strand.
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

  // ── TableEngine contract methods ───────────────────────────────────────
  // The view drives the server table through the on*/derived surface above;
  // these are the canonical contract names the `useTableEngine('server')`
  // factory exposes (bid/play/…, lifecycle, analysis), so ServerEngine is a
  // complete TableEngine impl. The host app owns session create/resume; connect
  // just seats through the socket.
  const wantsCall = computed(() => !!isYourBid.value)
  const connect = table.join
  async function loadSource(selection) {
    const { boardsPbn, label } = await materialize(selection)
    return { ok: socket.send({ t: 'load_boards', boards_pbn: boardsPbn, label }) }
  }
  // Host-only on the served path — see onHostNextDeal.
  function nextBoard() { return table.sendForceAdvance() }
  const bid = table.sendBid
  const play = table.sendCard
  const undo = table.sendUndo
  function assignSeat(table_id, seat, sub) {
    return { ok: socket.send({ t: 'assign_seat', table: table_id, seat, sub }) }
  }
  function boot(table_id, seat) {
    return { ok: socket.send({ t: 'boot', table: table_id, seat }) }
  }

  return {
    SEAT_ORDER,
    // state (from useRemoteTable)
    connectionStatus, sessionId, tableId, yourSeat, yourSeats, myToken, roster,
    activeSeat, role, seeAll, isHost, botMode, boardMode,
    seq, boardNumber, dealer, vulnerable, phase,
    auction, contract, declarer, dummySeat,
    nextToAct, hands, handCounts,
    currentTrick, lastFinishedTrick, tricksTaken, seats,
    boardComplete, sessionClosed,
    dealLoaded, setLabel, clickableSeat, hasHumanSeat,
    canDouble, canRedouble, errorMessage, undoBy,
    // analysis
    capabilities, doubleDummy, ddFinalContract,
    expectedAuction, divergedBids, showBbaCompare, toggleBbaCompare,
    // derived / display
    showDiagnostics, dealModalOpen, dealSource,
    showAllHands, canToggleHands, canDeal,
    displayHands, myTurnToBid, displayHiddenSeats,
    connectionLabel, tableTitle, contractHtml, declarerTricks, boardPlayed,
    resultBanner, turnLabel, botThinking,
    pausedSeat, pausedLabel, passSides, botsPaused,
    lastSuitBid,
    canHostAdvance, canManageSeats, seatOccupants, kibitzers,
    // actions
    onNextDeal, toggleShowAllHands, seatLabel, occupantName,
    onBid, onCardClick, onUndo, onHostNextDeal, onAssignSeat,
    onKick, onSetPassSides, togglePassSide, onPauseBots,
    // TableEngine contract (canonical names for the useTableEngine factory)
    wantsCall, connect, leave: table.leave,
    loadSource, nextBoard, bid, play, undo, assignSeat, boot,
    getDoubleDummy, getExpectedAuction, getNarrative,
  }
}

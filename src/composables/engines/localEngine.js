// LocalEngine — the TableEngine backed by the in-browser machinery (see
// tableEngine.js). Rich solo analysis (double-dummy, BBA expected-auction +
// divergence, narrative), BBA-scripted bots, no seats/invite/multi-human.
//
// Owns the board manager: the deal source (selection + persistence + draw +
// PBN parse), the auction/board orchestration (currentDeal, bids, BBA expected
// auction, interactive divergence, double-dummy), AND cardplay (useCardPlay,
// exposed as `cardplay` + the unified `play()`/`startPlay()` actions). The view
// starts cardplay off `auctionComplete` and reads state via `engine.cardplay`.
//
// SEAT-AGNOSTIC: the human's seat is `config.yourSeat` (any of N/E/S/W), never
// assumed South. The "human is always South" restriction is being removed — the
// caller passes the seat; this engine only references `yourSeat`.
//
// Config: { yourSeat='S', embedded=false, embeddedCards=null, rotate=()=>false,
//           bidder=()=>'bba' }
//
// BIDDERS (C1/C2, rusty-bidding-bot's integration plan): `bidder()` names the
// engine that bids EVERY bot seat, read once per board (a change takes effect on
// the next board):
//   'bba'   — the bots replay BBA's predicted auction, re-requested from BBA on
//             divergence/toggle/undo (the behaviour this table always had).
//   'rusty' — the bots bid with Rusty (rbbClient → a Web Worker running
//             rusty-bidding-bot's WASM), one `auction` request per bot turn;
//             where Rusty has no rule, BBA's call for that seat, logged but not
//             shown (rustyBidder.js).
// Either way the REFERENCE the student is marked against is BBA's auction
// (Q2): `expectedAuction`, `divergedBids[i].bba`, `summary`, `referenceName`.
// On a Rusty table the reference is refreshed from BBA only when the actual
// auction has left BBA's line by the human's turn.
//
// Test seams (config): rbbClient, fetchAuction, fetchScenarioCards, fetchBbsa,
// logFallback, paceMs.
//
// CARDPLAY: the engine now owns the in-browser cardplay engine (useCardPlay, a
// module singleton) and exposes it as `cardplay` plus the unified `play()` /
// `startPlay()` actions. It resets cardplay itself on every new board / restart,
// so the view no longer injects an `onResetPlay` callback.

import { ref, computed } from 'vue'
import { LOCAL_CAPABILITIES, derivePhase, deriveWantsCall } from './tableEngine.js'
import { fetchAuction as bbaFetchAuction } from '../../utils/bbaClient.js'
import { getRbbClient, normalizeCall } from '../../utils/rbbClient.js'
import { prepareRustyBoard, runRustyBots, logRustyFallback } from './rustyBidder.js'
import { fetchDoubleDummy } from '../../utils/ddsClient.js'
import { fetchScenarioMeta, fetchScenarioCards as pbsScenarioCards } from '../../utils/pbsScenarios.js'
import { seatAtIndex, isAuctionOver, lastSuitBid } from '../../utils/handAnalysis.js'
import { nextBoard as resolverNextBoard, describeSelection, usePbnBoardNumbers } from '../useDealSourceResolver.js'
import { useHandAnalysis } from '../useHandAnalysis.js'
import { useCardPlay } from '../useCardPlay.js'
import { parsePbnDeals, makeDeal } from '../../utils/pbnDeal.js'

// Default convention card for non-scenario sources (Random/Paste/Library/Club).
const DEFAULT_CARD = '21GF-DEFAULT'

// The bidders a table can use, and their display names.
export const BIDDERS = Object.freeze({ bba: 'BBA', rusty: 'Rusty' })
// What the student's calls are compared with (Q2: BBA, whichever engine bids).
export const REFERENCE_NAME = 'BBA'
function normBidder(b) { return b === 'rusty' ? 'rusty' : 'bba' }
function sameCall(a, b) { return normalizeCall(a) === normalizeCall(b) }

const SELECTION_KEY = 'bp.selection'
function loadSelection() {
  try {
    const raw = localStorage.getItem(SELECTION_KEY)
    if (raw) {
      const s = JSON.parse(raw)
      if (s && Array.isArray(s.items)) return s
    }
  } catch { /* private mode etc. */ }
  return { items: [], options: {} }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

export function useLocalEngine(config = {}) {
  const yourSeat = ref(config.yourSeat || 'S') // seat-agnostic (South today)
  const embedded = !!config.embedded
  const embeddedCards = config.embeddedCards || null
  const rotate = typeof config.rotate === 'function' ? config.rotate : () => false
  const bidderSetting = typeof config.bidder === 'function' ? config.bidder : () => config.bidder || 'bba'
  const fetchAuction = config.fetchAuction || bbaFetchAuction
  const rbb = () => config.rbbClient || getRbbClient()
  const scenarioCardsOf = config.fetchScenarioCards || pbsScenarioCards
  const logFallback = config.logFallback || logRustyFallback
  const paceMs = config.paceMs ?? 300

  // The engine owns cardplay (singleton). A new board / auction reset clears it.
  const cardplay = useCardPlay()

  // ── Deal source ───────────────────────────────────────────────────────
  const selection = ref(loadSelection())
  let _persistTimer = null
  function persist() {
    try { localStorage.setItem(SELECTION_KEY, JSON.stringify(selection.value)) } catch { /* ignore */ }
  }
  const hasSelection = computed(() => (selection.value?.items?.length || 0) > 0)
  const sourceSummary = computed(() =>
    (selection.value?.items?.length || 0) > 1 ? describeSelection(selection.value) : '',
  )

  // ── Board + auction state ─────────────────────────────────────────────
  const currentDeal = ref(null)
  const dealsDrawn = ref(0)
  const currentScenario = ref('') // PBS scenario FILE (for BBA), '' = non-scenario
  const currentScenarioLabel = ref('')
  const dealError = ref('')
  const dealErrorHint = ref('')

  const expectedAuction = ref([])
  const originalExpectedAuction = ref([])
  const originalMeanings = ref([])
  const conventionsUsed = ref(null)
  // `meanings` is what the auction grid shows: BBA's on a BBA table, Rusty's
  // reading of every call on a Rusty table. `referenceMeanings` are BBA's, for
  // the reference line (and a fallback call's meaning).
  const meanings = ref([])
  const referenceMeanings = ref([])
  const bids = ref([])
  const divergedBids = ref({})
  const auctionLoading = ref(false)

  // The engine bidding this board's bot seats ('bba' | 'rusty'), fixed at load.
  const boardBidder = ref(normBidder(bidderSetting()))
  const bidderName = computed(() => BIDDERS[boardBidder.value])
  // Rusty: the prepared board, the calls BBA made in Rusty's place ({index:
  // meaning}), and every no-rule stop of the session (for bug reports).
  let rustyBoard = null
  let rustyFallbackMeanings = {}
  const rustyFallbacks = ref([])
  const rustyInfo = ref(null) // { rulesId, version, cards: {ns, ew} } of the current board
  let runGen = 0 // bumps on every load/rewind; a stale Rusty run stops

  // Contract + double-dummy overlay (engine-agnostic composable).
  const analysis = useHandAnalysis({ bids, dealer: () => currentDeal.value?.dealer })
  const { finalContract, doubleDummy, loadDoubleDummy } = analysis

  // Displayed board number, applying the shared numbering policy (mirrors the
  // materialize path for served tables, so solo/host/teacher agree): a single
  // fixed board-list source keeps the deal's own PBN number; a generator or a mix
  // uses the running session count (dealsDrawn), so the number increments in play
  // order instead of sitting fixed (generator) or bouncing (mixed files).
  // `dealsDrawn` counts NEW boards only — "Restart deal" is resetAuction, not a
  // redraw — so it is the right session incrementor.
  const boardNumber = computed(() => {
    if (!currentDeal.value) return null
    return usePbnBoardNumbers(selection.value)
      ? (currentDeal.value.boardNumber || dealsDrawn.value)
      : dealsDrawn.value
  })

  // ── Derived ───────────────────────────────────────────────────────────
  const auctionComplete = computed(() => currentDeal.value && isAuctionOver(bids.value))
  const currentSeat = computed(() =>
    currentDeal.value ? seatAtIndex(currentDeal.value.dealer, bids.value.length) : null,
  )
  // Canonical 3-state phase (the shared table-engine vocabulary). The
  // play↔review boundary is engine cardplay state; the "toggle on, auction
  // done, cardplay not yet started" transient the solo shell renders as
  // 'playing' coarsens to 'review' here for that one tick — which is why the
  // shell keeps its finer 5-state cardplayPhase (off/unsupported/playing/
  // complete) layered over this until Slice 6 collapses the branches.
  const phase = computed(() => derivePhase({
    auctionComplete: !!auctionComplete.value,
    cardplayActive: cardplay.isActive.value,
    cardplayComplete: cardplay.playComplete.value,
  }))
  // INERT this slice — no consumer until useTableSlots (Slice 6). Distinct from
  // any literal turn flag on purpose (see deriveWantsCall).
  const wantsCall = computed(() => deriveWantsCall({
    auctionComplete: !!auctionComplete.value,
    currentSeat: currentSeat.value,
    yourSeat: yourSeat.value,
  }))
  const lastNonPassNonDouble = computed(() => lastSuitBid(bids.value))
  const wrongIndicesArray = computed(() => Object.keys(divergedBids.value).map(Number))
  const hadDivergence = computed(() => Object.keys(divergedBids.value).length > 0)
  const summary = computed(() => {
    if (!auctionComplete.value) return ''
    const n = Object.keys(divergedBids.value).length
    if (n === 0) return `You matched the ${REFERENCE_NAME} all the way through.`
    return `${n} of your bids differed from the ${REFERENCE_NAME} — see the divergent cells above.`
  })
  const canDouble = computed(() => {
    const trailing = []
    for (let i = bids.value.length - 1; i >= 0; i--) {
      if (bids.value[i] === 'Pass') trailing.push('Pass')
      else { trailing.push(bids.value[i]); break }
    }
    const lastNonPass = trailing[trailing.length - 1]
    if (!lastNonPass || lastNonPass === 'Pass') return false
    if (lastNonPass === 'X' || lastNonPass === 'XX') return false
    return (trailing.length % 2) === 1
  })
  const canRedouble = computed(() => {
    const trailing = []
    for (let i = bids.value.length - 1; i >= 0; i--) {
      if (bids.value[i] === 'Pass') trailing.push('Pass')
      else { trailing.push(bids.value[i]); break }
    }
    const lastNonPass = trailing[trailing.length - 1]
    if (lastNonPass !== 'X') return false
    return (trailing.length % 2) === 1
  })

  // ── BBA client (scenario name, or default card for non-scenario sources) ─
  // Also the cards of BBA's fallback calls on a Rusty table (Q11): the scenario's
  // own (BBA resolves the name to its CC1/CC2), the embedded host's, or 21GF-DEFAULT.
  function generateAuction(deal, scenarioName, auctionPrefix = null) {
    const opts = { deal, auctionPrefix }
    if (embedded) opts.conventions = embeddedCards
    else if (scenarioName) opts.scenario = scenarioName
    else opts.conventions = { ns: DEFAULT_CARD, ew: DEFAULT_CARD }
    return fetchAuction(opts)
  }

  // Take a BBA auction as the reference (and, on a BBA table, as the meanings shown).
  // `prefixLen`: how many of its calls were given to BBA (forced), not predicted.
  let referencePrefixLen = 0
  function setReference(result, prefixLen = 0) {
    referencePrefixLen = prefixLen
    expectedAuction.value = result.auction
    referenceMeanings.value = result.meanings || []
    if (result.conventionsUsed) conventionsUsed.value = result.conventionsUsed
    if (boardBidder.value === 'bba') meanings.value = referenceMeanings.value
  }

  // Auto-bid the non-human seats up to the human's turn, from BBA's expected
  // auction. §C3: bail if the deal was swapped mid-pause.
  async function playToHumanTurn(dealRef = currentDeal.value) {
    if (boardBidder.value === 'rusty') return rustyToHumanTurn(dealRef)
    while (!isAuctionOver(bids.value) && bids.value.length < expectedAuction.value.length) {
      const seat = seatAtIndex(currentDeal.value.dealer, bids.value.length)
      if (seat === yourSeat.value) break
      const bid = expectedAuction.value[bids.value.length]
      await sleep(paceMs)
      if (currentDeal.value !== dealRef) return
      bids.value.push(bid)
    }
  }

  // ── Rusty ─────────────────────────────────────────────────────────────
  // The cards Rusty plays (names): the embedded host's, the scenario's CC1/CC2,
  // or DEFAULT_CARD both ways (decision 4: one card for both directions).
  async function rustyCardNames(scenarioName) {
    if (embedded && embeddedCards) return { ns: embeddedCards.ns, ew: embeddedCards.ew || embeddedCards.ns }
    if (scenarioName) {
      const cards = await scenarioCardsOf(scenarioName)
      if (cards?.ns) return { ns: cards.ns, ew: cards.ew || cards.ns }
      console.warn(`[rusty] no cards listed for scenario ${scenarioName}; playing ${DEFAULT_CARD}`)
    }
    return { ns: DEFAULT_CARD, ew: DEFAULT_CARD }
  }

  // Is the actual auction on a reference line, with BBA's next call predicted
  // (not one of the calls BBA was given as the prefix)?
  function onLine(auction, prefixLen) {
    const n = bids.value.length
    if (n < prefixLen || auction.length <= n) return false
    for (let i = 0; i < n; i++) if (!sameCall(bids.value[i], auction[i])) return false
    return true
  }
  function onReferenceLine() { return onLine(expectedAuction.value, referencePrefixLen) }

  // BBA's call for a bot seat Rusty has no rule for (decision 6). From the
  // reference when the auction is still on its line, else one BBA request from
  // this prefix — whose answer is also the reference from here on.
  async function bbaFallbackCall(prefix) {
    const idx = prefix.length
    if (onReferenceLine() && bids.value.length === idx) {
      return {
        call: expectedAuction.value[idx],
        meaning: referenceMeanings.value.find((m) => m.position === idx) || null,
      }
    }
    const result = await generateAuction(currentDeal.value, currentScenario.value, prefix)
    setReference(result, prefix.length)
    const call = result.auction[idx]
    return call ? { call, meaning: result.meanings?.find((m) => m.position === idx) || null } : null
  }

  // Refresh BBA's reference when the actual auction has left its line (Rusty's
  // calls differ from BBA's), so the human's next call is marked against what
  // BBA would call HERE. The only BBA request a Rusty table makes besides the
  // fallbacks. A failure leaves no reference for this call (nothing is marked).
  async function ensureReference(dealRef) {
    if (!currentDeal.value || isAuctionOver(bids.value) || onReferenceLine()) return
    // Back on BBA's original line (after an undo or toggle): no request needed.
    if (onLine(originalExpectedAuction.value, 0)) {
      setReference({ auction: originalExpectedAuction.value, meanings: originalMeanings.value }, 0)
      return
    }
    try {
      const prefix = bids.value.slice()
      const result = await generateAuction(dealRef, currentScenario.value, prefix)
      if (currentDeal.value !== dealRef) return
      setReference(result, prefix.length)
    } catch (err) {
      if (currentDeal.value !== dealRef) return
      console.warn('[rusty] BBA reference unavailable:', err.message)
      expectedAuction.value = []
    }
  }

  // Forget the fallback calls at or after `from` (the auction was rewound).
  function pruneFallbacks(from) {
    for (const k of Object.keys(rustyFallbackMeanings)) if (Number(k) >= from) delete rustyFallbackMeanings[k]
  }

  // Bid Rusty's seats (and BBA's fallbacks) until the human is to call or the
  // auction ends; then make sure the reference covers the human's call.
  async function rustyToHumanTurn(dealRef = currentDeal.value) {
    if (!rustyBoard || !dealRef) return
    const gen = ++runGen
    const isStale = () => gen !== runGen || currentDeal.value !== dealRef
    auctionLoading.value = true
    try {
      const res = await runRustyBots(rustyBoard, bids.value, {
        client: rbb(),
        bbaCall: bbaFallbackCall,
        isStale,
        fallbackMeanings: rustyFallbackMeanings,
        onMeanings: (m) => { meanings.value = m },
        onFallback: (record) => {
          rustyFallbacks.value = [...rustyFallbacks.value, record]
          logFallback(record)
        },
        onCall: async (call) => {
          if (paceMs > 0) await sleep(paceMs)
          if (isStale()) return false
          bids.value.push(call)
          return true
        },
      })
      if (res.stop === 'human_to_call' && !isStale()) await ensureReference(dealRef)
    } catch (err) {
      if (isStale()) return
      dealError.value = 'Rusty error: ' + err.message
    } finally {
      if (!isStale()) auctionLoading.value = false
    }
  }

  // Rotate a deal 180°: N↔S, E↔W. Dealer + vulnerability flip with the seats.
  function rotateDeal(deal) {
    return {
      ...deal,
      dealer: { N: 'S', S: 'N', E: 'W', W: 'E' }[deal.dealer] || deal.dealer,
      vulnerable: deal.vulnerable === 'NS' ? 'EW' : deal.vulnerable === 'EW' ? 'NS' : deal.vulnerable,
      hands: { N: deal.hands.S, S: deal.hands.N, E: deal.hands.W, W: deal.hands.E },
    }
  }

  // Load a deal into the auction flow: reset state, fetch DD + BBA expected
  // auction, and auto-bid to the human's turn. `scenario` names the PBS file
  // (for BBA); `label` is the display name. Staleness-guarded (latest wins).
  async function loadDeal(deal, { scenario = '', label = '' } = {}) {
    currentScenario.value = scenario
    currentScenarioLabel.value = label
    dealError.value = ''
    dealErrorHint.value = ''
    // 50% chance of 180° rotation when enabled — standalone only; embedded keeps
    // the deal's actual compass frame (the host's studentSeat/DD table assume it).
    if (!embedded && rotate() && Math.random() < 0.5) deal = rotateDeal(deal)
    runGen++
    currentDeal.value = deal
    dealsDrawn.value += 1
    bids.value = []
    divergedBids.value = {}
    expectedAuction.value = []
    meanings.value = []
    referenceMeanings.value = []
    auctionLoading.value = true
    cardplay.reset()
    boardBidder.value = normBidder(bidderSetting())
    rustyBoard = null
    rustyFallbackMeanings = {}
    rustyInfo.value = null

    const dealRef = currentDeal.value
    loadDoubleDummy(dealRef) // best-effort, latest-wins

    if (boardBidder.value === 'rusty') return loadRustyDeal(dealRef)

    try {
      const result = await generateAuction(dealRef, currentScenario.value)
      if (currentDeal.value !== dealRef) return // stale — a newer load took over
      setReference(result)
      originalExpectedAuction.value = result.auction
      originalMeanings.value = result.meanings || []
      await playToHumanTurn(dealRef)
    } catch (err) {
      if (currentDeal.value !== dealRef) return
      dealError.value = 'BBA error: ' + err.message
      if (err.message.includes('Failed to fetch') || err.message.includes('CORS')) {
        dealErrorHint.value = 'Likely a CORS issue — the BBA server must allow this origin.'
      }
    } finally {
      if (currentDeal.value === dealRef) auctionLoading.value = false
    }
  }

  // A Rusty board: BBA's reference and Rusty's engine in parallel, then Rusty
  // bids to the human's turn. A missing reference only disables the marking.
  async function loadRustyDeal(dealRef) {
    const refP = generateAuction(dealRef, currentScenario.value).then(
      (r) => r,
      (err) => { console.warn('[rusty] BBA reference unavailable:', err.message); return null },
    )
    try {
      const cardNames = await rustyCardNames(currentScenario.value)
      const board = await prepareRustyBoard({
        client: rbb(), deal: dealRef, humanSeats: [yourSeat.value], cardNames, fetchBbsa: config.fetchBbsa,
      })
      const ref = await refP
      if (currentDeal.value !== dealRef) return
      rustyBoard = board
      rustyInfo.value = { rulesId: board.rulesId, version: board.version, cards: board.cardNames }
      if (ref) {
        setReference(ref)
        originalExpectedAuction.value = ref.auction
        originalMeanings.value = ref.meanings || []
      } else {
        originalExpectedAuction.value = []
        originalMeanings.value = []
      }
      if (!conventionsUsed.value || !ref?.conventionsUsed) conventionsUsed.value = { ...board.cardNames }
    } catch (err) {
      if (currentDeal.value !== dealRef) return
      dealError.value = 'Rusty error: ' + err.message
      auctionLoading.value = false
      return
    }
    await rustyToHumanTurn(dealRef)
  }

  // Record a divergence from the reference at `idx`, if there is one.
  function markDivergence(idx, bid) {
    const expected = expectedAuction.value[idx]
    if (expected && !sameCall(bid, expected)) {
      divergedBids.value = { ...divergedBids.value, [idx]: { user: bid, bba: expected } }
      return true
    }
    return false
  }

  // A human bid. On divergence from BBA's expected bid, record both. A BBA table
  // re-requests from BBA with the new prefix so bots respond to this sequence; a
  // Rusty table just lets Rusty answer (nothing was predicted).
  async function onUserBid(bid) {
    if (!currentDeal.value) return
    const idx = bids.value.length
    if (boardBidder.value === 'rusty') {
      markDivergence(idx, bid)
      bids.value.push(bid)
      await rustyToHumanTurn()
      return
    }
    if (markDivergence(idx, bid)) {
      bids.value.push(bid)
      auctionLoading.value = true
      try {
        const result = await generateAuction(currentDeal.value, currentScenario.value, bids.value.slice())
        setReference(result, bids.value.length)
      } catch (err) {
        dealError.value = 'BBA error on divergence: ' + err.message
      } finally {
        auctionLoading.value = false
      }
    } else {
      bids.value.push(bid)
    }
    await playToHumanTurn()
  }

  // Flip which bid is "live" at a diverged index; re-request the continuation
  // (BBA table) or let Rusty bid on from there (Rusty table).
  async function toggleDivergedBid(idx) {
    if (auctionLoading.value) return
    const div = divergedBids.value[idx]
    if (!div) return
    const currentLive = bids.value[idx]
    const otherBid = currentLive === div.user ? div.bba : div.user
    bids.value = bids.value.slice(0, idx).concat([otherBid])
    const newDivs = {}
    for (const [k, v] of Object.entries(divergedBids.value)) {
      if (Number(k) <= idx) newDivs[k] = v
    }
    divergedBids.value = newDivs
    if (boardBidder.value === 'rusty') {
      pruneFallbacks(idx)
      await rustyToHumanTurn()
      return
    }
    auctionLoading.value = true
    try {
      const result = await generateAuction(currentDeal.value, currentScenario.value, bids.value.slice())
      setReference(result, bids.value.length)
      await playToHumanTurn()
    } catch (err) {
      dealError.value = 'BBA error on toggle: ' + err.message
    } finally {
      auctionLoading.value = false
    }
  }

  // Restart the current board's auction from BBA's original (no-prefix) line.
  async function resetAuction() {
    if (!currentDeal.value) return
    runGen++
    bids.value = []
    divergedBids.value = {}
    cardplay.reset()
    setReference({ auction: originalExpectedAuction.value, meanings: originalMeanings.value }, 0)
    if (boardBidder.value === 'rusty') {
      pruneFallbacks(0)
      auctionLoading.value = false
    } else {
      meanings.value = originalMeanings.value
    }
    await playToHumanTurn()
  }

  // Can the current human decision be undone — a card while playing, else a bid?
  const canUndo = computed(() => {
    if (auctionLoading.value) return false
    if (cardplay.isActive.value && cardplay.canUndo.value) return true
    if (!currentDeal.value) return false
    const dealer = currentDeal.value.dealer
    for (let i = bids.value.length - 1; i >= 0; i--) {
      if (seatAtIndex(dealer, i) === yourSeat.value) return true
    }
    return false
  })

  // Rewind the auction to just before the human's most recent bid (dropping the
  // bots' bids that followed) and restore BBA's expected continuation for that
  // prefix — otherwise the bot just re-bids the same thing. Then it's the human's
  // turn to re-bid. (Rusty table: no bidding request; the reference is refreshed
  // only if the prefix has left BBA's line.)
  async function undoLastBid() {
    if (!currentDeal.value || auctionLoading.value) return
    const dealer = currentDeal.value.dealer
    let idx = -1
    for (let i = bids.value.length - 1; i >= 0; i--) {
      if (seatAtIndex(dealer, i) === yourSeat.value) { idx = i; break }
    }
    if (idx < 0) return // no human bid to undo
    bids.value = bids.value.slice(0, idx)
    const keptDivs = {}
    for (const [k, v] of Object.entries(divergedBids.value)) {
      if (Number(k) < idx) keptDivs[k] = v
    }
    divergedBids.value = keptDivs
    auctionLoading.value = true
    if (boardBidder.value === 'rusty') {
      runGen++
      pruneFallbacks(idx)
      try { await ensureReference(currentDeal.value) } finally { auctionLoading.value = false }
      return
    }
    try {
      const result = await generateAuction(currentDeal.value, currentScenario.value, bids.value.slice())
      setReference(result, bids.value.length)
    } catch (err) {
      dealError.value = 'BBA error on undo: ' + err.message
    } finally {
      auctionLoading.value = false
    }
  }

  // Undo to the last human DECISION — a card if cardplay is underway, else a bid
  // — mirroring the server's "rewind to the last human action".
  async function undo() {
    if (cardplay.isActive.value && cardplay.canUndo.value) {
      cardplay.undo()
      return
    }
    await undoLastBid()
  }

  return {
    capabilities: LOCAL_CAPABILITIES,
    yourSeat,

    // ── Cardplay (engine-owned) ────────────────────────────────────────────
    // `cardplay` is the full useCardPlay surface (state + claim/stats/toggles)
    // the solo shell reads; `play()`/`startPlay()` are the unified engine actions
    // (the shell's card-click routes through engine.play, same as ServerEngine).
    cardplay,
    play(seat, suit, rank) { return cardplay.onUserCard(suit, rank) },
    startPlay(opts) { return cardplay.startPlay(opts) },

    // deal source
    selection,
    hasSelection,
    sourceSummary,
    parseDeal(dealString, opts) { return makeDeal(dealString, opts) },
    loadSource(sel) {
      selection.value = sel
      clearTimeout(_persistTimer)
      _persistTimer = setTimeout(persist, 0)
      return { ok: true }
    },
    async nextBoard() {
      if (!hasSelection.value) return { ok: false, reason: 'no deal source' }
      const drawn = await resolverNextBoard(selection.value)
      const deals = parsePbnDeals(drawn.pbn)
      if (!deals.length) return { ok: false, reason: 'drawn board could not be parsed' }
      const r = drawn.ref
      const scenarioFile = r && (r.kind === 'scenario' || r.kind === 'script') ? r.file : ''
      return { ok: true, deal: deals[0], scenarioFile, label: drawn.label || describeSelection(selection.value) || 'Deal' }
    },

    // board + auction state
    currentDeal,
    dealsDrawn,
    boardNumber,
    currentScenario,
    currentScenarioLabel,
    dealError,
    dealErrorHint,
    bids,
    expectedAuction,
    meanings,
    referenceMeanings,
    conventionsUsed,
    // bidder (C2): who bids the bot seats of this board, and the reference
    boardBidder,
    bidderName,
    referenceName: REFERENCE_NAME,
    rustyInfo,
    rustyFallbacks,
    divergedBids,
    auctionLoading,
    finalContract,
    doubleDummy,
    // derived
    auctionComplete,
    currentSeat,
    phase,
    wantsCall,
    lastNonPassNonDouble,
    wrongIndicesArray,
    hadDivergence,
    summary,
    canDouble,
    canRedouble,
    // derived (undo)
    canUndo,
    // actions
    loadDeal,
    onUserBid,
    toggleDivergedBid,
    resetAuction,
    undo,

    // ── Analysis hooks (also usable directly by other engines/views) ───────
    async getDoubleDummy(deal) {
      try { return await fetchDoubleDummy(deal) } catch { return null }
    },
    async getExpectedAuction(deal, { scenario = null, conventions = null, auctionPrefix = null } = {}) {
      try {
        const opts = { deal, auctionPrefix }
        if (conventions) opts.conventions = conventions
        else if (scenario) opts.scenario = scenario
        else opts.conventions = { ns: DEFAULT_CARD, ew: DEFAULT_CARD }
        return await fetchAuction(opts)
      } catch { return null }
    },
    async getNarrative(scenarioFile) {
      if (!scenarioFile) return null
      const meta = await fetchScenarioMeta(scenarioFile)
      return meta?.description ? { title: scenarioFile.replace(/_/g, ' ').trim(), text: meta.description } : null
    },

    // multiplayer — unsupported locally (capabilities say so)
    invite() { return null },
    assignSeat() { return { ok: false, reason: 'local table has no seats' } },
    boot() { return { ok: false, reason: 'local table has no seats' } },
    leave() {},
  }
}

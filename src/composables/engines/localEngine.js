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
// Config: { yourSeat='S', embedded=false, embeddedCards=null, rotate=()=>false }
//
// CARDPLAY: the engine now owns the in-browser cardplay engine (useCardPlay, a
// module singleton) and exposes it as `cardplay` plus the unified `play()` /
// `startPlay()` actions. It resets cardplay itself on every new board / restart,
// so the view no longer injects an `onResetPlay` callback.

import { ref, computed } from 'vue'
import { LOCAL_CAPABILITIES, derivePhase, deriveWantsCall } from './tableEngine.js'
import { fetchAuction } from '../../utils/bbaClient.js'
import { fetchDoubleDummy } from '../../utils/ddsClient.js'
import { fetchScenarioMeta } from '../../utils/pbsScenarios.js'
import { seatAtIndex, isAuctionOver, lastSuitBid } from '../../utils/handAnalysis.js'
import { nextBoard as resolverNextBoard, describeSelection } from '../useDealSourceResolver.js'
import { useHandAnalysis } from '../useHandAnalysis.js'
import { useCardPlay } from '../useCardPlay.js'
import { parsePbnDeals, makeDeal } from '../../utils/pbnDeal.js'

// Default convention card for non-scenario sources (Random/Paste/Library/Club).
const DEFAULT_CARD = '21GF-DEFAULT'

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
  const meanings = ref([])
  const bids = ref([])
  const divergedBids = ref({})
  const auctionLoading = ref(false)

  // Contract + double-dummy overlay (engine-agnostic composable).
  const analysis = useHandAnalysis({ bids, dealer: () => currentDeal.value?.dealer })
  const { finalContract, doubleDummy, loadDoubleDummy } = analysis

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
    if (n === 0) return 'You matched the BBA all the way through.'
    return `${n} of your bids differed from the BBA — see the divergent cells above.`
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
  function generateAuction(deal, scenarioName, auctionPrefix = null) {
    const opts = { deal, auctionPrefix }
    if (embedded) opts.conventions = embeddedCards
    else if (scenarioName) opts.scenario = scenarioName
    else opts.conventions = { ns: DEFAULT_CARD, ew: DEFAULT_CARD }
    return fetchAuction(opts)
  }

  // Auto-bid the non-human seats up to the human's turn, from BBA's expected
  // auction. §C3: bail if the deal was swapped mid-pause.
  async function playToHumanTurn(dealRef = currentDeal.value) {
    while (!isAuctionOver(bids.value) && bids.value.length < expectedAuction.value.length) {
      const seat = seatAtIndex(currentDeal.value.dealer, bids.value.length)
      if (seat === yourSeat.value) break
      const bid = expectedAuction.value[bids.value.length]
      await sleep(300)
      if (currentDeal.value !== dealRef) return
      bids.value.push(bid)
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
    currentDeal.value = deal
    dealsDrawn.value += 1
    bids.value = []
    divergedBids.value = {}
    expectedAuction.value = []
    auctionLoading.value = true
    cardplay.reset()

    const dealRef = currentDeal.value
    loadDoubleDummy(dealRef) // best-effort, latest-wins

    try {
      const result = await generateAuction(dealRef, currentScenario.value)
      if (currentDeal.value !== dealRef) return // stale — a newer load took over
      expectedAuction.value = result.auction
      originalExpectedAuction.value = result.auction
      conventionsUsed.value = result.conventionsUsed || null
      meanings.value = result.meanings || []
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

  // A human bid. On divergence from BBA's expected bid, record both and
  // re-request from BBA with the new prefix so bots respond to this sequence.
  async function onUserBid(bid) {
    if (!currentDeal.value) return
    const idx = bids.value.length
    const expected = expectedAuction.value[idx]
    if (expected && bid !== expected) {
      divergedBids.value = { ...divergedBids.value, [idx]: { user: bid, bba: expected } }
      bids.value.push(bid)
      auctionLoading.value = true
      try {
        const result = await generateAuction(currentDeal.value, currentScenario.value, bids.value.slice())
        expectedAuction.value = result.auction
        meanings.value = result.meanings || []
        if (result.conventionsUsed) conventionsUsed.value = result.conventionsUsed
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

  // Flip which bid is "live" at a diverged index; re-request the continuation.
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
    auctionLoading.value = true
    try {
      const result = await generateAuction(currentDeal.value, currentScenario.value, bids.value.slice())
      expectedAuction.value = result.auction
      meanings.value = result.meanings || []
      if (result.conventionsUsed) conventionsUsed.value = result.conventionsUsed
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
    bids.value = []
    divergedBids.value = {}
    cardplay.reset()
    expectedAuction.value = originalExpectedAuction.value
    meanings.value = originalMeanings.value
    await playToHumanTurn()
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
    currentScenario,
    currentScenarioLabel,
    dealError,
    dealErrorHint,
    bids,
    expectedAuction,
    meanings,
    conventionsUsed,
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
    // actions
    loadDeal,
    onUserBid,
    toggleDivergedBid,
    resetAuction,

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

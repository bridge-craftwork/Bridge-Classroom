// LocalEngine — the TableEngine backed by the in-browser machinery (see
// tableEngine.js). Rich solo analysis (double-dummy, BBA expected-auction +
// divergence, narrative), BBA-scripted bots, no seats/invite/multi-human.
//
// STATUS (foundation): the LOCAL-ONLY analysis hooks are implemented for real
// here — these are the beneficial features we want to surface through the
// interface. The shared game-flow (reactive board/auction/hands state + bid/
// play/nextBoard) still lives inside BiddingPracticeView.vue; extracting it into
// this engine is the next step (its `parsePBN` + `loadDeal` + `playToHumanTurn`
// + `useCardPlay` wiring + interactive divergence move here). Until then those
// fields/actions are placeholders so the contract is complete and the view
// refactor can proceed incrementally.
//
// SEAT-AGNOSTIC: `yourSeat` is a real ref (defaults to South today, but the
// "human is always South" restriction is being removed — do not hardcode it).

import { ref, computed, watch } from 'vue'
import { LOCAL_CAPABILITIES } from './tableEngine.js'
import { fetchDoubleDummy } from '../../utils/ddsClient.js'
import { fetchAuction } from '../../utils/bbaClient.js'
import { fetchScenarioMeta } from '../../utils/pbsScenarios.js'
import { nextBoard as resolverNextBoard, describeSelection } from '../useDealSourceResolver.js'
import { parsePbnDeals, makeDeal } from '../../utils/pbnDeal.js'

// Default convention card for non-scenario sources (Random/Paste/Library/Club).
const DEFAULT_CARD = '21GF-DEFAULT'

// The deal-source selection persists so a returning student keeps their pool.
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

export function useLocalEngine() {
  // ── Reactive game state — TODO: populate from the extracted local flow ────
  const yourSeat = ref('S') // seat-agnostic; South is only today's default

  // ── Deal source (the engine owns the source + draw + parse) ────────────
  const selection = ref(loadSelection())
  watch(selection, (s) => {
    try { localStorage.setItem(SELECTION_KEY, JSON.stringify(s)) } catch { /* ignore */ }
  }, { deep: true })
  const hasSelection = computed(() => (selection.value?.items?.length || 0) > 0)
  const sourceSummary = computed(() =>
    (selection.value?.items?.length || 0) > 1 ? describeSelection(selection.value) : '',
  )

  return {
    capabilities: LOCAL_CAPABILITIES,
    yourSeat,
    selection,
    hasSelection,
    sourceSummary,

    // Parse an explicit PBN deal string into a deal object (embedded ?pbn=).
    parseDeal(dealString, opts) { return makeDeal(dealString, opts) },

    // Set/replace the deal source (stream: one board drawn per nextBoard()).
    loadSource(sel) {
      selection.value = sel
      return { ok: true }
    },
    // Draw the next board from the current selection, parsed and attributed:
    //   { deal, scenarioFile, label }  — scenarioFile is '' for non-scenario
    //   sources (Random/Paste/Library/Club); the caller hands it to BBA.
    async nextBoard() {
      if (!hasSelection.value) return { ok: false, reason: 'no deal source' }
      const drawn = await resolverNextBoard(selection.value)
      const deals = parsePbnDeals(drawn.pbn)
      if (!deals.length) return { ok: false, reason: 'drawn board could not be parsed' }
      const r = drawn.ref
      const scenarioFile = r && (r.kind === 'scenario' || r.kind === 'script') ? r.file : ''
      return { ok: true, deal: deals[0], scenarioFile, label: drawn.label || describeSelection(selection.value) || 'Deal' }
    },

    // ── Analysis hooks — the local-only features, implemented for real ─────
    // Double-dummy trick table (bridgewebs solver; our own service later).
    async getDoubleDummy(deal) {
      try { return await fetchDoubleDummy(deal) } catch { return null }
    },
    // BBA "expected auction" to diff the human's bids against. `scenario` names
    // the convention system; falls back to the default card for non-scenario
    // sources. `auctionPrefix` re-requests a continuation (change-of-bid).
    async getExpectedAuction(deal, { scenario = null, conventions = null, auctionPrefix = null } = {}) {
      try {
        const opts = { deal, auctionPrefix }
        if (conventions) opts.conventions = conventions
        else if (scenario) opts.scenario = scenario
        else opts.conventions = { ns: DEFAULT_CARD, ew: DEFAULT_CARD }
        return await fetchAuction(opts)
      } catch { return null }
    },
    // Authored scenario narrative (.btn @chat), for the description popup.
    async getNarrative(scenarioFile) {
      if (!scenarioFile) return null
      const meta = await fetchScenarioMeta(scenarioFile)
      return meta?.description ? { title: scenarioFile.replace(/_/g, ' ').trim(), text: meta.description } : null
    },

    // ── Multiplayer — unsupported locally (capabilities say so) ────────────
    invite() { return null },
    assignSeat() { return { ok: false, reason: 'local table has no seats' } },
    boot() { return { ok: false, reason: 'local table has no seats' } },

    // ── Play actions — TODO: extract from BiddingPracticeView ──────────────
    bid() { return { ok: false, reason: 'not wired yet (extraction pending)' } },
    play() { return { ok: false, reason: 'not wired yet (extraction pending)' } },
    undo() { return { ok: false, reason: 'not wired yet (extraction pending)' } },
    ready() { return { ok: true } },
    leave() {},
  }
}

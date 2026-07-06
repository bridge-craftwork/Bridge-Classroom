// ServerEngine — the TableEngine backed by bridge-table-service (see
// tableEngine.js). Real seats, invite, multi-human, server bots; the analysis
// overlays (double-dummy, BBA divergence, narrative) are NOT server-side yet,
// so those capability flags are false and the hooks return null. The view gates
// on `capabilities` and stays resilient.
//
// It's a thin façade over the useRemoteTable + useTableSocket singletons — the
// same reactive state the TableView render layer already reads — so wrapping it
// doesn't fork any state.

import { useRemoteTable } from '../useRemoteTable.js'
import { useTableSocket } from '../useTableSocket.js'
import { useDealSourceResolver } from '../useDealSourceResolver.js'
import { SERVER_CAPABILITIES } from './tableEngine.js'
import { fetchDoubleDummy } from '../../utils/ddsClient.js'
import { fetchAuction } from '../../utils/bbaClient.js'

// Default convention card for the BBA reference auction on a shared table (no
// scenario context server-side) — mirrors LocalEngine's non-scenario default.
const DEFAULT_CARD = '21GF-DEFAULT'

export function useServerEngine() {
  const table = useRemoteTable()
  const socket = useTableSocket()
  const { materialize } = useDealSourceResolver()

  return {
    // Everything the render layer needs (seat-agnostic): yourSeat, seats,
    // dealer, vulnerable, phase, auction, contract, hands, currentTrick,
    // isYourBid, legalCards, clickableSeat, connectionStatus, sessionClosed, …
    ...table,

    capabilities: SERVER_CAPABILITIES,

    // ── Lifecycle ─────────────────────────────────────────────────────────
    // The host app owns session create/resume; the engine just connects. Pass
    // { sessionId, userId, asPlayer } — asPlayer seats the owner (host-as-player).
    connect: table.join,
    // leave() comes from `...table`.

    // ── Deal source (materialize the whole set onto the session) ───────────
    async loadSource(selection) {
      const { boardsPbn, label } = await materialize(selection)
      return { ok: socket.send({ t: 'load_boards', boards_pbn: boardsPbn, label }) }
    },
    // Advancing is player-ready on the server (the loaded set + lockstep host
    // pointer own board order); no per-player "draw one".
    nextBoard() {
      return { ok: table.sendReady(), reason: '' }
    },

    // ── Play actions (unified names over useRemoteTable's send*) ───────────
    bid: table.sendBid,
    play: table.sendCard,
    undo: table.sendUndo,
    ready: table.sendReady,

    // ── Analysis hooks ────────────────────────────────────────────────────
    // Double-dummy is computed CLIENT-SIDE from the revealed deal — the view
    // only calls this at board-complete, when the server has un-redacted all
    // four hands for review, so there's nothing to cheat with. The eventual
    // server-computes-once-and-broadcast optimization swaps this body out
    // (read from the snapshot instead of fetching) without touching the view.
    async getDoubleDummy(deal) {
      try { return await fetchDoubleDummy(deal) } catch { return null }
    },
    // BBA reference auction for the revealed deal — used at board-complete to
    // highlight divergence PER BIDDER (each client compares only its own seat's
    // calls, via bidderDivergence in handAnalysis.js). Computed client-side like
    // DD; scoping to yourSeat is what makes it meaningful on a shared table.
    // The render wires up when the merged shell drives ServerEngine.
    async getExpectedAuction(deal, { scenario = null, conventions = null, auctionPrefix = null } = {}) {
      try {
        const opts = { deal, auctionPrefix }
        if (conventions) opts.conventions = conventions
        else if (scenario) opts.scenario = scenario
        else opts.conventions = { ns: DEFAULT_CARD, ew: DEFAULT_CARD }
        return await fetchAuction(opts)
      } catch { return null }
    },
    // narrative needs authored server-side content — still local-only.
    async getNarrative() { return null },

    // ── Seats / invite (host app wires the specifics for now) ──────────────
    assignSeat(table_id, seat, sub) {
      return { ok: socket.send({ t: 'assign_seat', table: table_id, seat, sub }) }
    },
    boot(table_id, seat) {
      return { ok: socket.send({ t: 'boot', table: table_id, seat }) }
    },
  }
}

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

    // ── Analysis hooks — not server-side yet (capabilities say so) ─────────
    async getDoubleDummy() { return null },
    async getExpectedAuction() { return null },
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

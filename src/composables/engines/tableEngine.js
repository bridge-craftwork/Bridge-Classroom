// The Table Engine interface — the "board manager module" that a table view
// drives, with two implementations behind one contract:
//   • LocalEngine  — in-browser: BBA-scripted bots, client double-dummy + BBA
//                    divergence overlay, no seats/invite. Solo, snappy, offline.
//   • ServerEngine — the bridge-table-service: real seats, invite, multi-human,
//                    server bots; double-dummy overlay at board-complete
//                    (client-computed today), other analysis overlays local-only.
//
// A view consumes `engine.*` reactive state + actions, and reads
// `engine.capabilities` to show/hide features. The DIFF of the two capability
// sets is our backlog: what the server still needs to match local-only features
// (see capabilityGaps). Methods a given engine can't do resolve to a benign
// "unsupported" result — the view must be resilient to that (capability-gated
// UI + null-tolerant calls), so solo looks the same and the server table simply
// omits the local-only overlays until the service grows them.
//
// SEAT-AGNOSTIC BY DESIGN: the human's seat is `yourSeat` (any of N/E/S/W),
// never assumed South. The local app currently defaults the human to South, but
// that restriction is being removed — the interface must not encode it.

/**
 * What an engine can do. Drives feature gating in the view; the diff between two
 * engines' capabilities is the "make the server match local" backlog.
 * @typedef {Object} EngineCapabilities
 * @property {boolean} doubleDummy         Double-dummy trick table available.
 * @property {boolean} bbaExpectedAuction  A BBA "expected auction" to diff against.
 * @property {boolean} divergence          Highlight the human's bids vs the reference.
 * @property {boolean} narrative           Authored board narrative / scenario chat.
 * @property {boolean} seats               Real 4-seat model (vs "you + 3 bots").
 * @property {boolean} invite              Invite other humans to the table.
 * @property {boolean} multiHuman          More than one human can be seated.
 * @property {boolean} redaction           Server hides hands a seat shouldn't see.
 * @property {'rerequest'|'undo'} changeBid  How a taken bid is revised.
 * @property {'stream'|'materialize'} dealSource  Draw one board vs load a set.
 */

/** LocalEngine: rich solo analysis, no multiplayer. */
export const LOCAL_CAPABILITIES = Object.freeze({
  doubleDummy: true,
  bbaExpectedAuction: true,
  divergence: true,
  narrative: true,
  seats: false,
  invite: false,
  multiHuman: false,
  redaction: false,
  changeBid: 'rerequest',
  dealSource: 'stream',
})

/**
 * ServerEngine: real multiplayer. `doubleDummy` is available — computed
 * client-side at board-complete (the server un-redacts the full deal for
 * review, so no cheating), swappable to server-computes-once-and-broadcast
 * later WITHOUT touching the view. The remaining analysis overlays
 * (bbaExpectedAuction, divergence, narrative) are still local-only.
 */
export const SERVER_CAPABILITIES = Object.freeze({
  doubleDummy: true,
  bbaExpectedAuction: false,
  divergence: false,
  narrative: false,
  seats: true,
  invite: true,
  multiHuman: true,
  redaction: true,
  changeBid: 'undo',
  dealSource: 'materialize',
})

/**
 * The TableEngine contract. Reactive fields are Vue refs/computeds; actions
 * return `{ ok, reason }` or a value, and analysis hooks return `null` /
 * `{ unsupported: true }` when `capabilities` says the engine can't.
 *
 * Reactive state (seat-agnostic):
 *   capabilities   EngineCapabilities (static per engine)
 *   connectionStatus, sessionClosed, errorMessage
 *   yourSeat, seats, role
 *   dealer, vulnerable, boardNumber, setLabel, dealLoaded, boardComplete
 *   phase, auction, contract, declarer, dummySeat, nextToAct
 *   hands, handCounts, currentTrick, lastFinishedTrick, tricksTaken
 *   clickableSeat, legalCards, isYourBid, canDouble, canRedouble
 *
 * Actions:
 *   loadSource(selection)      set/replace the deal source (stream|materialize)
 *   nextBoard()                advance to the next board
 *   bid(call) / play(seat,suit,rank) / undo() / ready()
 *   leave()
 *
 * Analysis hooks (LocalEngine implements; ServerEngine → unsupported for now):
 *   getDoubleDummy(deal)       → ddtricks string | null
 *   getExpectedAuction(deal)   → { auction, meanings } | null   (BBA, for divergence)
 *   getNarrative(ref)          → { title, text } | null
 *
 * Seat/multiplayer (ServerEngine; LocalEngine → unsupported/degenerate):
 *   invite()                   → share URL | null
 *   assignSeat(seat, who) / boot(seat)
 *
 * @typedef {Object} TableEngine
 */

/**
 * Canonical table phase — the shared 3-state vocabulary both engines speak.
 *   bidding — auction in progress
 *   play    — tricks actively being played
 *   review  — auction done and not actively playing
 *
 * `review` deliberately COLLAPSES three terminal situations that the solo shell
 * has historically told apart (bidding-only deck with no cardplay, cardplay
 * unsupported for this deal, 13 tricks complete). They are one phase because
 * they are one thing: the deal is resolved. What a shell *reveals* in review is
 * a per-source decision — LocalEngine reveals all four hands + double-dummy,
 * matching every one of those old terminal states, so the collapse is
 * behavior-preserving; ServerEngine un-redacts server-side. That reveal choice
 * lives in the shell/capabilities, never in this enum.
 *
 * Pure (no Vue) so it's unit-testable and reusable by the fixture engine.
 */
export function derivePhase({ auctionComplete, cardplayActive, cardplayComplete }) {
  if (!auctionComplete) return 'bidding'
  if (cardplayActive && !cardplayComplete) return 'play'
  return 'review'
}

/**
 * `wantsCall` — "the experience wants a bid from you now." Kept DISTINCT from a
 * literal turn flag (`isYourBid`) on purpose: the coached track will map its
 * step-machine gate `hasBidPrompt → wantsCall`, so overloading turn logic would
 * break that retrofit. For a live auction (local/server) "wants your call" is
 * simply your-turn-and-still-bidding; a coached engine substitutes its own truth.
 */
export function deriveWantsCall({ auctionComplete, currentSeat, yourSeat }) {
  return !auctionComplete && currentSeat === yourSeat
}

/** Feature keys present in `a` but missing/false in `b` — the "b needs these". */
export function capabilityGaps(a, b) {
  const gaps = []
  for (const k of Object.keys(a)) {
    if (typeof a[k] === 'boolean' && a[k] && !b[k]) gaps.push(k)
  }
  return gaps
}

/**
 * Pick an engine implementation. `mode`: 'local' | 'server'. Kept as a lazy
 * factory so a view can start on one engine and (later, at a board boundary)
 * swap to the other — the D9 local→server upgrade — without either engine's
 * module loading until it's needed.
 */
export async function useTableEngine(mode) {
  if (mode === 'server') {
    const { useServerEngine } = await import('./serverEngine.js')
    return useServerEngine()
  }
  const { useLocalEngine } = await import('./localEngine.js')
  return useLocalEngine()
}

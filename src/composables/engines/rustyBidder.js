// The Rusty bidder's side of the solo practice table: the bot seats bid with
// rusty-bidding-bot's `auction` entry point (docs/WASM.md, "The solo-table
// loop"), and where Rusty has no rule the table takes BBA's call for that seat
// and carries on (Rick's decision 6: unflagged in the UI, but logged).
//
// Pure orchestration, no Vue: LocalEngine owns the auction and passes hooks.
// `auction` stops when a human is to call, so nothing is predicted and a
// divergence, toggle or undo needs no new bidding request.

import { logDiagnostic } from '../../utils/diagnostics.js'
import { cardSpecFor, handToRbb, meaningsFromSteps, normalizeCall, vulToRbb } from '../../utils/rbbClient.js'

const SEATS = ['N', 'E', 'S', 'W']
export const RUSTY_SCORING = 'MP' // as bbaClient.fetchAuction (BBA is always asked for MP)

/**
 * Everything the loop needs for one board: an engine for the card pair, the
 * bot seats (every seat but the humans') and their hands.
 *   cardNames: {ns, ew} card names (built in, or fetched from PBS as .bbsa)
 */
export async function prepareRustyBoard({ client, deal, humanSeats, cardNames, fetchBbsa }) {
  const info = await client.info()
  const [ns, ew] = await Promise.all([
    cardSpecFor(cardNames.ns, info.stock_cards, fetchBbsa),
    cardSpecFor(cardNames.ew, info.stock_cards, fetchBbsa),
  ])
  const engine = await client.engineFor({ ns, ew })
  const bots = SEATS.filter((s) => !humanSeats.includes(s))
  const hands = {}
  for (const s of bots) hands[s] = handToRbb(deal.hands[s])
  return {
    engine,
    rulesId: info.rules_id,
    version: info.version,
    cardNames: { ...cardNames },
    request: { engine, dealer: deal.dealer, vul: vulToRbb(deal.vulnerable), scoring: RUSTY_SCORING, bots, hands },
  }
}

/** Log one no-rule stop: the console and the app's diagnostics channel. */
export function logRustyFallback(record) {
  console.info('[rusty] no rule; BBA bid for', record.seat, 'at call', record.index, record)
  try {
    logDiagnostic('rusty_no_rule_fallback', JSON.stringify({
      rules_id: record.rules_id, cards: record.cards, dealer: record.dealer, vul: record.vul,
      scoring: record.scoring, seat: record.seat, index: record.index, auction: record.auction,
      call: record.call, bba_error: record.bbaError || null,
    }))
  } catch { /* logging must never break the table */ }
}

/**
 * Bid the bot seats from `calls` until a human is to call or the auction ends.
 *
 * hooks:
 *   client            rbbClient (auction)
 *   bbaCall(prefix, seat) → {call, meaning} | null   BBA's call at a no-rule stop
 *   onCall(call, {by, index, fallback}) → false to abort (stale); may await pacing
 *   onMeanings(meanings)       AuctionTable meanings for every call so far
 *   onFallback(record)         a no-rule stop and the call BBA made there
 *   isStale() → bool           a newer board/rewind took over
 *   fallbackMeanings           {index: BBA meaning} — the table's record of the
 *                              calls BBA made in Rusty's place (mutated here)
 *
 * Returns { stop: 'complete' | 'human_to_call' | 'stale', seat, contract, declarer }.
 * Rejects when the engine refuses a request (its diagnostics in the message).
 */
export async function runRustyBots(board, calls, hooks) {
  const { client, bbaCall, onCall, onMeanings = () => {}, onFallback = () => {}, isStale = () => false } = hooks
  const fallbackMeanings = hooks.fallbackMeanings || {}
  const auction = calls.slice()
  const stale = { stop: 'stale' }
  for (let guard = 0; guard < 80; guard++) {
    const r = await client.auction({ ...board.request, auction, no_rule: 'stop' })
    if (isStale()) return stale
    onMeanings(meaningsFromSteps(r.steps, fallbackMeanings))
    for (const c of r.calls) {
      const call = normalizeCall(c.call)
      if ((await onCall(call, { by: 'rusty', index: c.index })) === false || isStale()) return stale
      auction.push(call)
    }
    if (r.stop.reason !== 'no_rule') {
      return { stop: r.stop.reason, seat: r.stop.seat, contract: r.contract, declarer: r.declarer }
    }

    // No rule for this bot: BBA's call for the seat, from this prefix.
    const { dealer, vul, scoring } = board.request
    const record = {
      rules_id: r.rules_id, cards: r.cards, dealer, vul, scoring,
      seat: r.stop.seat, index: r.stop.index, auction: r.stop.auction.slice(),
      candidates: r.stop.candidates || null,
    }
    let fb = null
    try {
      fb = await bbaCall(r.stop.auction.slice(), r.stop.seat)
    } catch (err) {
      record.bbaError = String(err?.message || err) // BBA unreachable: Pass, the table goes on
    }
    if (isStale()) return stale
    const call = normalizeCall(fb?.call) || 'Pass'
    record.call = call
    onFallback(record)
    fallbackMeanings[r.stop.index] = fb?.meaning ? { ...fb.meaning } : { meaning: null }
    if ((await onCall(call, { by: 'bba', index: r.stop.index, fallback: true })) === false || isStale()) return stale
    auction.push(call)
  }
  throw new Error('Rusty: the auction did not finish')
}

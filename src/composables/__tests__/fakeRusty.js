// A scripted stand-in for rbbClient (the Rusty WASM in its worker), for tests.
// `script[i]` is the bot call at auction index i; 'NORULE' makes the bot at i
// stop with no rule (the table must take BBA's call there). Human indices are
// never read. Steps: a bot's call reads `Rusty: <call>`; a call the script did
// not make (a human's, or a fallback's) has no rule.

import { isAuctionOver, seatAtIndex } from '../../utils/handAnalysis.js'

export function makeFakeRusty(script, { rulesId = 'test-rules', stock = ['21GF-DEFAULT', '21GF-GIB'] } = {}) {
  const requests = []
  const client = {
    requests,
    info: async () => ({ ok: true, api: 1, version: '0.2.0', rules_id: rulesId, stock_cards: stock, diagnostics: [] }),
    engineFor: async (cards) => { requests.push({ fn: 'createEngine', cards }); return 7 },
    async auction(req) {
      requests.push({ fn: 'auction', req: JSON.parse(JSON.stringify(req)) })
      const a = req.auction.slice()
      const made = []
      const byBot = new Set()
      let stop
      for (;;) {
        if (isAuctionOver(a)) { stop = { reason: 'complete', seat: null, index: a.length, auction: a.slice() }; break }
        const seat = seatAtIndex(req.dealer, a.length)
        if (!req.bots.includes(seat)) { stop = { reason: 'human_to_call', seat, index: a.length, auction: a.slice() }; break }
        const c = script[a.length]
        if (c === 'NORULE' || c == null) {
          stop = { reason: 'no_rule', seat, index: a.length, auction: a.slice(), call: 'Pass', candidates: [] }
          break
        }
        made.push({ index: a.length, seat, call: c })
        byBot.add(a.length)
        a.push(c)
      }
      const steps = a.map((call, i) => {
        const ours = script[i] === call && script[i] !== 'NORULE' && (byBot.has(i) || i < req.auction.length)
        return {
          index: i, by: byBot.has(i) ? 'bot' : 'given', seat: seatAtIndex(req.dealer, i), call,
          explanation: ours ? `Rusty: ${call}` : null,
          alert: null, rule: ours ? { module: 'm', file: 'm.bid', line: i + 1 } : null,
          artificial: false, knowledge: { summary: ours ? `shown ${i}` : '' },
        }
      })
      return {
        ok: true, rules_id: rulesId, cards: { ns: '21GF-DEFAULT', ew: '21GF-DEFAULT' },
        calls: made, steps, stop, complete: stop.reason === 'complete', diagnostics: [],
      }
    },
  }
  return client
}

// A stub of bbaClient.fetchAuction: BBA's whole auction is `line`, whatever the
// prefix (its calls after the prefix), with a meaning per call.
export function makeFakeBba(line, { fail = false } = {}) {
  const requests = []
  async function fetchAuction(opts) {
    requests.push({ prefix: opts.auctionPrefix ? opts.auctionPrefix.slice() : null, scenario: opts.scenario || null, conventions: opts.conventions || null })
    if (fail) throw new Error('Failed to fetch')
    const prefix = opts.auctionPrefix || []
    const auction = prefix.concat(line.slice(prefix.length))
    return {
      auction,
      meanings: auction.map((bid, position) => ({ position, bid, meaning: `BBA: ${bid}` })),
      conventionsUsed: { ns: '21GF-DEFAULT', ew: '21GF-DEFAULT' },
    }
  }
  fetchAuction.requests = requests
  return fetchAuction
}

export const DEAL = {
  board: '1',
  dealer: 'N',
  vulnerable: 'None',
  hands: {
    N: { spades: ['A', 'K', '5', '2'], hearts: ['K', 'J', '7'], diamonds: ['Q', '9', '4'], clubs: ['K', '8', '3'] },
    E: { spades: ['Q', 'J', '3'], hearts: ['Q', '9', '5'], diamonds: ['K', 'J', '3'], clubs: ['Q', 'J', '7', '4'] },
    S: { spades: ['T', '6', '4'], hearts: ['A', 'T', '8', '3', '2'], diamonds: ['A', '2'], clubs: ['T', '6', '2'] },
    W: { spades: ['9', '8', '7'], hearts: ['6', '4'], diamonds: ['T', '8', '7', '6', '5'], clubs: ['A', '9', '5'] },
  },
}

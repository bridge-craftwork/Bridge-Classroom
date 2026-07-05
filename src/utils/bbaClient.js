// BBA (Bridge Bidding Analyzer) auction client. Given a deal and a system
// (a named scenario OR an explicit convention-card pair), returns the auction
// BBA bids, plus per-call meanings. Sibling of benClient.js / dealerClient.js.
//
// Used two ways: to drive the bots' bids on the LOCAL practice table, and as
// the "expected auction" the student's bids are diffed against. On the server
// table the bots bid server-side, but the front-end analysis overlay can still
// call this to compute a post-hoc BBA comparison — so it lives here, shared.

import { handsToPbnString } from './handAnalysis.js'

const DEFAULT_BBA_URL = 'https://bba.harmonicsystems.com'

export function getBbaUrl() {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BBA_URL) {
    return import.meta.env.VITE_BBA_URL
  }
  return DEFAULT_BBA_URL
}

// opts:
//   deal:         { hands:{N,E,S,W→{spades,...}}, dealer, vulnerable }
//   scenario:     PBS scenario name (selects BBA's system)   — OR —
//   conventions:  { ns, ew } explicit convention-card ids
//   auctionPrefix: optional string[] of leading calls BBA must continue from
// Returns { auction: string[], meanings: string[], conventionsUsed }.
export async function fetchAuction({ deal, scenario, conventions, auctionPrefix } = {}) {
  const vul = deal.vulnerable === 'All' ? 'Both' : deal.vulnerable
  const body = {
    deal: {
      pbn: 'N:' + handsToPbnString(deal.hands),
      dealer: deal.dealer,
      vulnerability: vul,
      scoring: 'MP',
    },
  }
  if (conventions) body.conventions = conventions
  else if (scenario) body.scenario = scenario
  if (auctionPrefix && auctionPrefix.length > 0) body.auctionPrefix = auctionPrefix

  const resp = await fetch(getBbaUrl() + '/api/auction/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    let err = `HTTP ${resp.status}`
    try { const j = await resp.json(); if (j.error) err = j.error } catch { /* keep HTTP status */ }
    throw new Error(err)
  }
  const j = await resp.json()
  if (!j.success) throw new Error(j.error || 'BBA returned success=false')
  return {
    auction: j.auction,
    meanings: j.meanings || [],
    conventionsUsed: j.conventionsUsed || null,
  }
}

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

// Identifies classroom traffic in BBA's audit log and dashboard (issue #414).
// Format is `ext=<name>; browser=<name>; os=<name>`, parsed by bba-server's
// get_client_info(); unknown keys are ignored and every key is optional.
function detectBrowser(ua) {
  if (/Edg\//.test(ua)) return 'Edge'
  if (/Firefox\//.test(ua)) return 'Firefox'
  if (/Chrome\//.test(ua)) return 'Chrome'
  if (/Safari\//.test(ua)) return 'Safari'
  return 'Other'
}

function detectOs(ua) {
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS'
  if (/Android/.test(ua)) return 'Android'
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS'
  if (/Windows/.test(ua)) return 'Windows'
  if (/CrOS/.test(ua)) return 'ChromeOS'
  if (/Linux/.test(ua)) return 'Linux'
  return 'Other'
}

export function clientInfoHeaders() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : ''
  const headers = {
    'X-Client-Info': `ext=BridgeClassroom; browser=${detectBrowser(ua)}; os=${detectOs(ua)}`,
  }
  if (typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__) {
    headers['X-Client-Version'] = String(__APP_VERSION__)
  }
  return headers
}

// opts:
//   deal:         { hands:{N,E,S,W→{spades,...}}, dealer, vulnerable }
//   scenario:     PBS scenario name (selects BBA's system)   — OR —
//   conventions:  { ns, ew } explicit convention-card ids
//   conventionContent: optional { ns?, ew? } .bbsa text bid instead of the
//                 named card for that side (a user's own card; the name is then
//                 its label). Needs bba-server 2.2+, which lists those sides in
//                 `customCards`; an older one ignores the text, so its answer
//                 is refused rather than passed off as the user's card.
//   auctionPrefix: optional string[] of leading calls BBA must continue from
// Returns { auction: string[], meanings: string[], conventionsUsed }.
export async function fetchAuction({ deal, scenario, conventions, conventionContent, auctionPrefix } = {}) {
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
  const customSides = Object.keys(conventionContent || {}).filter((s) => conventionContent[s])
  if (customSides.length) body.conventionContent = conventionContent
  if (auctionPrefix && auctionPrefix.length > 0) body.auctionPrefix = auctionPrefix

  const resp = await fetch(getBbaUrl() + '/api/auction/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...clientInfoHeaders() },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    let err = `HTTP ${resp.status}`
    try { const j = await resp.json(); if (j.error) err = j.error } catch { /* keep HTTP status */ }
    throw new Error(err)
  }
  const j = await resp.json()
  if (!j.success) throw new Error(j.error || 'BBA returned success=false')
  if (customSides.some((s) => !(j.customCards || []).includes(s))) {
    throw new Error("this BBA server can't bid with your own convention card yet")
  }
  return {
    auction: j.auction,
    meanings: j.meanings || [],
    conventionsUsed: j.conventionsUsed || null,
  }
}

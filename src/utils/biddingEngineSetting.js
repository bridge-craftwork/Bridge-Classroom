// The solo table's bidding-engine setting (C2): which engine bids every bot
// seat — BBA (the default) or Rusty, rusty-bidding-bot's rule-based engine.
// Persisted like the other `bp.*` table settings (localStorage), so a changed
// choice is remembered across reloads and sessions (Rick's decision 1).
//
// `?bidder=bba|rusty` overrides it for one page load without being saved (for
// testing). Embedded (iframe) tables ignore the saved choice: they bid with BBA
// unless the host passes `bidder`.

import { RBB_WASM_INFO } from './rbbClient.js'

export const BIDDING_ENGINE_KEY = 'bp.biddingEngine'
export const BIDDING_ENGINES = ['bba', 'rusty']
export const DEFAULT_BIDDING_ENGINE = 'bba'

function valid(v) {
  const s = String(v || '').trim().toLowerCase()
  return BIDDING_ENGINES.includes(s) ? s : null
}

/** `bidder` from the page URL (query before or inside the hash), or null. */
export function readBidderParam(loc = globalThis.location) {
  if (!loc) return null
  let qs = (loc.search || '').replace(/^\?/, '')
  const hash = loc.hash || ''
  const q = hash.indexOf('?')
  if (q !== -1) qs = qs ? `${qs}&${hash.slice(q + 1)}` : hash.slice(q + 1)
  return valid(new URLSearchParams(qs).get('bidder'))
}

function defaultStorage() {
  try { return globalThis.localStorage || null } catch { return null }
}

/** The engine to use: the URL override, else (not embedded) the saved choice, else BBA. */
export function loadBiddingEngine({ storage = defaultStorage(), embedded = false, param = readBidderParam() } = {}) {
  if (param) return param
  if (embedded) return DEFAULT_BIDDING_ENGINE
  let saved = null
  try { saved = storage?.getItem(BIDDING_ENGINE_KEY) } catch { /* private mode etc. */ }
  return valid(saved) || DEFAULT_BIDDING_ENGINE
}

/** Remember a choice (ignored when invalid or storage is unavailable). */
export function saveBiddingEngine(value, storage = defaultStorage()) {
  const v = valid(value)
  if (!v) return
  try { storage?.setItem(BIDDING_ENGINE_KEY, v) } catch { /* ignore */ }
}

/**
 * Can this build bid with Rusty? The installed package must have the
 * `auction` entry point (rusty-bidding-bot v0.2.0+; v0.1.0-rc1 does not).
 */
export function rustyAvailable(info = RBB_WASM_INFO) {
  return !!info?.supports_auction
}

// Pure, engine-agnostic hand-analysis helpers — no Vue, no network.
// Shared by the local practice table and (later) the server single-table host
// view so the "what's the contract / double-dummy" overlay is one codebase.

export const SEAT_ORDER = ['N', 'E', 'S', 'W']

export function seatAtIndex(dealer, idx) {
  return SEAT_ORDER[(SEAT_ORDER.indexOf(dealer) + idx) % 4]
}

// A bridge auction (array of calls like '1S','Pass','X','XX') is over once
// three passes follow at least one bid, or all four players pass out.
export function isAuctionOver(arr) {
  if (arr.length < 4) return false
  const last3 = arr.slice(-3)
  if (last3.every(b => b === 'Pass')) {
    const hasBid = arr.slice(0, -3).some(b => b !== 'Pass')
    if (hasBid) return true
    if (arr.length === 4 && arr.every(b => b === 'Pass')) return true
  }
  return false
}

// Per-bidder divergence: compare ONE seat's actual calls against a BBA reference
// auction, returning { [index]: { actual, bba } } for that seat's positions where
// they differ. Used to highlight only the bidder's OWN bids on a shared table —
// each client passes its own seat, so a multi-human table shows each player just
// their own divergences. Read-only (post-hoc): unlike the interactive local flow
// it doesn't re-request BBA per turn, so `expected` should already be a per-turn-
// consistent reference for the deal (the caller decides how to source it).
// Only indices present in BOTH auctions are compared (length mismatch ≠ divergence).

// One call, one spelling. Notrump has TWO live spellings in this codebase and they
// meet here: PBN and the table-service wire protocol say `1N`, while BiddingBox and
// BBA both say `1NT`. Comparing those raw made every NT bid on a SERVED table read
// as a divergence — the auction grid showed "● YOU 1NT" over "○ BBA 1NT" struck
// through, two identical calls flagged as a disagreement (report #52, verified
// 2026-07-30 against the live BBA service, which returns "7NT").
//
// Solo never hit it because BiddingBox and BBA already agree; only the served path
// mixes vocabularies. Normalising HERE rather than at the one call site means a
// future caller can't reintroduce it — the same reasoning as deriveStatus's
// `played`. Canonical form is the spoken one, `1NT`.
export function normalizeCall(call) {
  return typeof call === 'string' ? call.replace(/^([1-7])N$/, '$1NT') : call
}

export function bidderDivergence(actual, expected, dealer, seat) {
  const out = {}
  const n = Math.min(actual?.length || 0, expected?.length || 0)
  for (let i = 0; i < n; i++) {
    if (seatAtIndex(dealer, i) !== seat) continue
    // Compare normalised; REPORT the caller's own spellings, so the overlay keeps
    // rendering whatever vocabulary that surface already uses.
    if (normalizeCall(actual[i]) !== normalizeCall(expected[i])) {
      out[i] = { actual: actual[i], bba: expected[i] }
    }
  }
  return out
}

/**
 * The first of `seat`'s calls that disagrees with the reference and isn't already
 * recorded — the per-call counterpart to `bidderDivergence`'s wholesale sweep.
 *
 * Why one at a time rather than all of them: a from-scratch BBA reference is only
 * positionally meaningful UP TO AND INCLUDING the first divergence. Once you bid
 * something BBA didn't, every later reference call assumes BBA's line rather than
 * the auction that actually happened, so comparing them to your real calls invents
 * disagreements. The caller records this one, re-requests the reference with the
 * ACTUAL auction as the prefix, and asks again — which is exactly what the solo
 * table has always done in `onUserBid`.
 *
 * @param {string[]} actual    calls made so far
 * @param {string[]} expected  BBA's reference auction
 * @param {string} dealer
 * @param {string} seat        the viewer's own seat
 * @param {object} known       divergences already recorded, keyed by index
 * @returns {{idx:number,user:string,bba:string}|null}
 */
export function firstNewDivergence(actual, expected, dealer, seat, known = {}) {
  const n = Math.min(actual?.length || 0, expected?.length || 0)
  for (let i = 0; i < n; i++) {
    if (seatAtIndex(dealer, i) !== seat) continue
    if (Object.prototype.hasOwnProperty.call(known, i)) continue
    if (normalizeCall(actual[i]) !== normalizeCall(expected[i])) {
      return { idx: i, user: actual[i], bba: expected[i] }
    }
  }
  return null
}

// The last actual suit/NT bid (ignoring Pass/X/XX).
export function lastSuitBid(arr) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== 'Pass' && arr[i] !== 'X' && arr[i] !== 'XX') return arr[i]
  }
  return null
}

// Resolve a completed auction to its contract + declarer (declarer = first of
// the winning side to name the final strain). Returns null if not over.
export function determineContract(arr, dealer) {
  if (!isAuctionOver(arr)) return null
  if (arr.every(b => b === 'Pass')) return { contract: 'Pass', declarer: null }
  const last = lastSuitBid(arr)
  if (!last) return { contract: 'Pass', declarer: null }
  let dbl = ''
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] === 'XX') { dbl = 'XX'; break }
    if (arr[i] === 'X') { dbl = 'X'; break }
    if (arr[i] !== 'Pass') break
  }
  const strain = last.replace(/^\d/, '')
  const lastIdx = arr.lastIndexOf(last)
  const lastSeat = seatAtIndex(dealer, lastIdx)
  const winningSide = (lastSeat === 'N' || lastSeat === 'S') ? ['N', 'S'] : ['E', 'W']
  for (let i = 0; i < arr.length; i++) {
    const b = arr[i]
    if (b === 'Pass' || b === 'X' || b === 'XX') continue
    const bStrain = b.replace(/^\d/, '')
    const seat = seatAtIndex(dealer, i)
    if (bStrain === strain && winningSide.includes(seat)) {
      return { contract: last + dbl, declarer: seat }
    }
  }
  return { contract: last + dbl, declarer: lastSeat }
}

// { N:{spades,hearts,diamonds,clubs}, ... } → "N-hand E-hand S-hand W-hand"
// PBN hand string (space-separated, N first), for the BBA/DDS deal payloads.
export function handsToPbnString(hands) {
  return SEAT_ORDER.map(seat => {
    const h = hands[seat]
    return [h.spades, h.hearts, h.diamonds, h.clubs].map(arr => arr.join('')).join('.')
  }).join(' ')
}

// One cell of the bridgewebs double-dummy `ddtricks` string. It packs the
// 20 seat×strain trick counts as base-ish chars ('0'-'9' then 'a'/'A'..='d'/'D'
// for 10-13); seatIdx over [N,S,E,W], suitIdx over [S,H,D,C,NT].
export function ddTrickAt(ddtricks, seatIdx, suitIdx) {
  const ch = ddtricks[seatIdx * 5 + suitIdx]
  if (ch >= '0' && ch <= '9') return parseInt(ch, 10)
  if (ch >= 'a' && ch <= 'd') return 10 + ch.charCodeAt(0) - 'a'.charCodeAt(0)
  if (ch >= 'A' && ch <= 'D') return 10 + ch.charCodeAt(0) - 'A'.charCodeAt(0)
  return 0
}

// Whether a `ddtricks` payload can actually produce a table: 20 seat×strain cells.
//
// Exported because the SHELL has to ask the same question the component does. A grid
// corner is occupied iff its role is configured AND the shell provided the slot — so a
// shell that gates on `!!ddtricks` while DoubleDummyTable renders on `buildDdRows`
// reserves a corner for a table that never appears. Same predicate, one export, and
// the two can't drift.
//
// The length check is not pedantry: `ddTrickAt` returns 0 for any character it can't
// read, so a truncated or empty payload renders a full grid of confident zeros — a
// table saying every contract makes nothing. No table is the honest rendering.
export function hasDdTricks(ddtricks) {
  return !!ddtricks && ddtricks.length >= 20
}

// Build the DD display grid (rows N,S,E,W × cols ♣♦♥♠ NT), marking the cell
// that matches the final contract's declarer+strain so the UI can highlight it.
export function buildDdRows(ddtricks, finalContract) {
  if (!hasDdTricks(ddtricks)) return null
  const seats = ['N', 'S', 'E', 'W']
  const colSuitIdx = [4, 3, 2, 1, 0] // display order ♣ ♦ ♥ ♠ NT
  const colStrain = ['C', 'D', 'H', 'S', 'NT']
  const fc = finalContract
  const declarerIdx = fc && fc.declarer ? seats.indexOf(fc.declarer) : -1
  let contractStrainIdx = -1
  if (fc && fc.contract && fc.contract !== 'Pass') {
    const m = fc.contract.match(/^\d([CDHSN]T?)(X{0,2})$/)
    if (m) {
      const strain = m[1] === 'N' ? 'NT' : m[1]
      contractStrainIdx = colStrain.indexOf(strain)
    }
  }
  return seats.map((seat, si) => ({
    seat,
    cells: colSuitIdx.map((j, ci) => ({
      tricks: ddTrickAt(ddtricks, si, j),
      isContract: si === declarerIdx && ci === contractStrainIdx,
    })),
  }))
}

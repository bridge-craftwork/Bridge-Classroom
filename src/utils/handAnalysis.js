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
export function bidderDivergence(actual, expected, dealer, seat) {
  const out = {}
  const n = Math.min(actual?.length || 0, expected?.length || 0)
  for (let i = 0; i < n; i++) {
    if (seatAtIndex(dealer, i) !== seat) continue
    if (actual[i] !== expected[i]) out[i] = { actual: actual[i], bba: expected[i] }
  }
  return out
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

// Build the DD display grid (rows N,S,E,W × cols ♣♦♥♠ NT), marking the cell
// that matches the final contract's declarer+strain so the UI can highlight it.
export function buildDdRows(ddtricks, finalContract) {
  if (!ddtricks) return null
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

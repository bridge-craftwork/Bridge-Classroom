// boardSnapshot — the deal and auction a bug report is about, in one app-blind shape
// (#531). Any shell can put it in its report context as `context.board`; the issue
// body renders it (bug_reports.rs), so a report can be reproduced without reading
// hands off the screenshot. All four hands are recorded even when the student saw
// one: the report is for whoever fixes the bug, not the student.
//
//   {
//     deal: 'N:AKQ2.… E … S … W …'   PBN deal (a missing hand is '-')
//     dealer, vulnerable, scoring, board, source,
//     auction: '1H P 2NT P …'          one line, as typed into a PBN/rbb command
//     calls: [{ index, seat, call, by, meaning, rule, ruleRef, alert, announce, artificial }],
//     contract, declarer,
//   }
//
// `by` names who made each call: 'student', 'rusty', 'bba', or 'bba-fallback' (BBA's
// call where Rusty had no rule). Engine-specific forensics (Rusty's rules id, the
// cards) stay in the shell's own block; this is only what every app shares.

const SEATS = ['N', 'E', 'S', 'W']
const SUITS = ['spades', 'hearts', 'diamonds', 'clubs']

function seatAt(dealer, index) {
  const d = SEATS.indexOf(dealer)
  return SEATS[((d < 0 ? 0 : d) + index) % 4]
}

/** One hand as PBN ('AKQ2.T98.…'), or '-' when unknown. */
function handPbn(hand) {
  if (!hand) return '-'
  const suits = SUITS.map((s) => hand[s])
  if (suits.some((cards) => !Array.isArray(cards))) return '-'
  return suits.map((cards) => cards.map((c) => (c === '10' ? 'T' : String(c))).join('')).join('.')
}

/** `{ N: {spades:[…],…}, … }` → 'N:… … … …' (N first, clockwise). */
export function dealToPbn(hands) {
  if (!hands) return null
  if (!SEATS.some((s) => hands[s])) return null
  return 'N:' + SEATS.map((s) => handPbn(hands[s])).join(' ')
}

const shortCall = (c) => (c === 'Pass' ? 'P' : c)

// Rusty names a rule as { module, file, line }; written 'file:line' it is what you
// open in rusty-bidding-bot. A string passes through.
function ruleText(ref) {
  if (!ref) return null
  if (typeof ref === 'string') return ref
  if (ref.file) return ref.line != null ? `${ref.file}:${ref.line}` : ref.file
  return ref.module || null
}

function whoBid(seat, index, { humanSeats, bidder, fallbackIndices }) {
  if (humanSeats.includes(seat)) return 'student'
  if (bidder === 'rusty') return fallbackIndices.includes(index) ? 'bba-fallback' : 'rusty'
  return bidder || null
}

/**
 * @param {object} o
 * @param {object} o.hands            { N: {spades,hearts,diamonds,clubs}, … }
 * @param {string} o.dealer           'N' | 'E' | 'S' | 'W'
 * @param {string} [o.vulnerable]
 * @param {string} [o.scoring]
 * @param {number} [o.board]          displayed board number
 * @param {string} [o.source]         scenario / lesson the deal came from
 * @param {string[]} [o.bids]         the calls so far, in order
 * @param {object[]} [o.meanings]     AuctionTable meanings ({ position, meaning, ruleRef, … })
 * @param {string[]} [o.humanSeats]   seats a person is bidding
 * @param {string} [o.bidder]         engine bidding the other seats ('rusty' | 'bba' | …)
 * @param {number[]} [o.fallbackIndices]  calls BBA made where Rusty had no rule
 * @param {string} [o.contract]
 * @param {string} [o.declarer]
 */
export function buildBoardSnapshot({
  hands, dealer, vulnerable = null, scoring = null, board = null, source = null,
  bids = [], meanings = [], humanSeats = [], bidder = null, fallbackIndices = [],
  contract = null, declarer = null,
} = {}) {
  const byIndex = new Map()
  for (const m of meanings || []) if (m && Number.isInteger(m.position)) byIndex.set(m.position, m)
  const calls = (bids || []).map((call, index) => {
    const seat = seatAt(dealer, index)
    const m = byIndex.get(index) || null
    return {
      index,
      seat,
      call,
      by: whoBid(seat, index, { humanSeats, bidder, fallbackIndices }),
      meaning: m?.meaning ?? null,
      rule: ruleText(m?.ruleRef),
      ruleRef: m?.ruleRef ?? null,
      alert: m?.alertText ?? (m?.isAlert ? (m.meaning ?? null) : null),
      announce: m?.announce ?? null,
      artificial: m?.artificial ?? null,
    }
  })
  return {
    deal: dealToPbn(hands),
    dealer: dealer || null,
    vulnerable,
    scoring,
    board,
    source,
    auction: (bids || []).map(shortCall).join(' '),
    calls,
    contract,
    declarer,
  }
}

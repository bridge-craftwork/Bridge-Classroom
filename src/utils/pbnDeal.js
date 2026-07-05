// PBN → deal objects in the shape the local table's render + engine consume:
//   { board, dealer, vulnerable, hands, pbn }
// where `hands` is { N:{spades,hearts,diamonds,clubs}, E:…, S:…, W:… } (the
// HandDisplay shape). Pure, no Vue — moved out of BiddingPracticeView so the
// LocalEngine (board manager) and the embedded ?pbn= path share one parser.

import { SEAT_ORDER } from './handAnalysis.js'

// HandDisplay expects { spades:[], hearts:[], diamonds:[], clubs:[] } per seat.
// `deal` is a PBN deal string like "N:AK.. .. .. ..".
export function parseDealHands(deal) {
  const m = String(deal || '').match(/^([NESW]):(.+)$/)
  if (!m) return null
  const startIdx = SEAT_ORDER.indexOf(m[1])
  const hands = m[2].trim().split(/\s+/)
  if (hands.length !== 4) return null
  const result = {}
  for (let i = 0; i < 4; i++) {
    const seat = SEAT_ORDER[(startIdx + i) % 4]
    const suits = hands[i].split('.')
    if (suits.length !== 4) return null
    result[seat] = {
      spades: [...suits[0]],
      hearts: [...suits[1]],
      diamonds: [...suits[2]],
      clubs: [...suits[3]],
    }
  }
  return result
}

// A single deal object from one PBN deal string (dealer/vul optional).
export function makeDeal(dealString, { board = '?', dealer = 'N', vulnerable = 'None' } = {}) {
  const hands = parseDealHands(dealString)
  if (!hands) return null
  return { board, dealer, vulnerable, hands, pbn: dealString }
}

// Parse a (possibly multi-board) PBN text into deal objects.
export function parsePbnDeals(text) {
  const deals = []
  const tagRe = /\[(\w+)\s+"([^"]*)"\]/g
  for (const block of String(text || '').split(/\n\s*\n/)) {
    const tags = {}
    let m
    tagRe.lastIndex = 0
    while ((m = tagRe.exec(block)) !== null) tags[m[1]] = m[2]
    if (!tags.Deal) continue
    const deal = makeDeal(tags.Deal, {
      board: tags.Board || '?',
      dealer: tags.Dealer || 'N',
      vulnerable: tags.Vulnerable || 'None',
    })
    if (deal) deals.push(deal)
  }
  return deals
}

// Pure helpers for the defensive-signals trick composition (a1 grid-flip, 2026-07-12).
// A step-based cardplay lesson (defence / signals) shows played cards via the PBN
// `[showcards]` directive rather than the declarer-play engine. Without help the grid
// treats those played-card-only seats (E/S) as full 7-card-reserve hands, floors the whole
// table, and scatters them as tiny label-less seats. Instead the grid renders their cards
// as a CENTRE trick (matching the signed-off cardplay-exercise) and hides those seats.
// These pure functions build the trick + identify the seats from the showcards maps.

const SUIT = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' }
const SEATS = ['N', 'E', 'S', 'W']

/** Parse a card code ('S7', 'ST') → { suit, rank }, or null on a bad code. */
export function parseCardCode(code) {
  if (typeof code !== 'string' || code.length < 2) return null
  const suit = SUIT[code[0].toUpperCase()]
  return suit ? { suit, rank: code.slice(1).toUpperCase() } : null
}

/**
 * Build a TrickArea `currentTrick` ({ plays: [{seat, suit, rank}] }) from a showcards map
 * ({ W: ['SK'], E: ['S7'], … }) — one play per seat (its most-recently shown card, i.e.
 * the card it played to the current trick). Seats with no valid card are omitted.
 */
export function buildTrickFromShowcards(showcards) {
  const plays = []
  for (const seat of SEATS) {
    const cards = showcards?.[seat]
    if (!Array.isArray(cards) || !cards.length) continue
    const c = parseCardCode(cards[cards.length - 1])
    if (c) plays.push({ seat, suit: c.suit, rank: c.rank })
  }
  return { plays }
}

/**
 * The played-card-ONLY seats: shown via showcards but NOT fully revealed — their entire
 * visible "hand" is the played card (E/S in a defence scene). = the showcards seats minus
 * the fully-shown seats (whose played card is struck within their full hand, tracked by
 * `showcardsPlayedCards`). These are the seats the grid hides and moves into the trick.
 */
export function playedCardOnlySeats(currentShowcards, showcardsPlayedCards) {
  if (!currentShowcards || typeof currentShowcards !== 'object') return []
  const fully = new Set(Object.keys(showcardsPlayedCards || {}))
  return Object.keys(currentShowcards).filter((s) => !fully.has(s))
}

import { fetchOpeningLead, fetchBotCard } from './benClient.js'

// Pluggable cardplay bots.
//
// Bot interface (all async to keep stub-vs-BEN interchangeable):
//   {
//     name: string,                       // for telemetry / UI
//     async chooseOpeningLead(ctx) → { suit, rank }
//     async chooseCard(ctx) → { suit, rank }
//   }
//
// Context object passed to both methods:
//   {
//     hand,            // { spades, hearts, diamonds, clubs }: original 13-card hand for the playing seat
//     dummy,           // same shape, dummy's original hand (chooseCard only; absent for opening lead)
//     seat,            // 'N'|'E'|'S'|'W' — seat physically playing
//     declarer,        // 'N'|'E'|'S'|'W'
//     dealer,          // 'N'|'E'|'S'|'W'
//     contract,        // e.g. '4S', '3NT', '2HX'
//     bids,            // [...] auction bids
//     vulnerable,      // 'None'|'NS'|'EW'|'All'
//     played,          // [{seat, suit, rank}, ...] chronological, all seats (chooseCard only)
//     currentTrick,    // { leader, plays: [...] } (chooseCard only)
//     legalCards,      // [{suit, rank}, ...] — pre-filtered legal subset of remaining
//                      // (for chooseOpeningLead: all 13 cards in hand)
//   }
//
// Bots SHOULD return a card from `legalCards`. Engine validates and will throw
// if a bot returns an illegal card.

// ── RandomLegalBot ─────────────────────────────────────────────────────
//
// Picks uniformly from the legal set. Synchronous in practice; returns a
// resolved Promise to match the async interface. Useful as the default during
// development so the UI ships before BEN is wired in.

export const RandomLegalBot = {
  name: 'random',

  async chooseOpeningLead(ctx) {
    return pickRandom(ctx.legalCards)
  },

  async chooseCard(ctx) {
    return pickRandom(ctx.legalCards)
  },
}

function pickRandom(arr) {
  if (!arr || arr.length === 0) {
    throw new Error('RandomLegalBot: legalCards empty — engine should never call a bot with no legal moves')
  }
  return arr[Math.floor(Math.random() * arr.length)]
}

// ── BenBot ─────────────────────────────────────────────────────────────
//
// BEN-backed bot. Wraps benClient's HTTP API. Slow (~10s per call) and
// gated on the BEN service + CORS being reachable from the browser. When
// CORS isn't deployed yet, calls throw and the engine surfaces the error
// via botError; the user can switch back to the random bot from the
// dropdown.

export const BenBot = {
  name: 'ben',

  async chooseOpeningLead(ctx) {
    const { card } = await fetchOpeningLead({
      hand: ctx.hand,
      seat: ctx.seat,
      dealer: ctx.dealer,
      vul: ctx.vulnerable,  // benClient encodes to BEN's @v/@V format
      ctx: ctx.bids,
    })
    return parseCardCode(card)
  },

  async chooseCard(ctx) {
    const { card } = await fetchBotCard({
      hand: ctx.hand,                    // engine already passes decision-maker's hand
      dummy: ctx.dummy,
      seat: ctx.decisionMakerSeat,       // BEN expects decision-maker, not physical seat
      dealer: ctx.dealer,
      vul: ctx.vulnerable,
      ctx: ctx.bids,
      played: ctx.played,
    })
    return parseCardCode(card)
  },
}

// "S7" / "HK" / "TC" → { suit, rank }
function parseCardCode(code) {
  if (!code || code.length < 2) throw new Error(`BenBot: bad card code "${code}"`)
  return { suit: code[0], rank: code.slice(1) }
}

// ── BotRegistry ────────────────────────────────────────────────────────
// Central place to look up a bot by name.

const BOTS = {
  random: RandomLegalBot,
  ben: BenBot,
}

export function registerBot(name, bot) {
  BOTS[name] = bot
}

export function getBot(name) {
  const bot = BOTS[name]
  if (!bot) throw new Error(`getBot: unknown bot "${name}". Available: ${Object.keys(BOTS).join(', ')}`)
  return bot
}

export function listBots() {
  return Object.keys(BOTS)
}

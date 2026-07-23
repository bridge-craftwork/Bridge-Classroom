import { fetchOpeningLead, fetchBotCard, fetchClaimValidation } from './benClient.js'

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

// ── ReplayBot ──────────────────────────────────────────────────────────
//
// Plays a pre-recorded line (the [Play] table shipped with declarer-play
// coaching boards). Built per-deal from the parser's `bySeat` queues. Used to
// drive the two defenders in a classroom declarer lesson deterministically —
// no live solver, no network — so the hand plays the teaching line every time.
//
// It counts how many cards the seat has already played (from ctx.played) rather
// than counting calls, so it stays aligned even when the engine auto-plays a
// forced single-legal card without consulting the bot. If the student deviates
// from the model line (misplays declarer), a recorded card can become illegal;
// we then fall back to a legal card so play degrades gracefully instead of
// throwing.
export function makeReplayBot(bySeat) {
  const q = {
    N: [...(bySeat?.N || [])],
    E: [...(bySeat?.E || [])],
    S: [...(bySeat?.S || [])],
    W: [...(bySeat?.W || [])],
  }
  function nextFor(seat, played, legalCards) {
    const count = (played || []).filter(p => p.seat === seat).length
    const code = q[seat] && q[seat][count]
    if (code) {
      const card = { suit: code[0], rank: code.slice(1) }
      if (legalCards.some(c => c.suit === card.suit && c.rank === card.rank)) return card
    }
    return legalCards[0]
  }
  return {
    name: 'replay',
    async chooseOpeningLead(ctx) {
      return nextFor(ctx.seat, [], ctx.legalCards)
    },
    async chooseCard(ctx) {
      return nextFor(ctx.seat, ctx.played, ctx.legalCards)
    },
  }
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

  // Optional validation hook called by the engine before committing a claim.
  // Returns { accepted: bool, message: string } so the UI can either commit
  // silently or surface BEN's rejection + an override button.
  async validateClaim(ctx) {
    return await fetchClaimValidation({
      tricks: ctx.tricks,
      hand: ctx.declarerHand,
      dummy: ctx.dummyHand,
      seat: ctx.declarer,
      dealer: ctx.dealer,
      vul: ctx.vulnerable,
      ctx: ctx.bids,
      played: ctx.played,
    })
  },
}

// "S7" / "HK" / "TC" → { suit, rank }
function parseCardCode(code) {
  if (!code || code.length < 2) throw new Error(`BenBot: bad card code "${code}"`)
  return { suit: code[0], rank: code.slice(1) }
}

// ── RulesBot ───────────────────────────────────────────────────────────
// The deterministic rule-based cardplay bot (bridge-rulebot), compiled to wasm
// (src/vendor/bridge-rulebot-wasm) and run entirely IN THE BROWSER — no service,
// no server resources. Same core the table-service uses server-side, so solo and
// shared tables share one implementation.
//
// Resilient by construction: the rulebot only ever returns a card from the
// engine-supplied `legalCards`, and on ANY failure (wasm init, malformed
// context, empty legal set upstream) it degrades to a legal card rather than
// breaking the hand — mirroring its server-side role as the always-available
// fallback.

const SUIT_KEY = { spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' }

// Lazy, once. `initRuleBot()` fetches + instantiates the wasm on first use so
// the blob isn't loaded unless someone actually picks RulesBot.
let ruleBotReady = null
async function ensureRuleBot() {
  if (!ruleBotReady) {
    ruleBotReady = import('../vendor/bridge-rulebot-wasm/bridge_rulebot_wasm.js').then(
      async (m) => {
        await m.default() // instantiate the wasm module
        return m
      }
    )
  }
  return ruleBotReady
}

// { spades:[...], ... } → [{ suit:'S', rank:'A' }, ...]; normalize a "10" rank.
function handObjToCards(hand) {
  const out = []
  if (!hand) return out
  for (const key of Object.keys(SUIT_KEY)) {
    for (const rank of hand[key] || []) {
      out.push({ suit: SUIT_KEY[key], rank: rank === '10' ? 'T' : rank })
    }
  }
  return out
}

// The bot ctx's `bids` may be call strings or objects; the rulebot wants PBN
// strings ("1S", "Pass", "X"). Normalize defensively — a bid we can't read is
// dropped, and the worst case is the opening-lead "partner's suit" rule simply
// not firing (every other rule and the fallbacks are auction-independent).
function bidsToPbn(bids) {
  const out = []
  for (const b of bids || []) {
    if (typeof b === 'string') out.push(b)
    else if (b && typeof b.call === 'string') out.push(b.call)
    else if (b && typeof b.level === 'number' && b.strain) out.push(`${b.level}${b.strain}`)
  }
  return out
}

function normalizeLegal(legalCards) {
  return (legalCards || []).map((c) => ({ suit: c.suit, rank: c.rank === '10' ? 'T' : c.rank }))
}

export const RuleBot = {
  name: 'rules',
  async chooseOpeningLead(ctx) {
    return decideRule('choose_opening_lead_json', ctx, false)
  },
  async chooseCard(ctx) {
    return decideRule('choose_card_json', ctx, true)
  },
}

async function decideRule(fn, ctx, withDummy) {
  const legal = normalizeLegal(ctx.legalCards)
  try {
    const m = await ensureRuleBot()
    const dto = {
      seat: ctx.seat,
      hand: handObjToCards(ctx.hand),
      declarer: ctx.declarer,
      dealer: ctx.dealer,
      contract: ctx.contract,
      auction: bidsToPbn(ctx.bids),
      vulnerable: ctx.vulnerable || 'None',
      legal,
    }
    if (withDummy) {
      dto.dummy = handObjToCards(ctx.dummy)
      dto.played = (ctx.played || []).map((p) => ({
        seat: p.seat,
        suit: p.suit,
        rank: p.rank === '10' ? 'T' : p.rank,
      }))
    }
    const out = JSON.parse(m[fn](JSON.stringify(dto), '{}'))
    return { suit: out.suit, rank: out.rank }
  } catch (err) {
    // Never break the hand — fall back to a legal card (the rulebot's own
    // server-side contract is "never random" only for signal coherence; a
    // degraded solo turn is better than a stuck table).
    console.warn('[RuleBot] falling back to a legal card:', err?.message || err)
    return legal[0] ? { suit: legal[0].suit, rank: legal[0].rank } : pickRandom(ctx.legalCards)
  }
}

// ── BotRegistry ────────────────────────────────────────────────────────
// Central place to look up a bot by name.

const BOTS = {
  random: RandomLegalBot,
  ben: BenBot,
  rules: RuleBot,
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

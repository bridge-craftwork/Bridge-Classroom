// Client for the BEN bridge engine REST API.
// Deployed at https://ben.bridge-craftwork.com (see ben-service repo).
// BEN is stateless: every call carries the full game state.
//
// Endpoint docs: https://github.com/lorserker/ben/blob/main/README-api.md

const DEFAULT_BEN_URL = 'https://ben.bridge-craftwork.com'

export function getBenUrl() {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BEN_URL) {
    return import.meta.env.VITE_BEN_URL
  }
  if (typeof process !== 'undefined' && process.env?.BEN_URL) {
    return process.env.BEN_URL
  }
  return DEFAULT_BEN_URL
}

// ── Encoders ───────────────────────────────────────────────────────────

// Hand → suit-dot PBN string ("AK97543.K.T3.AK7").
// `hand` shape: { spades: [...], hearts: [...], diamonds: [...], clubs: [...] }.
// Ranks must already be in standard form ("T" not "10"); arrays must be in
// rank-descending order or BEN doesn't care, but our callers store them desc.
export function handToPbn(hand) {
  if (!hand) throw new Error('handToPbn: hand is required')
  const parts = [hand.spades, hand.hearts, hand.diamonds, hand.clubs]
  for (const arr of parts) {
    if (!Array.isArray(arr)) throw new Error('handToPbn: each suit must be an array')
  }
  return parts.map(arr => arr.join('')).join('.')
}

// Bids array → ctx string.
// Per docs: Pass → "--", X → "Db", XX → "Rd", suit/NT bids as-is.
// BBA emits "1NT"; BEN expects "1N". Strip the trailing T.
export function bidsToCtx(bids) {
  if (!Array.isArray(bids)) throw new Error('bidsToCtx: bids must be an array')
  return bids.map(b => {
    if (b === 'Pass') return '--'
    if (b === 'X') return 'Db'
    if (b === 'XX') return 'Rd'
    if (/^\dNT$/.test(b)) return b.slice(0, -1)
    return b
  }).join('')
}

// Played cards → "DJDKD3D2" string (suit-then-rank, T for 10).
// `played` shape: [{ suit: 'S'|'H'|'D'|'C', rank: 'A'..'2' }, ...] in
// chronological order across all 4 seats.
export function playedToString(played) {
  if (!Array.isArray(played)) throw new Error('playedToString: played must be an array')
  return played.map(p => {
    if (!p || !p.suit || !p.rank) throw new Error('playedToString: each entry needs {suit, rank}')
    return p.suit + p.rank
  }).join('')
}

// PBN vulnerability ("None"|"NS"|"EW"|"All"|"Both") → BEN's seat-relative
// encoding. From docs: "@v" = we're vul, "@V" = they're vul, both can stack.
// "None" → ""; "All"/"Both" → "@v@V" regardless of seat.
export function vulToBen(vulnerable, seat) {
  if (!seat || !'NESW'.includes(seat)) throw new Error('vulToBen: seat required (N/E/S/W)')
  const v = vulnerable || 'None'
  if (v === 'None') return ''
  if (v === 'All' || v === 'Both') return '@v@V'
  const ourSide = (seat === 'N' || seat === 'S') ? 'NS' : 'EW'
  const ourVul = v === ourSide
  return ourVul ? '@v' : '@V'
}

// ── HTTP ───────────────────────────────────────────────────────────────

async function benFetch(path, params, { timeoutMs = 180000, signal } = {}) {
  const qs = new URLSearchParams(params).toString()
  const url = `${getBenUrl()}${path}?${qs}`
  const ctrl = new AbortController()
  const timeoutId = setTimeout(() => ctrl.abort(), timeoutMs)
  // Caller can also pass an outer signal; abort the inner ctrl if it fires.
  if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true })
  const startedAt = (typeof performance !== 'undefined') ? performance.now() : Date.now()
  try {
    const resp = await fetch(url, { method: 'GET', signal: ctrl.signal })
    if (!resp.ok) {
      let detail = `HTTP ${resp.status}`
      try {
        const j = await resp.json()
        if (j?.error) detail = j.error
      } catch { /* fall through */ }
      throw new Error(`BEN ${path}: ${detail}`)
    }
    const json = await resp.json()
    const elapsedMs = ((typeof performance !== 'undefined') ? performance.now() : Date.now()) - startedAt
    return { json, elapsedMs }
  } finally {
    clearTimeout(timeoutId)
  }
}

// ── Public API ─────────────────────────────────────────────────────────

// GET /lead — opening lead recommendation.
// Returns { card, elapsedMs, raw } where `card` is e.g. "S7" (suit + rank).
export async function fetchOpeningLead({ hand, seat, dealer, vul, ctx }, opts = {}) {
  const params = {
    hand: handToPbn(hand),
    seat,
    dealer,
    vul: typeof vul === 'string' ? vul : vulToBen(vul, seat),
    ctx: typeof ctx === 'string' ? ctx : bidsToCtx(ctx),
  }
  const { json, elapsedMs } = await benFetch('/lead', params, opts)
  return { card: json.card, elapsedMs, raw: json }
}

// GET /play — card recommendation during cardplay.
//
// BEN's convention (learned empirically — docs are ambiguous):
//   - `seat` is the *decision-maker's* seat, not the seat that physically plays.
//     For declarer-side plays (declarer's hand OR dummy's hand), pass
//     seat=declarer.  For defender plays, pass seat=defender.  Passing the
//     dummy's seat fails with "Called as dummy or wrong dealer/seat".
//   - `hand` is the decision-maker's hand (declarer's, or the defender's own).
//     Never pass hand=dummy; you get "Hand and dummy are identical".
//   - BEN figures out *whose* card to play from `played.length` and returns
//     the response's `player` field (0=LHO, 1=Dummy, 2=RHO, 3=Declarer)
//     so the caller knows which seat to subtract the card from.
//
// Returns { card, player, elapsedMs, raw }.  Caller is responsible for
// mapping `player` → actual seat (declarer + (player+1) mod 4, since 0=LHO).
export async function fetchBotCard({ hand, dummy, seat, dealer, vul, ctx, played }, opts = {}) {
  const params = {
    hand: handToPbn(hand),
    dummy: handToPbn(dummy),
    seat,
    dealer,
    vul: typeof vul === 'string' ? vul : vulToBen(vul, seat),
    ctx: typeof ctx === 'string' ? ctx : bidsToCtx(ctx),
    played: typeof played === 'string' ? played : playedToString(played),
  }
  const { json, elapsedMs } = await benFetch('/play', params, opts)
  return { card: json.card, player: json.player, elapsedMs, raw: json }
}

// GET /claim — ask BEN whether a claim of N tricks is achievable from the
// current play state. Returns { accepted, message, tricks, elapsedMs, raw }.
// BEN's response is { tricks: <N>, result: "Contract: 4S Accepted declarers
// claim of 10 tricks" } when valid; we detect "Accepted" / "Rejected" in
// the message string. Caller can show `message` directly to the user.
export async function fetchClaimValidation({ tricks, hand, dummy, seat, dealer, vul, ctx, played }, opts = {}) {
  const params = {
    tricks,
    hand: handToPbn(hand),
    dummy: handToPbn(dummy),
    seat,
    dealer,
    vul: typeof vul === 'string' ? vul : vulToBen(vul, seat),
    ctx: typeof ctx === 'string' ? ctx : bidsToCtx(ctx),
    played: typeof played === 'string' ? played : playedToString(played),
  }
  const { json, elapsedMs } = await benFetch('/claim', params, opts)
  const message = json.result || ''
  const accepted = /\baccepted\b/i.test(message) && !/\brejected\b/i.test(message)
  return { accepted, message, tricks: json.tricks, elapsedMs, raw: json }
}

// Fire-and-forget call to wake BEN up. The first /bid or /lead after a long
// idle costs ~10-20s as the TensorFlow models load; subsequent calls drop
// to ~300-1000ms. Calling this on app mount (or when cardplay toggle goes
// on) absorbs the cold start before the user notices.
//
// Caller doesn't await. Errors swallowed — if BEN is down or CORS isn't
// reachable, real cardplay calls will surface the error normally.
export function warmBen() {
  if (typeof fetch === 'undefined') return
  const url = `${getBenUrl()}/bid?hand=AKQ.KQJ.AT98.KQ2&seat=N&dealer=N&vul=&ctx=`
  fetch(url, { method: 'GET' })
    .then(r => r.ok && r.json())
    .then(j => {
      if (typeof console !== 'undefined' && j) {
        // eslint-disable-next-line no-console
        console.log('[cardplay] BEN pre-warm complete:', j.bid || '(no bid)')
      }
    })
    .catch(() => { /* swallow — first real call will surface real errors */ })
}

// Map BEN's `player` field (relative to declarer) back to an actual seat.
//   player 0 = LHO of declarer
//   player 1 = dummy (partner of declarer)
//   player 2 = RHO of declarer
//   player 3 = declarer
const SEAT_ORDER = ['N', 'E', 'S', 'W']
export function playerToSeat(player, declarer) {
  const declarerIdx = SEAT_ORDER.indexOf(declarer)
  if (declarerIdx < 0) throw new Error(`playerToSeat: bad declarer ${declarer}`)
  // BEN's 0=LHO comes after declarer (clockwise). So LHO is declarerIdx + 1.
  return SEAT_ORDER[(declarerIdx + 1 + player) % 4]
}

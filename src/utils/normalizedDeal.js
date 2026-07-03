// Convert boards from a club game's NATIVE normalized JSON (the extractor's
// schema, stored in club_games — app-architecture.md D13) into the minimal
// single-board PBN the table service accepts ({"t":"deal","source":"pbn"}).
//
// Board shape (normalized-schema.md):
//   { number, dealer: "N"|"E"|"S"|"W", vulnerability: "None"|"NS"|"EW"|"Both",
//     deal: { N: Hand, E: Hand, S: Hand, W: Hand } }
//   Hand = { S: [...ranks], H: [...], D: [...], C: [...] }  ("10" for the ten,
//   [] for a void). Mirrors game-analysis's dealToPBN/handToPBN so the two
//   apps render identical PBN for the same board.

const DIRS = ['N', 'E', 'S', 'W']
const CLOCKWISE = {
  N: ['N', 'E', 'S', 'W'],
  E: ['E', 'S', 'W', 'N'],
  S: ['S', 'W', 'N', 'E'],
  W: ['W', 'N', 'E', 'S'],
}
const VUL_MAP = { None: 'None', NS: 'NS', EW: 'EW', Both: 'All', All: 'All' }

/** One hand → PBN suit notation "S.H.D.C" (ten as T, void as empty). */
function handToPbn(hand) {
  const fmt = (arr) => (arr || []).map((r) => (r === '10' ? 'T' : r)).join('')
  return [fmt(hand?.S), fmt(hand?.H), fmt(hand?.D), fmt(hand?.C)].join('.')
}

/** All playable boards across every tournament/event/session of a game. */
export function clubGameBoards(normalized) {
  const out = []
  for (const t of normalized?.tournaments || []) {
    for (const e of t?.events || []) {
      for (const s of e?.sessions || []) {
        for (const b of s?.boards || []) {
          if (b?.deal) out.push(b)
        }
      }
    }
  }
  return out
}

/** A normalized board → minimal single-board PBN string, or null if unusable. */
export function boardToMinimalPbn(board) {
  if (!board?.deal) return null
  const dealer = DIRS.includes(board.dealer) ? board.dealer : 'N'
  const seq = CLOCKWISE[dealer]
  const dealStr = `${dealer}:${seq.map((d) => handToPbn(board.deal[d])).join(' ')}`
  return [
    `[Board "${board.number ?? 1}"]`,
    `[Dealer "${dealer}"]`,
    `[Vulnerable "${VUL_MAP[board.vulnerability] || 'None'}"]`,
    `[Deal "${dealStr}"]`,
    '',
  ].join('\n')
}

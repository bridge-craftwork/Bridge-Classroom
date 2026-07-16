// Double-dummy solver client. POSTs a deal to our self-hosted solver
// (bridge-solver-service at solver.bridge-craftwork.com) and returns the raw
// 20-char `ddtricks` string — seat [N,S,E,W] × strain [NT,S,H,D,C] — or null on
// any failure. Double-dummy is a best-effort post-hand overlay, never
// load-bearing. Parse cells with ddTrickAt / buildDdRows in handAnalysis.js.
//
// Replaces the former third-party bridgewebs BSOL GET call. Our service is a
// drop-in: it emits the exact same `ddtricks` byte string bridgewebs did
// (verified byte-for-byte), so handAnalysis.js needs no changes.

import { handsToPbnString } from './handAnalysis.js'

// Single public host for both .com and .org frontends (edge CORS allows both).
// Override with VITE_SOLVER_URL to point at a local solver, e.g. for testing.
const SOLVER_URL = import.meta.env.VITE_SOLVER_URL || 'https://solver.bridge-craftwork.com'

export async function fetchDoubleDummy(deal) {
  // Standard PBN deal string; our service parses it with Hands::from_pbn.
  // (No spaces->x hack — that was a bridgewebs URL-encoding quirk.)
  const dealstr = 'N:' + handsToPbnString(deal.hands)
  const resp = await fetch(`${SOLVER_URL}/dd`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dealstr }),
  })
  if (!resp.ok) return null
  const json = await resp.json()
  return json.ddtricks && json.ddtricks.length >= 20 ? json.ddtricks : null
}

// ── Per-card cardplay analysis (bridge-solver-service #4) ──────────────────
// Post-hand double-dummy "AnalysePlay". Two endpoints, both best-effort (null on
// any failure — the overlay is never load-bearing). See
// documentation/design/dd-cardplay-analysis-spec.md.
//
// `req` shape (shared): { hands, trump, declarer, leader, plays } where
//   hands   — { N:{spades,hearts,...}, ... } (the ORIGINAL deal)
//   trump   — 'S'|'H'|'D'|'C'|'NT'  (map a null/NT trump to the string 'NT')
//   declarer/leader — 'N'|'E'|'S'|'W'
//   plays   — ['H4','CT', ...] play order (suit letter + rank, 'T' for ten)

function ddPlayBody({ hands, trump, declarer, leader, plays }) {
  return JSON.stringify({
    dealstr: 'N:' + handsToPbnString(hands),
    trump: trump || 'NT',
    declarer,
    leader,
    plays,
  })
}

// The running trace: { contract_tricks, trace: [{index, seat, card, cost}] }.
// Powers the error badges — a card with cost > 0 gave away that many tricks.
export async function fetchDdPlay(req) {
  try {
    const resp = await fetch(`${SOLVER_URL}/dd/play`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: ddPlayBody(req),
    })
    if (!resp.ok) return null
    const json = await resp.json()
    return Array.isArray(json.trace) ? json : null
  } catch {
    return null
  }
}

// One node's alternatives (on click): { index, seat, card, cost,
// alternatives: [{card, tricks, cost}] }. `node` indexes into `plays`.
export async function fetchDdPlayNode(req, node) {
  try {
    const resp = await fetch(`${SOLVER_URL}/dd/play/node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...JSON.parse(ddPlayBody(req)), node }),
    })
    if (!resp.ok) return null
    const json = await resp.json()
    return Array.isArray(json.alternatives) ? json : null
  } catch {
    return null
  }
}

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

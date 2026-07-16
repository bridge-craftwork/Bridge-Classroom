// Per-client arrangement axis (a1 grid-flip). Resolves which table arrangement the
// CURRENT client renders — `grid` (the named-area arranger, now the default) or
// `legacy` (the old compass layout, opt-in during the retirement window) — from, in
// priority order:
//   1. an `?arrangement=grid|legacy` query param (the switch), which also PERSISTS
//      the choice so navigation within the app doesn't shed it;
//   2. the persisted localStorage value from a prior query override;
//   3. the default (`grid`) — so every client without an override gets the arranger.
//
// Production default is `grid` as of slice 1.6b (flipped from `legacy` 2026-07-15
// after the soak; a1-grid-flip-slice-spec §1.6b). `?arrangement=legacy` remains the
// standing escape hatch until slice 1.7 retires legacy entirely.
//
// Pure + side-effect-free here (no localStorage / window reads baked in) so it's
// unit-testable; the composable (useArrangement.js) supplies the live inputs.

export const ARRANGEMENT_STORAGE_KEY = 'bcArrangement'
export const ARRANGEMENTS = ['legacy', 'grid']
export const DEFAULT_ARRANGEMENT = 'grid'

/** Normalize an arbitrary value to a valid arrangement, or null. */
export function normalizeArrangement(v) {
  return ARRANGEMENTS.includes(v) ? v : null
}

/**
 * Read the `?arrangement=` param from a location, checking BOTH the search string
 * (`?arrangement=grid#/route`) and the hash query (`#/route?arrangement=grid`) —
 * the app uses hash routing, so a shared/pasted link can carry it either side of
 * the `#`. Returns a valid arrangement or null.
 * @param {{search?:string, hash?:string}|null} loc
 */
export function readArrangementParam(loc) {
  if (!loc) return null
  const fromSearch = new URLSearchParams(loc.search || '').get('arrangement')
  const hash = loc.hash || ''
  const qi = hash.indexOf('?')
  const fromHash = qi >= 0 ? new URLSearchParams(hash.slice(qi + 1)).get('arrangement') : null
  return normalizeArrangement(fromSearch) ?? normalizeArrangement(fromHash)
}

/**
 * Resolve the effective arrangement + its provenance. Query wins (it's the explicit
 * intent, and the caller persists it); else the stored value; else the default.
 * `source` feeds the bug-report snapshot's first triage question — "was the reporter
 * on grid at all, and how did they get there".
 * @param {{param?:string|null, stored?:string|null}} o
 * @returns {{arrangement:'legacy'|'grid', source:'query'|'localStorage'|'default'}}
 */
export function resolveArrangement({ param = null, stored = null } = {}) {
  if (normalizeArrangement(param)) return { arrangement: param, source: 'query' }
  if (normalizeArrangement(stored)) return { arrangement: stored, source: 'localStorage' }
  return { arrangement: DEFAULT_ARRANGEMENT, source: 'default' }
}

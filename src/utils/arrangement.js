// Per-client arrangement axis (a1 grid-flip slice 1.6a). Resolves which table
// arrangement the CURRENT client renders — `legacy` (today's compass layout) or
// `grid` (the named-area arranger) — from, in priority order:
//   1. a `?arrangement=grid|legacy` query param (the preview switch), which also
//      PERSISTS the choice so navigation within the app doesn't shed it;
//   2. the persisted localStorage value from a prior query override;
//   3. the default (`legacy`) — so every client without the override is untouched.
//
// Production default stays `legacy`; this is the standing mechanism for previewing
// any arrangement candidate against prod (grid-arranger-spec / a1-grid-flip-slice-spec
// §1.6a — the override is permanent dev apparatus, not scaffolding).
//
// Pure + side-effect-free here (no localStorage / window reads baked in) so it's
// unit-testable; the composable (useArrangement.js) supplies the live inputs.

export const ARRANGEMENT_STORAGE_KEY = 'bcArrangement'
export const ARRANGEMENTS = ['legacy', 'grid']
export const DEFAULT_ARRANGEMENT = 'legacy'

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

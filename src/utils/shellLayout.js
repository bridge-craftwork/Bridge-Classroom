// Where the SHELL puts the table's companion column (the rail) at a given viewport.
//
// The split this file marks is the important part. The grid arranger is
// deliberately VIEWPORT-BLIND: the shell hands it a width budget and it sizes to
// that, one-directionally, so region scale can never feed back into the measurement
// it was derived from. Which means "put the rail beside the table, or under it"
// cannot be an arranger question — the arranger is not allowed to know. It's a shell
// question, and this is the shell's half of the contract.
//
// Policy is DATA (`config.shell.perViewport`, per surface); mechanism is the shell.
// A surface changes its breakpoints by editing its config, never CSS.
//
// Previously this matcher lived only in src/report/tableConfigSnapshot.js, so the
// bug reporter could record which rule fired — while TableShell ignored the config
// entirely and hardcoded `@media (max-width: 800px)`. The two disagreed: the config
// stacked at ≤999px, the CSS at ≤800px, and every viewport in between (iPad portrait
// is 820 wide) kept a two-column layout the config said to stack. Hoisting the
// matcher here is what makes the report and the render describe the same thing.

/**
 * Resolve the shell rule for a viewport, first hit wins.
 *
 * A rule may constrain any of `minWidth`, `maxWidth`, `portrait`; absent keys don't
 * constrain. `portrait` is derived (h > w) rather than asked for, so a rule can say
 * "portrait, whatever the width" — which is the honest way to express an orientation
 * policy, instead of encoding it as a width threshold that happens to work today.
 *
 * @param {{perViewport?: Array}|null|undefined} shell  config.shell
 * @param {{w:number, h?:number}|null|undefined} viewport
 * @returns {{mode:string|null, companion:string|null}|null} null when unresolvable
 */
export function matchShell(shell, viewport) {
  const rules = shell?.perViewport
  if (!Array.isArray(rules) || !viewport || viewport.w == null) return null
  const w = viewport.w
  const portrait = viewport.h != null ? viewport.h > viewport.w : null
  const hit = rules.find((r) =>
    (r.minWidth == null || w >= r.minWidth) &&
    (r.maxWidth == null || w <= r.maxWidth) &&
    (r.portrait == null || r.portrait === portrait),
  )
  return hit ? { mode: hit.mode ?? null, companion: hit.companionPosition ?? null } : null
}

/** The layout a surface falls back to with no config — today's two-column default. */
export const DEFAULT_SHELL = { mode: 'two-column', companion: 'right' }

/**
 * Does this resolved rule stack the companion with the table (one column) rather
 * than setting it beside? 'below' and 'above' stack; 'left'/'right' are columns.
 */
export function isStacked(resolved) {
  if (!resolved) return false
  if (resolved.mode === 'stacked') return true
  return resolved.companion === 'below' || resolved.companion === 'above'
}

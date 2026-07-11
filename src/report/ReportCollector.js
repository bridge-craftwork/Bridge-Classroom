// ReportCollector — the app-blind gatherer (spec §1). It assembles the in-memory
// report bundle: env block + layout snapshot + narrative + screenshot + (Slice 0)
// stubbed tape and fixture. It has no knowledge of any sink — sinks consume it.
//
// Enrichment is how the bundle grows with the apps: a shell that knows its own
// arrangement/scale/phase/tableConfig, or an engine that can `captureFixture()`,
// passes those in via `enrich`. Nothing here needs to change as that data lands.
//
// Robustness contract: gathering the extra forensics must NEVER break report
// generation. Every optional capture step is wrapped so a DOM/API hiccup degrades
// that field to a safe fallback instead of throwing (the user still gets to file).

import { collectEnv } from './env.js'
import { collectLayout } from './layout.js'

// Bumped when the on-disk bundle shape changes incompatibly. The loader uses it
// to decline stale bundles legibly rather than mis-render them (spec §9). No
// backward-compat obligation attaches to it. Adding `layout` is ADDITIVE — no
// consumer validates the shape today, so no bump is warranted.
export const SCHEMA_VERSION = 0

/** Run a capture step, degrading to `fallback` (never throwing) on any error. */
function safe(fn, fallback) {
  try {
    return fn()
  } catch (err) {
    console.warn('[report] capture step failed (continuing):', err)
    return fallback
  }
}

/**
 * @param {object} [input]
 * @param {string} [input.note='']            Reporter's free-text narrative.
 * @param {Blob|null} [input.screenshot=null] Pre-captured screenshot (capture happens
 *                                            before this call, on the beetle tap).
 * @param {object} [input.enrich={}]          Optional shell/engine enrichment:
 *   - enrich.env      → merged over the base env block (arrangement, scale, phase…)
 *   - enrich.layout   → tap-time computed-geometry snapshot (from collectLayout(),
 *                       frozen WITH the screenshot so both reflect the same DOM).
 *                       Falls back to collecting now if not provided.
 *   - enrich.fixture  → replaces the fixture stub (from engine.captureFixture())
 *   - enrich.tape     → replaces the empty action tape (Slice 2)
 *   - enrich.context  → merged into context.json (extra forensics). In particular
 *                       the shell that mounts the grid arranger sets
 *                       `enrich.context.tableConfig` — the config INPUT side that
 *                       pairs with layout's rendered OUTPUTS — from
 *                       resolveTableConfig() plus its own computed reserves:
 *                         enrich.context.tableConfig = {
 *                           ...resolveTableConfig(cfg, phase, { w: innerWidth, h: innerHeight }),
 *                           reserves: { auction: auctionReservePx(), seat: rowReservePx(7) },
 *                         }
 *                       (reserves come from the arranger's own modules, hence
 *                       passed in, not imported by the report lib). TODO(arranger):
 *                       wire this at the shell call site when the grid arranger
 *                       ships. Legacy a1 has no config, so tableConfig is simply
 *                       absent — same as the other not-yet-wired shell fields.
 * @returns {{context: object, fixture: object, screenshot: Blob|null}}
 */
export function collectReport({ note = '', screenshot = null, enrich = {} } = {}) {
  const env = safe(() => ({ ...collectEnv(), ...(enrich.env || {}) }), enrich.env || {})

  // App-blind computed-geometry snapshot of the shared table components — the
  // OUTPUTS (rendered widths + min-width + --suit/--region-scale + hand-box
  // ancestry). Prefer the tap-time snapshot (frozen with the screenshot); else
  // collect now. Config INPUTS arrive via enrich.context.tableConfig (above).
  const layout = enrich.layout !== undefined ? enrich.layout : safe(() => collectLayout(), null)

  const context = {
    schemaVersion: SCHEMA_VERSION,
    note,
    env,
    layout,
    tape: enrich.tape || [], // Slice 2 fills this
    consoleErrors: [], // reserved
    issue: null, // back-reference written by the GitHub sink (Slice 1)
    ...(enrich.context || {})
  }

  const fixture = enrich.fixture || {
    schemaVersion: SCHEMA_VERSION,
    stub: true,
    note: 'Fixture capture is not wired yet (Slice 3/4). Env + screenshot only.'
  }

  return { context, fixture, screenshot }
}

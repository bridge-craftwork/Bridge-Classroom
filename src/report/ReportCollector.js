// ReportCollector — the app-blind gatherer (spec §1). It assembles the in-memory
// report bundle: env block + narrative + screenshot + (Slice 0) stubbed tape and
// fixture. It has no knowledge of any sink — sinks consume its output.
//
// Enrichment is how the bundle grows with the apps: a shell that knows its own
// arrangement/scale/phase, or an engine that can `captureFixture()`, passes those
// in via `enrich`. Nothing here needs to change as that data lands (later slices).

import { collectEnv } from './env.js'

// Bumped when the on-disk bundle shape changes incompatibly. The loader uses it
// to decline stale bundles legibly rather than mis-render them (spec §9). No
// backward-compat obligation attaches to it.
export const SCHEMA_VERSION = 0

/**
 * @param {object} [input]
 * @param {string} [input.note='']            Reporter's free-text narrative.
 * @param {Blob|null} [input.screenshot=null] Pre-captured screenshot (capture happens
 *                                            before this call, on the beetle tap).
 * @param {object} [input.enrich={}]          Optional shell/engine enrichment:
 *   - enrich.env      → merged over the base env block (arrangement, scale, phase…)
 *   - enrich.fixture  → replaces the fixture stub (from engine.captureFixture())
 *   - enrich.tape     → replaces the empty action tape (Slice 2)
 *   - enrich.context  → merged into context.json (extra forensics)
 * @returns {{context: object, fixture: object, screenshot: Blob|null}}
 */
export function collectReport({ note = '', screenshot = null, enrich = {} } = {}) {
  const env = { ...collectEnv(), ...(enrich.env || {}) }

  const context = {
    schemaVersion: SCHEMA_VERSION,
    note,
    env,
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

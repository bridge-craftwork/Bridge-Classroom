// captureA1Snapshot — the A1 diagnostic serializer (a1-grid-flip-slice-spec §1.6c).
// ONE payload, TWO consumers:
//   (a) bug-report context — mapped into the collector's `enrich` hook by
//       `a1SnapshotToEnrich()` so a beetle report on an A1 grid view carries the
//       arrangement, the arranger's ledger, the phase, and a gallery-loadable fixture;
//   (b) importable A1 gallery fixture — `snapshot.fixture` is shaped like a
//       `src/harness/fixtures-a1/*` module, so a captured payload renders directly.
// Because (a) and (b) share this artifact, a bug report IS a reproducible fixture.
//
// PURE + defensive: it only shapes the `state` handed in (no DOM/composable imports),
// so it's unit-testable, and every field access tolerates a missing input — capturing
// diagnostics must NEVER break report filing. The A1 shell assembles `state`.
//
// SCHEMA VERSION: bumped whenever the payload shape changes incompatibly. It's
// deliberately its OWN version (independent of ReportCollector.SCHEMA_VERSION) so the
// A1 snapshot can evolve as we gain experience with it during the flip soak without
// disturbing the collector's bundle version. The gallery loader / repro tooling reads
// it to decline or migrate stale snapshots rather than mis-render them.

export const A1_SNAPSHOT_SCHEMA_VERSION = 1

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null)
const str = (v) => (typeof v === 'string' && v ? v : null)
const arr = (v) => (Array.isArray(v) ? v : [])
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null)

/**
 * Shape an A1 diagnostic snapshot from live shell state. Every field is optional;
 * absent inputs degrade to null / [] / {} rather than throwing.
 *
 * @param {object} [state]
 * @param {{value:string, source:string}} [state.arrangement]  resolved axis + provenance
 * @param {string} [state.phase]           derived canonical phase ('bidding'|'play'|'review')
 * @param {object} [state.phaseSignals]    the raw booleans the phase was derived FROM
 *   (auctionComplete, isDeclarerPlay, showOpeningLead, hasSteps, hasBidPrompt, isComplete) —
 *   phase derivation is A1's flagged hard part, so the report answers "what did the view
 *   think the phase was, and from what".
 * @param {object} [state.content]         lesson family / lesson / board / step index / deal hash
 * @param {object} [state.env]             viewport, tableScale, dpr, userAgent
 * @param {object} [state.identity]        { userId, classContext } — deliberately minimal
 * @param {object|null} [state.ledger]     computeLayoutLedger output (null in legacy)
 * @param {object|null} [state.tableConfig] resolveTableConfig(...) + reserves (null in legacy)
 * @param {Array}  [state.tape]            ActionTape tail (empty until bug-reporting Slice 2)
 * @param {object} [state.fixture]         fixture-grade rendered state (fixtures-a1 shape)
 * @param {number} [state.capturedAt]      ms epoch (caller stamps; tests pass a fixed value)
 * @returns {object} the snapshot payload (schemaVersion-stamped)
 */
export function captureA1Snapshot(state = {}) {
  const s = obj(state) || {}
  const arrangement = obj(s.arrangement) || {}
  const signals = obj(s.phaseSignals) || {}
  const content = obj(s.content) || {}
  const env = obj(s.env) || {}
  const identity = obj(s.identity) || {}

  return {
    schemaVersion: A1_SNAPSHOT_SCHEMA_VERSION,
    capturedAt: num(s.capturedAt),
    arrangement: {
      value: str(arrangement.value),
      source: str(arrangement.source), // 'query' | 'localStorage' | 'default'
    },
    phase: str(s.phase),
    // The booleans the phase was derived from — preserved verbatim (unknown keys kept)
    // so a phase-derivation bug is diagnosable without re-deriving.
    phaseSignals: { ...signals },
    content: {
      collection: str(content.collection),
      lessonFamily: str(content.lessonFamily),
      lesson: str(content.lesson),
      board: content.board ?? null,
      stepIndex: num(content.stepIndex),
      stepCount: num(content.stepCount),
      dealHash: str(content.dealHash), // catches deal-repo drift between report and repro
    },
    env: {
      viewport: obj(env.viewport) ? { w: num(env.viewport.w), h: num(env.viewport.h) } : null,
      tableScale: num(env.tableScale),
      dpr: num(env.dpr),
      userAgent: str(env.userAgent),
    },
    identity: {
      userId: identity.userId ?? null,
      classContext: identity.classContext ?? null,
    },
    ledger: obj(s.ledger) || null,        // the arranger's numeric "why it looks like that"
    tableConfig: obj(s.tableConfig) || null,
    tape: arr(s.tape),
    fixture: obj(s.fixture) || null,      // gallery-importable rendered state
  }
}

/**
 * Map a snapshot into the ReportCollector `enrich` fragments (a1-grid-flip §1.6c
 * consumer (a)). Keeps ReportDialog app-blind: the A1 shell produces this shape, the
 * collector merges it. `fixture` is lifted to the top so the committed `fixture.json`
 * is the gallery-loadable artifact; the rest rides `context.a1` (the full diagnostic,
 * minus the now-top-level fixture to avoid duplicating it); a few axes surface into
 * `env` so existing env-based triage (arrangement, phase, scale) works unchanged.
 *
 * @param {object} snapshot  output of captureA1Snapshot()
 * @returns {{env:object, context:object, fixture:object|null}}
 */
export function a1SnapshotToEnrich(snapshot) {
  const snap = obj(snapshot) || {}
  const { fixture, ...diagnostic } = snap
  return {
    env: {
      arrangement: snap.arrangement?.value ?? null,
      arrangementSource: snap.arrangement?.source ?? null,
      phase: snap.phase ?? null,
      tableScale: snap.env?.tableScale ?? null,
    },
    context: { a1: diagnostic },
    fixture: fixture || null,
  }
}

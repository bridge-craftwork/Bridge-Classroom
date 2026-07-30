// arrangerSnapshot — the arranger's own forensics, on EVERY surface that uses it.
//
// A1 already contributed a rich snapshot through reportContext (captureA1Snapshot),
// but that registry holds ONE provider — the active app shell — so the B tables and
// the C console drill-in had no way to add theirs. The result was that every table
// layout report had to be reverse-engineered by hand from the bounding-box screenshot:
// three separate bundles in July 2026 were diagnosed by squinting at X-ray captions
// and re-deriving allocations that the arranger already knew exactly.
//
// So this is deliberately a SEPARATE, additive registry rather than a second consumer
// of reportContext: the shell keeps its provider, and GridArrangement registers this
// one wherever it mounts. Both get merged into the bundle.
//
// Same robustness contract as reportContext: a provider that throws degrades to null,
// because capturing extra forensics must never stop a report from filing.

let provider = null

/** Register the mounted arranger's snapshot function. */
export function setArrangerSnapshot(fn) {
  provider = typeof fn === 'function' ? fn : null
}

/** Clear it. Pass the same fn so a remount that already replaced it isn't clobbered. */
export function clearArrangerSnapshot(fn) {
  if (!fn || provider === fn) provider = null
}

/** Invoke the active provider, degrading to null on absence or error. */
export function captureArrangerSnapshot() {
  if (!provider) return null
  try {
    return provider() || null
  } catch (err) {
    console.warn('[report] arranger snapshot failed (continuing):', err)
    return null
  }
}

/** Test-only reset. */
export function __resetArrangerSnapshotForTests() {
  provider = null
}

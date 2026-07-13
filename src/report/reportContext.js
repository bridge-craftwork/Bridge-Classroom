// reportContext — a tiny provider registry that lets the ACTIVE app shell hand the
// beetle its own forensic context without the report library knowing about any app
// (bug-reporting-spec §1: "no per-app capture code beyond declaring capabilities").
//
// The shell registers a provider on mount and clears it on unmount. On the beetle tap
// the button calls `captureReportContext()` — the provider returns `enrich`-shaped
// fragments ({ env?, context?, fixture?, tape? }) which the collector merges. Capturing
// on the TAP (not at submit) freezes the context WITH the screenshot, against the same
// buggy DOM. Only one provider is active at a time (one shell renders at a time); the
// A1 grid shell is the first to register (via captureA1Snapshot / a1SnapshotToEnrich).
//
// Robustness: a provider that throws degrades to null — capturing extra forensics must
// never stop a report from filing.

let provider = null

/** Register the active shell's context provider (a function returning enrich fragments). */
export function setReportContextProvider(fn) {
  provider = typeof fn === 'function' ? fn : null
}

/** Clear the provider. Pass the same fn to avoid clobbering a provider that replaced it. */
export function clearReportContextProvider(fn) {
  if (!fn || provider === fn) provider = null
}

/** Invoke the active provider (if any), degrading to null on absence or error. */
export function captureReportContext() {
  if (!provider) return null
  try {
    return provider() || null
  } catch (err) {
    console.warn('[report] context provider failed (continuing):', err)
    return null
  }
}

// Test-only reset.
export function __resetReportContextForTests() {
  provider = null
}

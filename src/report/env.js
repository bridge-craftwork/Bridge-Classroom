// Environment block for a bug report (spec §5). Every field is a triage axis.
//
// Slice 0 collects only what's readable generically from the browser + route —
// no engine coupling. Shell-specific coordinates (arrangement, --table-scale,
// phase, density, connection state) are left null here and meant to be filled in
// by the shell via the collector's `enrich` hook as the apps grow. That gradual
// enrichment is deliberate: the data element evolves with the apps, it isn't
// front-loaded.

/**
 * Map the current hash-route path to a coarse app id (spec §5 `app` axis).
 * Kept as a pure function of the path so it's trivially testable and cheap to
 * extend as routes change.
 */
export function detectApp(path = '') {
  const p = String(path)
  if (p.startsWith('/tables/host')) return 'table-host'
  if (p.startsWith('/tables/console') || p.startsWith('/console')) return 'console'
  if (p.startsWith('/tables')) return 'practice-table'
  if (p.startsWith('/harness')) return 'harness'
  // Everything else is the MainLayout catch-all = Scenario Mastery (a1).
  return 'a1'
}

/** Build-time provenance constants, guarded (they may be undefined in tests). */
function appVersion() {
  return typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null
}
function appCommit() {
  return typeof __APP_COMMIT__ !== 'undefined' ? __APP_COMMIT__ : null
}

/**
 * Gather the environment block. Globals are injected for testability; callers
 * normally pass nothing.
 *
 * @param {object} [deps]
 * @param {Window} [deps.win]
 * @param {Navigator} [deps.nav]
 * @param {Location} [deps.loc]
 * @param {Date} [deps.now]
 */
export function collectEnv({ win = globalThis, nav = globalThis.navigator, loc = globalThis.location, now = new Date() } = {}) {
  const hashPath = (loc?.hash || '').replace(/^#/, '') || '/'
  return {
    app: detectApp(hashPath),
    version: appVersion(),
    commit: appCommit(),
    url: loc?.href || null,
    route: hashPath,
    viewport: {
      w: win?.innerWidth ?? null,
      h: win?.innerHeight ?? null,
      dpr: win?.devicePixelRatio ?? null
    },
    platform: nav?.platform || null,
    ua: nav?.userAgent || null,
    timestamp: (now instanceof Date ? now : new Date()).toISOString(),

    // Shell/engine coordinates — filled by the collector's `enrich.env` hook as
    // apps expose them. Null here in Slice 0 (see file header).
    engine: null,
    phase: null,
    arrangement: null,
    tableScale: null,
    density: null,
    connection: null,
    board: null
  }
}

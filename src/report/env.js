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

/**
 * Browser name + major version. Prefers UA-Client-Hints `brands` (accurate,
 * present on Chromium), falling back to parsing the UA string (Safari/Firefox).
 */
export function detectBrowser(nav = globalThis.navigator) {
  const brands = nav?.userAgentData?.brands
  if (Array.isArray(brands) && brands.length) {
    // Skip the intentional "Not.A/Brand" greasepaint entries.
    const real = brands.find((b) => b && !/not.?[a/].?brand/i.test(b.brand))
    if (real) return `${real.brand} ${real.version}`
  }
  const ua = nav?.userAgent || ''
  const tests = [
    [/Edg\/(\d+)/, 'Edge'],
    [/OPR\/(\d+)/, 'Opera'],
    [/Firefox\/(\d+)/, 'Firefox'],
    [/CriOS\/(\d+)/, 'Chrome (iOS)'],
    [/Chrome\/(\d+)/, 'Chrome'],
    [/Version\/(\d+)[.\d]* Mobile.*Safari/, 'Safari (iOS)'],
    [/Version\/(\d+)[.\d]* Safari/, 'Safari']
  ]
  for (const [re, name] of tests) {
    const m = ua.match(re)
    if (m) return `${name} ${m[1]}`
  }
  return null
}

/**
 * Async high-entropy UA-Client-Hints — architecture ("arm" on Apple Silicon vs
 * "x86" on Intel), bitness, platform version. Best-effort: returns null where
 * unsupported (Safari/Firefox) or on any error. Chromium-only.
 */
export async function collectClientHints(nav = globalThis.navigator) {
  try {
    const uaData = nav?.userAgentData
    if (!uaData?.getHighEntropyValues) return null
    const h = await uaData.getHighEntropyValues(['architecture', 'bitness', 'platformVersion', 'model'])
    const arch = h.architecture
      ? `${h.architecture}${h.bitness ? `/${h.bitness}` : ''}`
      : null
    return {
      architecture: arch,
      platformVersion: h.platformVersion || null,
      model: h.model || null
    }
  } catch {
    return null
  }
}

/** The browser's resolved IANA timezone (e.g. "America/Los_Angeles"). */
function resolveTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
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
    // `navigator.platform` is a frozen legacy value ("MacIntel" on EVERY Mac,
    // Apple Silicon included) — prefer UA-Client-Hints `platform` ("macOS"),
    // which is accurate. `architecture` (async, filled via collectClientHints:
    // "arm/64" on Apple Silicon) is what actually distinguishes the chip.
    platform: nav?.userAgentData?.platform || nav?.platform || null,
    browser: detectBrowser(nav),
    architecture: null, // filled by collectClientHints() enrichment
    platformVersion: null, // filled by collectClientHints() enrichment
    ua: nav?.userAgent || null,

    // Localization — the user's language(s) and timezone, useful for reproducing
    // locale-dependent rendering (dates, number formats) and support context.
    language: nav?.language || null,
    languages: Array.isArray(nav?.languages) && nav.languages.length ? nav.languages.join(', ') : null,
    timezone: resolveTimezone(),
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

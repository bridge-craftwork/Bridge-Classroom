import { ARRANGEMENT_STORAGE_KEY, DEFAULT_ARRANGEMENT, normalizeArrangement, readArrangementParam } from '../utils/arrangement.js'
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
  if (p.startsWith('/tables/console') || p.startsWith('/console')) return 'console' // TeacherConsoleView
  // TableView — the unified practice/host table at bare /table. Solo vs served is
  // an engine distinction carried by env.engine, not a route one; both mount here.
  // Checked before the /table<code> join lobby below, and before the a1 catch-all.
  if (p === '/table' || p.startsWith('/table?')) return 'practice-table'
  // TableLobbyView launchers/join flows (/tables/new, /play/:code, /table/:code).
  if (p.startsWith('/tables') || p.startsWith('/play') || p.startsWith('/table')) return 'table-lobby'
  if (p.startsWith('/convention-card')) return 'convention-card' // ConventionCardView
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

/**
 * The display beyond the viewport: the logical screen size (CSS px), the OS work
 * area (`avail*` — minus the taskbar/dock), the browser WINDOW frame (`outer*` —
 * incl. tabs/address bar), and orientation. Together with `viewport` (the inner
 * content area) and `dpr`, these separate "a small WINDOW on a big display" from
 * "a genuinely small screen" — the distinction a layout-clip report turns on
 * (e.g. #38: 859px tall — small window, or small laptop?). Physical resolution is
 * `logical × dpr`, rendered server-side. Best-effort: null where unexposed.
 */
function collectScreen(win = globalThis) {
  const s = win?.screen
  return {
    w: s?.width ?? null,
    h: s?.height ?? null,
    availW: s?.availWidth ?? null,
    availH: s?.availHeight ?? null,
    outerW: win?.outerWidth ?? null,
    outerH: win?.outerHeight ?? null,
    orientation: s?.orientation?.type || null
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

// Standard browser zoom steps (Chrome/Firefox/Safari). `devicePixelRatio` = the
// display's native ratio × the browser zoom, and there is NO clean API for browser
// zoom on its own — so estimate it: for each plausible native ratio (1×, 2×, 3×),
// dpr/native lands on a standard step for exactly one of them in the common cases
// (e.g. dpr 1.6 = 2×80%). Snap to the nearest step, tie-breaking toward 100%. APPROX
// by nature (a display with an unusual native ratio can read wrong) — it exists to
// FLAG a non-100% zoom (the "everything's smaller" confusion, 2026-07-12), not to be
// authoritative. `dpr` is kept raw-but-rounded as the ground truth beside it.
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]
function nearestStep(z) { return ZOOM_STEPS.reduce((a, b) => (Math.abs(b - z) < Math.abs(a - z) ? b : a)) }
export function estimateZoom(dpr) {
  if (!dpr || dpr <= 0) return null
  let best = null
  for (const native of [1, 2, 3]) {
    const z = dpr / native
    const step = nearestStep(z)
    const score = Math.abs(step - z) + Math.abs(step - 1) * 0.01 // tie-break toward 100%
    if (!best || score < best.score) best = { step, score, err: Math.abs(step - z) }
  }
  return best && best.err < 0.05 ? Math.round(best.step * 100) : null // null when nothing snaps cleanly
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
// Resolve the arrangement the same way useArrangement does — query param wins, else
// the persisted override, else the default — without importing the composable.
function readArrangementChannel(loc) {
  try {
    const fromParam = readArrangementParam(loc)
    if (fromParam) return fromParam
    const stored = globalThis.localStorage?.getItem(ARRANGEMENT_STORAGE_KEY)
    return normalizeArrangement(stored) || DEFAULT_ARRANGEMENT
  } catch { return DEFAULT_ARRANGEMENT }
}

export function collectEnv({ win = globalThis, nav = globalThis.navigator, loc = globalThis.location, now = new Date() } = {}) {
  const hashPath = (loc?.hash || '').replace(/^#/, '') || '/'
  return {
    app: detectApp(hashPath),
    version: appVersion(),
    commit: appCommit(),
    // The per-client PREVIEW CHANNEL, on every surface. Previously only A1 recorded it
    // (captureA1Snapshot), so a table report came back with `arrangement: null` — and
    // once the axis started changing ARRANGER behaviour (2026-07-30, ?arrangement=beta)
    // that made A/B reports unreadable: a capture showing the default layout is
    // indistinguishable from one where the preview simply wasn't on. Read from storage
    // rather than the composable so this stays dependency-free and works pre-mount.
    // A1's own richer {value, source} snapshot still overrides this via enrich.env.
    arrangement: readArrangementChannel(loc),
    url: loc?.href || null,
    route: hashPath,
    viewport: {
      w: win?.innerWidth ?? null,
      h: win?.innerHeight ?? null,
      // Rounded so the report shows `2` / `1.6`, not `1.600000023841858`. `dpr` is the
      // ground truth (device ratio × browser zoom); `zoom` is the approx zoom % derived
      // from it (see estimateZoom) — the number that makes a non-100% tab obvious.
      dpr: win?.devicePixelRatio != null ? Math.round(win.devicePixelRatio * 100) / 100 : null,
      zoom: estimateZoom(win?.devicePixelRatio)
    },
    // The display + window frame around the viewport (see collectScreen). Distinct
    // from `viewport` (the inner content area): screen.h vs viewport.h is what tells
    // a clipped-layout report apart as "small window" vs "small display".
    screen: collectScreen(win),
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
    // NOTE: `arrangement` is deliberately NOT in this placeholder list — it is
    // resolved above from the URL/storage for every surface. It sat here as a null
    // placeholder and silently overrode the resolved value (the key appears later in
    // the object literal, so it won).
    engine: null,
    phase: null,
    tableScale: null,
    density: null,
    connection: null,
    board: null
  }
}

// Layout block for a bug report — a bounded, computed-geometry snapshot of the
// shared table components, so a sizing/compression bug (a hand box that
// shrink-wraps, an auction that overflows, a region that clamps wrong) is
// diagnosable from the report alone — no live session, no DevTools, no pointer.
//
// Why no element picker: the components that break are the SAME across every app
// (a1 / MainLayout, the practice tables, the console, the grid arranger), so we
// read a FIXED set of known anchor classes instead of asking "where did the user
// click." That also makes it self-limiting — a bridge table has a bounded number
// of these — and app-blind, like the rest of the collector.
//
// It reads only a handful of layout-relevant computed props (NOT the ~340-prop
// full dump) plus the CSS vars that scale the table, and one ancestry chain for
// the primary hand box (where container/scope sizing bugs surface — an absent
// scoped-style attr on a container is what pinned the #172 dead-`:deep()` rule).
// Budget: a bidding view ≈ 1–2 KB, a full 4-hand table ≈ ~3 KB. Caps below keep a
// pathological page (a many-table console) from ballooning the artifact.

// Anchor roots whose geometry explains sizing/compression bugs. Ordered
// most-diagnostic first, so a truncated capture keeps the important ones.
const ANCHORS = [
  '.holding',       // HandDisplay — the box that compresses
  '.seat-panel',    // SeatPanel — the min-width / shrink-wrap
  '.suit-row',      // per-suit rows — carry --suit-scale (the compression factor)
  '.auction-table', // AuctionTable — overflow / font sizing
  '.bidding-box',   // BiddingBox
  '.trick-area',    // TrickArea
  // Corner/rail occupants whose PRESENCE is the question. A grid corner is occupied
  // iff the shell provided its slot — which is a different test from whether the
  // content inside chose to render, so "was this actually on screen?" was an
  // inference from a screenshot. These two make it a fact in the bundle: a reserved
  // corner with no `.dd-table` row is a reserved-but-empty corner.
  '.dd-table',      // DoubleDummyTable — the SE occupant at review
  '.rc',            // RailCard — the companion-rail blocks
  '.grid-table',    // grid arranger — per-region --region-scale
  '.bridge-table',  // legacy arranger
]

// The CSS custom properties that scale the table components.
const VARS = { ts: '--table-scale', ss: '--suit-scale', rs: '--region-scale' }

// Defensive caps.
const MAX_ELEMENTS = 60
const CLASS_MAX = 64
const ANCESTRY_DEPTH = 8

const round = (n) => Math.round(n * 10) / 10

/** Compact `tag.class.class` id, class list truncated. */
function selOf(el) {
  const cls = String(el.className || '').trim().replace(/\s+/g, '.').slice(0, CLASS_MAX)
  return el.tagName.toLowerCase() + (cls ? `.${cls}` : '')
}

/** The set CSS vars on an element ({} if none) — only present ones, keyed short. */
function varsOf(cs) {
  const out = {}
  for (const [k, name] of Object.entries(VARS)) {
    const v = cs.getPropertyValue(name).trim()
    if (v) out[k] = v
  }
  return out
}

/** One anchor's diagnostic record: size + the layout props that cause the bugs. */
function snapEl(el, win) {
  const r = el.getBoundingClientRect()
  const cs = win.getComputedStyle(el)
  const rec = { sel: selOf(el), w: round(r.width), h: round(r.height), minW: cs.minWidth }
  if (cs.display && cs.display !== 'block') rec.disp = cs.display
  const vars = varsOf(cs)
  if (Object.keys(vars).length) rec.vars = vars
  return rec
}

/** Whether an element carries a Vue scoped-style attribute (`data-v-*`). Its
 *  ABSENCE on a container is the tell for an unscoped `<style>` (where `:deep()`
 *  silently dies) — the #172 root cause. Cheap boolean, no values leaked. */
function isScoped(el) {
  return Array.from(el.attributes || []).some((a) => a.name.startsWith('data-v-'))
}

/** The primary hand box's ancestry — the chain is where sizing/scope bugs show. */
function ancestryOf(el, win) {
  const chain = []
  let e = el
  for (let i = 0; i < ANCESTRY_DEPTH && e && e.tagName !== 'BODY' && e.tagName !== 'HTML'; i++) {
    const cs = win.getComputedStyle(e)
    chain.push({ sel: selOf(e), w: round(e.getBoundingClientRect().width), minW: cs.minWidth, scoped: isScoped(e) })
    e = e.parentElement
  }
  return chain
}

/**
 * Gather the layout block. Returns null when there's no DOM (tests / SSR) or no
 * table components on screen, so callers can spread it without a guard.
 *
 * @param {object} [deps]
 * @param {Document} [deps.doc]
 * @param {Window} [deps.win]
 * @returns {{anchors: object[], ancestry: object[], truncated: boolean}|null}
 */
export function collectLayout({ doc = globalThis.document, win = globalThis } = {}) {
  try {
    if (!doc?.querySelectorAll || typeof win.getComputedStyle !== 'function') return null
    const seen = new Set()
    const anchors = []
    for (const sel of ANCHORS) {
      for (const el of doc.querySelectorAll(sel)) {
        if (seen.has(el)) continue
        seen.add(el)
        anchors.push(snapEl(el, win))
        if (anchors.length >= MAX_ELEMENTS) break
      }
      if (anchors.length >= MAX_ELEMENTS) break
    }
    if (!anchors.length) return null
    const primary = doc.querySelector('.holding') || doc.querySelector('.seat-panel')
    return {
      anchors,
      ancestry: primary ? ancestryOf(primary, win) : [],
      truncated: anchors.length >= MAX_ELEMENTS,
    }
  } catch {
    return null
  }
}

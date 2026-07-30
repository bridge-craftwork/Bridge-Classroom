// Pure grid-arranger math: seat rotation (§1) and the per-region scale clamp
// (§3) of grid-arranger-spec.md. No Vue, no DOM — unit-testable; the Vue
// GridArrangement component measures geometry and calls these.

import { rowReservePx, handReservePx } from '../components/handMetrics.js'

// Seats clockwise (play order). LHO = next clockwise = screen-left.
const CLOCK = ['N', 'E', 'S', 'W']
// Area by clockwise offset from the anchor: anchor→s, LHO→w, partner→n, RHO→e.
const AREA_BY_OFFSET = ['s', 'w', 'n', 'e']

/**
 * Which grid area a seat occupies, given the anchor seat (§1 rotation).
 * anchor → 's' (bottom); its partner → 'n'; LHO → 'w' (screen-left); RHO → 'e'.
 * @returns {'n'|'e'|'s'|'w'}
 */
export function seatToArea(seat, anchorSeat = 'S') {
  const off = (CLOCK.indexOf(seat) - CLOCK.indexOf(anchorSeat) + 4) % 4
  return AREA_BY_OFFSET[off]
}

/** Anchor seat for an orientation: 'south' is compass-fixed; 'hero' rotates. */
export function anchorFor(orientation, heroSeat = 'S') {
  return orientation === 'hero' ? (heroSeat || 'S') : 'S'
}

/** The seat facing `seat` across the table (partner): two clock steps away. */
export function partnerOf(seat) {
  return CLOCK[(CLOCK.indexOf(seat) + 2) % 4]
}

/**
 * The bottom corner the ACTION cluster (bidding box in bidding, Undo/Claim in play)
 * rides in — adjacent to the hero's column so it clusters with the hero rather than
 * sitting in a fixed compass corner (§ play bottom-pack). Hero in the LEFT column
 * (area 'w', a screen-left defender) → 'sw'; otherwise 'se' (a South or East hero,
 * and the default physical bidding-box position). Keyed on the hero's AREA, so it
 * follows the orientation anchor.
 * @param {'n'|'e'|'s'|'w'} heroArea
 * @returns {'se'|'sw'}
 */
export function actionCornerFor(heroArea) {
  return heroArea === 'w' ? 'sw' : 'se'
}

/**
 * A seat's role relative to the hero — 'hero', 'partner', or 'opponent'.
 * Keyed by compass seat, so labels attach to the seat and follow it under any
 * orientation anchor (the arranger rotates seat→area separately).
 */
export function seatRole(seat, heroSeat = 'S') {
  if (seat === heroSeat) return 'hero'
  if (seat === partnerOf(heroSeat)) return 'partner'
  return 'opponent'
}

/**
 * The per-region effective scale (§3). Grows to fill up to the role cap and
 * shrinks to fit when the region can't honor its size — never below the
 * legibility floor. This realizes the "grow-to-fill-up-to-cap" prose and the §6
 * prediction table (center grows to ~fit, periphery pinned at its 1.0 cap).
 *
 * NOTE: the spec pseudocode's `min(wish, …)` is superseded by the prose + the
 * prediction table (center must grow above wish=1.0 to ~1.5); `wish`
 * (--table-scale) is the neutral reference the caption reports against, not an
 * upper bound. If the captions later say wish should constrain differently, that
 * is a formula tweak decided from the gallery — flagged, not guessed.
 *
 * @param {{available:number, reserve:number, cap:number, floor?:number}} o
 * @returns {number}
 */
export function computeRegionScale({ available, reserve, cap, floor = 0.65 }) {
  if (!available || !reserve || reserve <= 0) return cap
  const fit = available / reserve
  return Math.max(floor, Math.min(cap, fit))
}

/**
 * ONE scale shared by the hand-bearing seat regions = min fit over the tracks
 * currently displaying a hand (§3, refined 2026-07-11) — never all four, or the
 * empty chip-only side cells (the narrowest tracks) would starve the hero.
 * Chips-only seats render at the cap-side value (`chipScale`) instead.
 *
 * @param {Array<{available:number, reserve:number}>} handBearing  per hand-bearing seat
 * @param {{cap:number, floor?:number}} o
 * @returns {number}
 */
export function uniformSeatScale(handBearing, { cap, floor = 0.65 }) {
  if (!handBearing.length) return cap
  const fits = handBearing.map(({ available, reserve }) =>
    available && reserve > 0 ? available / reserve : cap,
  )
  return Math.max(floor, Math.min(cap, Math.min(...fits)))
}

/** Cap-side value for chip-only seats / empty peripheral regions. */
export function capSide(cap) {
  return cap
}

/** Reserve widths (px, 1.0×) — re-exported for the component. `rowReservePx` is the
 *  N-card worst case; `handReservePx` is a specific hand's actual widest suit row. */
export { rowReservePx, handReservePx }

// ── The height fit, as a pure solve ──────────────────────────────────────────
// The width pass is one-directional; height is the measured input (§ symmetric
// allocator). The ORIGINAL fit modelled the stack as "seat rows (scale with the
// seat scale) + a fixed remainder", and shrank the seats until it fit.
//
// Two rows routinely break that model, and both were mis-costed:
//   · the TOP row is bound by the NW cluster (glyph + status + transport: 235px
//     against North's 188), so shrinking the hands buys nothing there;
//   · the MIDDLE row is bound by the CENTRE at review (220 vs 188) — #359 saw
//     this and let the centre join the fit, but still costed the row as seat-driven.
// Counting a corner-bound row as scalable OVER-predicts what the hands can pay, so
// every pass undershoots and the stack creeps down onto the fold from above — the
// residual that survived #363.
//
// Here each ROW is `max(fixed, scalable × k)`: a row bound by a fixed corner
// correctly contributes nothing, and one bisection on `k` solves the whole stack
// in a single pass instead of converging over three.
//
// `kind` per measured region:
//   'seat'   — a seat area; height ∝ the seat scale. `hand: true` marks the ones
//              actually SHOWING a hand: every seat area scales, but only a hand is a
//              legitimate thing to equalise the stage against. A chip is not a target
//              (that mistake would match a 256px auction to a 91px name badge).
//   'center' — the stage; its target is decided by the ORDER OF SPENDING below.
//   'action' — a corner whose cap is the `se: 'seats'` RELATIONSHIP, so it rides
//              min(1, seatScale): it does NOT shrink until the seats pass below 1.0.
//   'fixed'  — everything else (NW status cluster, the NE reference auction).
//
/**
 * @param {Object} o
 * @param {Array<Array<{area:string,h:number,kind:string}>>} o.rows measured regions per grid row
 * @param {number} o.gridH        measured grid height (px)
 * @param {number} o.heightBudget px available before the fold
 * @param {number} o.seatScale    the seat scale as currently rendered
 * @param {number} o.centerScale  the centre scale as currently rendered
 * @param {number} [o.floor]      legibility floor
 * @param {number} [o.centerFloor] the centre's own floor (config regionFloors)
 * @returns {{seatTarget:number, centerTarget:number|null, centerMode:string}|null}
 */
export function solveHeightFit({ rows, gridH, heightBudget, seatScale, centerScale, floor = 0.65, centerFloor = floor }) {
  if (!Array.isArray(rows) || !rows.length || !(seatScale > 0) || !(centerScale > 0)) return null
  const mid = rows[1] || []
  const centerM = mid.find((m) => m.kind === 'center')
  // The equalisation PEER is a hand, not merely a seat area — see `kind` above.
  const midHands = mid.filter((m) => m.kind === 'seat' && m.hand).map((m) => m.h)
  const midSeatH = midHands.length ? Math.max(...midHands) : 0

  // ORDER OF SPENDING — what gives, and in what order (Rick, 2026-07-30: "equalise
  // the middle row"; supersedes the cap-at-natural half of #363).
  //
  // 'equalise' — the middle row carries HANDS, so the centre has a peer to be
  //   measured against: it renders at the same height as the hands beside it.
  //   Nothing about the stage's content says it deserves to be the tallest thing in
  //   its own row, and the height it takes above them is height the hands lose.
  // 'natural'  — the middle row carries no hand (bidding: E/W are chips), so there
  //   is no peer height to equalise TO — a chip is not a target. Fall back to #363:
  //   the centre's growth ABOVE natural is discretionary, so spend that first.
  // 'fixed'    — the centre is already the smaller party; leave it alone.
  let centerMode = 'fixed'
  if (centerM) {
    if (midSeatH > 0) centerMode = 'equalise'
    else if (centerScale > 1.01) centerMode = 'natural'
  }

  const seatCeil = Math.min(1, seatScale)
  const hAt = (m, k) => {
    if (m.kind === 'seat') return m.h * k
    // The action corner tracks min(1, seatScale): flat while the seats are above
    // natural, then proportional. Modelling it as plainly proportional would promise
    // height the corner can't give back.
    if (m.kind === 'action') return seatCeil > 0 ? m.h * (Math.min(1, seatScale * k) / seatCeil) : m.h
    if (m.kind === 'center') {
      // Rides the hands beside it, but only DOWNWARD: the fit exists to reclaim
      // height, so a centre that is already the smaller party is left alone rather
      // than grown to match. Evaluating this at the solved k (not at today's sizes)
      // is what makes it hold — equalising against the CURRENT hands just hands the
      // title back the moment those hands shrink past it, which is what the first
      // cut did: the centre matched at 202 vs 203, the seats then went to 173, and
      // the stage was the tallest thing in its row again.
      if (centerMode === 'equalise') return Math.min(m.h, midSeatH * k)
      if (centerMode === 'natural') return m.h / centerScale
      return m.h
    }
    return m.h
  }
  const rowH = (ms, k) => ms.reduce((h, m) => Math.max(h, hAt(m, k)), 0)
  // Deltas against the MEASURED rows, so padding, margins and any row-sizing mode
  // cancel out: predicted(1) is the measured height by construction.
  const measured = rows.map((ms) => ms.reduce((h, m) => Math.max(h, m.h), 0))
  const predicted = (k) => rows.reduce((t, ms, i) => t + (rowH(ms, k) - measured[i]), gridH)

  const kMin = Math.min(1, floor / seatScale)
  let k = 1
  if (predicted(1) > heightBudget) {
    // Monotone in k → bisect for the LARGEST k that fits. If even kMin overflows,
    // k lands on kMin and the page scrolls (the legibility floor is the pressure
    // valve — a small scroll beats illegible cards).
    let lo = kMin, hi = 1
    for (let i = 0; i < 24; i++) {
      const m = (lo + hi) / 2
      if (predicted(m) <= heightBudget) lo = m
      else hi = m
    }
    k = lo
  }

  const seatTarget = Math.max(floor, seatScale * k)
  let centerTarget = null
  if (centerMode === 'equalise') {
    const h = Math.min(centerM.h, midSeatH * k)
    centerTarget = Math.max(centerFloor, Math.min(centerScale, (centerScale * h) / centerM.h))
  } else if (centerMode === 'natural') {
    centerTarget = 1
  }
  // Round DOWN, not to nearest: the solve produces a CEILING ("at most this"), and
  // rounding 0.786 up to 0.79 hands back the last two pixels it just took away — which
  // is precisely how the stack kept ending a hair below the fold.
  const down2 = (x) => Math.max(floor, Math.floor(x * 100) / 100)
  return { seatTarget: down2(seatTarget), centerTarget: centerTarget == null ? null : down2(centerTarget), centerMode }
}

// ── Layout ledger (the one-directional allocator, as a pure function) ─────────
// The 3×3 column topology is fixed (n-absorption is a ROW change, not a column
// one), so it's hardcoded here; everything else is input.
const LEDGER_COLUMNS = [['nw', 'w', 'sw'], ['n', 'center', 's'], ['ne', 'e', 'se']]
const LEDGER_COL_OF = { nw: 0, w: 0, sw: 0, n: 1, center: 1, s: 1, ne: 2, e: 2, se: 2 }
// Row topology (top / middle / bottom) — the vertical companion to the columns.
// Seat areas that collapse (a hidden hand) leave a PHANTOM band unless absorbed:
// `n`-absorption lifts the stage when the top-centre seat is empty, but a hidden
// `s` (e.g. the declarer in a defence scene) leaves the bottom band empty.
const LEDGER_ROWS = [['nw', 'n', 'ne'], ['w', 'center', 'e'], ['sw', 's', 'se']]
const SEAT_AREAS = new Set(['n', 'e', 's', 'w'])
const round2 = (x) => Math.round(x * 100) / 100

/**
 * Compute the full layout ledger from a width budget, occupancy, reserves and
 * priority tiers — no DOM, no measurement of rendered content (grid-arranger-spec
 * §3, one-directional sizing). The render path applies this; the bounding-box
 * diagnostic reads it; the walker saves it beside each capture.
 *
 * @param {Object} o
 * @param {number} o.budget                 px the shell handed the grid (content box)
 * @param {string[]} o.occupied             occupied area names this deal
 * @param {Object<string,number>} o.reserves per-area reserve WIDTH (px, 1.0×)
 * @param {Array<string[]|string>} o.tiers  importance tiers (each a list of areas)
 * @param {number} o.seatReserve            a 7-card row reserve (px, 1.0×)
 * @param {string[]} [o.handBearingAreas]   seat areas currently showing a hand
 * @param {number} [o.cellGap]   designed inter-region gap (px), default 6
 * @param {number} [o.actionHandGap]  extra gap on the bidding box's hand side, default 14
 * @param {number} [o.floor]     legibility floor, default 0.65
 * @param {[number,number,number]} [o.columnWeights]  the config's `tracks.columns` fr weights,
 *   the PROPORTIONAL growth basis for the caps pass: a column grows only toward its fr share of
 *   the budget (not greedily to its cap), so the stage stays geometry-bound (~1.3 at desktop) and
 *   the cap is a ceiling that binds only on very wide screens. Default [1,1,1] (equal). This is why
 *   the growth restores the pre-rewrite fr behaviour (center a fixed fraction of the budget) rather
 *   than ballooning to the cap the moment there's surplus.
 * @param {Object<string,number|string>} [o.caps]  per-role scale CEILINGS (§2 scale.caps):
 *   { center, seats, nw, ne, se, sw }. `center` caps the stage; `seats` caps the four seat
 *   areas (n/e/s/w); a corner caps that corner. A corner value of the STRING `'seats'` is
 *   the SE↔seats RELATIONSHIP (the action cluster never renders larger than the seats) →
 *   resolved to min(1, seatScale). Omitted / any missing role defaults to 1.0, which makes
 *   the caps pass a no-op — so a caller that passes no caps gets the pre-caps `min(1, fit)`
 *   behaviour byte-for-byte (grid-arranger-spec §3.4 caps-wiring, 2026-07-12).
 * @returns {LayoutLedger}
 */
export function computeLayoutLedger(o) {
  const { budget, occupied, reserves, tiers, seatReserve, handBearingAreas = [], cellGap = 6, actionHandGap = 14, floor = 0.65, floors = {}, caps = {}, columnWeights = [1, 1, 1], capFloorAtNeed = false } = o
  const occ = new Set(occupied)
  // Per-role cap resolution (§2 scale.caps). A seat area (n/e/s/w) uses caps.seats; the
  // stage uses caps.center; a corner its own. The 'seats' RELATIONSHIP string caps at 1.0
  // for column GROWTH (its real ceiling min(1, seatScale) can only be ≤ 1) and applies the
  // seat-relationship at scale time (below). Missing → 1.0 (no growth above natural).
  const capRaw = (area) => (area === 'center' ? caps.center : SEAT_AREAS.has(area) ? caps.seats : caps[area])
  const isSeatsRel = (area) => { const v = capRaw(area); return v === 'seats' || v === 'seat' }
  const numericCap = (area) => { const v = capRaw(area); if (isSeatsRel(area)) return 1; return typeof v === 'number' && v > 0 ? v : 1 }
  const seatsCap = (typeof caps.seats === 'number' && caps.seats > 0) ? caps.seats : 1
  const tierList = (tiers && tiers.length ? tiers : [['center'], ['n', 'e', 's', 'w'], ['nw', 'ne', 'se', 'sw']]).map((t) => (Array.isArray(t) ? t : [t]))
  const tierOf = (areas) => { let best = tierList.length; for (const a of areas) { const i = tierList.findIndex((t) => t.includes(a)); if (i >= 0 && i < best) best = i } return best }

  const columns = LEDGER_COLUMNS.map((areas, index) => {
    const cOcc = areas.filter((a) => occ.has(a))
    const need = cOcc.length ? Math.max(...cOcc.map((a) => reserves[a] ?? 0)) : 0
    // capTarget = the widest the column can usefully grow to: the max over its regions of
    // cap×reserve (each region clamps to its OWN cap, so the column grows to satisfy the
    // greediest). ≥ need always (numericCap ≥ 1). Drives the caps growth pass below.
    // A column's growth CEILING. `capFloorAtNeed` raises it to at least the column's own
    // natural need, which is the fix for the height-collapse bug. Every caller in the app
    // passes it; the option survives so the regression test can pin both sides of it:
    //
    // caps.seats is lowered by the HEIGHT fit (capsWithHeight) when the stack is too
    // tall. Because the ceiling is max(cap × reserve) over a column's members, that
    // height clamp also caps the column's WIDTH — and column 0 is the one column with
    // nothing but a seat to defend it (NW's glyph reserves 89 against NE's auction 220
    // and the centre's 1.8 cap). At 1521×784 that put col0 at 117 against col2's 220
    // for identical 6-card hands, and uniformSeatScale then dragged ALL FOUR hands to
    // the 0.65 floor — leaving ~251px of allocated width unused beside North.
    //
    // A cap answers "how large may this RENDER", never "how narrow must this column
    // be". Conflating the two is the defect; clamping the ceiling up to `need` keeps
    // the height fit doing what it is for (shrinking the rendered scale) without
    // letting it starve a column below the width its own content asked for.
    const rawCapTarget = cOcc.length ? Math.max(...cOcc.map((a) => numericCap(a) * (reserves[a] ?? 0))) : 0
    const capTarget = capFloorAtNeed ? Math.max(need, rawCapTarget) : rawCapTarget
    const margin = cOcc.length ? 2 * cellGap + (cOcc.includes('se') ? actionHandGap : 0) : 0
    return { index, occupied: cOcc, need, capTarget, margin, full: need ? need + margin : 0, tier: cOcc.length ? tierOf(cOcc) : tierList.length, allocated: 0 }
  })

  // Allocation (§3, amended 2026-07-12 — floor-protection / corner rule). Every
  // occupied column first reserves floor × need (its OVERFLOW THRESHOLD — the
  // least it can render legally), whatever its tier. The surplus then grows
  // columns toward their natural need by TIER priority: a higher tier is
  // satisfied whole before a lower one, and the first tier that can't fit SHARES
  // the remainder proportionally. So a column only renders below the floor
  // ('overflow' / starved) when even the floor-minimums can't all fit — never
  // while another column holds width above its own floor. This generalises the
  // corner-occupant column minimum to all four corners (a lone NW/NE/SE/SW no
  // longer starves under a heavier sibling column while the arithmetic has room).
  const content = [0, 0, 0]
  const occCols = columns.filter((c) => c.full > 0)
  const contentBudget = budget - occCols.reduce((s, c) => s + c.margin, 0)
  // Per-region legibility floor (config `scale.regionFloors`), defaulting to the
  // global one. A region whose content is REFERENCE rather than working material can
  // legitimately go smaller — the double-dummy table at review is the case that
  // forced this: pinned at 0.65 it could not shrink far enough to sit beside the
  // South hand at laptop-half, so it painted over it. Same reasoning as the NE
  // reference-auction floor ruling. Unset regions are unchanged, so A1 is untouched.
  const floorOf = (area) => (typeof floors[area] === 'number' ? floors[area] : floor)
  // A COLUMN's floor-minimum is the widest of its regions' own floor-minimums — each
  // region may floor at a different fraction of its own reserve, so this is a max over
  // (floor × reserve), not `columnFloor × need`.
  const floorContent = (c) =>
    c.occupied.length ? Math.max(...c.occupied.map((a) => floorOf(a) * (reserves[a] ?? 0))) : 0
  const sumFloor = occCols.reduce((s, c) => s + floorContent(c), 0)
  const orderedTiers = [...new Set(occCols.map((c) => c.tier))].sort((a, b) => a - b)
  // Grow occupied columns from their current allocation toward `target(c)` by TIER
  // priority: a higher tier is satisfied whole before a lower one, and the first tier
  // that can't fit SHARES the remaining surplus proportionally. Returns leftover surplus.
  const growByTier = (surplus, target) => {
    for (const t of orderedTiers) {
      if (surplus <= 0) break
      const cols = occCols.filter((c) => c.tier === t)
      const growth = cols.reduce((s, c) => s + Math.max(0, target(c) - content[c.index]), 0)
      if (growth <= 0) continue
      if (surplus >= growth) { for (const c of cols) content[c.index] = target(c); surplus -= growth }
      else { const r = surplus / growth; for (const c of cols) content[c.index] += Math.max(0, target(c) - content[c.index]) * r; surplus = 0 }
    }
    return surplus
  }
  if (contentBudget <= sumFloor) {
    // Not even the floor-minimums fit — shrink them proportionally (all starve).
    const ratio = sumFloor > 0 ? Math.max(0, contentBudget) / sumFloor : 0
    for (const c of occCols) content[c.index] = floorContent(c) * ratio
  } else {
    for (const c of occCols) content[c.index] = floorContent(c)
    // Pass 1 — grow to NATURAL need (1.0×) by tier. This is the whole allocation when no
    // caps are supplied (caps default 1.0 → capTarget == need → pass 2 is a no-op), so the
    // tight-budget invariants — floor protection, periphery-compresses-together — are
    // unchanged from the pre-caps allocator.
    let surplus = growByTier(contentBudget - sumFloor, (c) => c.need)
    // Pass 2 — caps (grid-arranger-spec §3.4, 2026-07-12). Only reached once every column
    // has its natural need AND surplus remains: grow columns BEYOND need toward their fr
    // SHARE of the budget, capped at capTarget, by the same tier priority, BEFORE the
    // leftover spills to outer margin. Growing to the fr share (not straight to the cap) is
    // what restores the pre-rewrite behaviour: the stage is a fixed fraction of the budget
    // (geometry-bound, ~1.3 desktop), and the cap only binds on a very wide screen. A side
    // column can't grow (its capTarget == need — periphery cap 1.0), so only the stage and
    // hand-bearing columns stretch; the rest becomes outer margin, preserving clustering.
    const sumW = columnWeights.reduce((s, w) => s + (w > 0 ? w : 0), 0) || 1
    const frShare = (c) => ((columnWeights[c.index] > 0 ? columnWeights[c.index] : 0) / sumW) * budget
    surplus = growByTier(surplus, (c) => Math.min(frShare(c), c.capTarget))
  }
  columns.forEach((c) => { c.allocated = content[c.index] })
  const colWidths = columns.map((c) => (content[c.index] ? content[c.index] + c.margin : 0))
  const outerMargin = Math.max(0, budget - colWidths.reduce((a, b) => a + b, 0))

  // Per-region scale = min(cap, allocated/reserve), floored. Record the BINDING
  // constraint and the losing candidates — the diagnosis the ledger exists for.
  // Binding = which constraint set the scale. The ceiling is the region's CAP: at
  // cap 1.0 the ceiling is 'natural' (the region is at its natural size, the pre-caps
  // meaning); above 1.0 the ceiling is 'cap' (grown to a role ceiling > 1). 'overflow'
  // (fit < floor) is the STARVED state: even clamped to the floor the region can't
  // render in its allocation (alloc < floor × reserve) — distinct from 'floor' (pinned
  // at the legibility floor, but legal). 'budget' is the geometry-bound middle: below
  // the cap, above the floor (shrunk below 1.0 when cap 1.0, or grown between 1.0 and
  // the cap when cap > 1.0) — the region rendering at exactly its fit.
  const entry = (area, reserve, colContent, tier, cap) => {
    const fit = reserve > 0 ? colContent / reserve : 1
    const rFloor = floorOf(area)
    const scale = Math.max(rFloor, Math.min(cap, fit))
    const ceil = cap > 1 + 1e-6 ? 'cap' : 'natural'
    let binding, losing
    if (fit >= cap - 1e-6) { binding = ceil; losing = [`budget:${round2(fit)}`] }
    else if (fit < rFloor - 1e-6) { binding = 'overflow'; losing = [`budget:${round2(fit)}`, `${ceil}:${cap}`, `floor:${rFloor}`] }
    else if (fit <= rFloor + 1e-6) { binding = 'floor'; losing = [`budget:${round2(fit)}`, `${ceil}:${cap}`] }
    else { binding = 'budget'; losing = [`${ceil}:${cap}`, `floor:${rFloor}`] }
    return { reserve, allocated: Math.round(colContent), scale: round2(scale), tier, cap: round2(cap), binding, losing }
  }
  const regions = {}
  for (const c of columns) for (const a of c.occupied) regions[a] = entry(a, reserves[a] ?? 0, content[c.index], c.tier, numericCap(a))

  // Uniform seat scale over the hand-bearing seats (min fit, capped at the seats cap);
  // overrides each seat's individual scale so hands never differ in size on one deal.
  const hb = handBearingAreas.filter((a) => occ.has(a))
  let seatScale = 1
  if (hb.length) {
    seatScale = Math.max(floor, Math.min(seatsCap, ...hb.map((a) => (content[LEDGER_COL_OF[a]] || 0) / seatReserve)))
    hb.forEach((a) => { if (regions[a]) regions[a].scale = round2(seatScale) })
  }
  // The SE↔seats RELATIONSHIP (§2 caps.se: 'seats'): a region whose cap is the string
  // 'seats' (the action cluster) may never render larger than the seats — its ceiling is
  // min(1, seatScale). Applied after seatScale is known; the region already clamped to ≤ 1
  // via numericCap, so this only tightens it further when the hero's hand is below 1.0×.
  for (const a of Object.keys(regions)) {
    if (!isSeatsRel(a)) continue
    const seCeil = Math.min(1, seatScale)
    const clamped = Math.max(floor, Math.min(regions[a].scale, seCeil))
    if (Math.abs(clamped - regions[a].scale) > 1e-9) { regions[a].scale = round2(clamped); regions[a].binding = 'cap' }
    regions[a].cap = round2(seCeil)
  }

  // Row bands (top / middle / bottom) — the vertical companion to `columns`, so
  // a hidden seat's empty band is legible in the ledger, not just the image.
  // `phantom` = hidden SEAT areas that leave a dead band. The CENTRE-column seats
  // `n` and `s` are absorbed by the stage when empty (n-absorption lifts the stage,
  // s-absorption drops it — grid-arranger-spec §1 occupancy model), so they never
  // phantom; only the SIDE seats `w`/`e` leave a genuine dead band (the stage can't
  // absorb sideways). This is the play bottom-pack cure for the "phantom South":
  // a hidden declarer's `s` cell is now stage, not a void.
  const rows = LEDGER_ROWS.map((areas, index) => {
    const occupied = areas.filter((a) => occ.has(a))
    const collapsed = areas.filter((a) => !occ.has(a))
    const phantom = collapsed.filter((a) => SEAT_AREAS.has(a) && a !== 'n' && a !== 's')
    return { index, occupied, collapsed, phantom }
  })

  return {
    schemaVersion: 1,
    budget: Math.round(budget),
    // Inputs block first — the stage's CAUSES (budget, occupancy, tiers, reserve
    // versions), so a ledger diff shows which input changed, not just the outputs.
    inputs: { budget: Math.round(budget), occupied: [...occ].sort(), tiers: tierList, reserves: Object.fromEntries([...occ].sort().map((a) => [a, Math.round(reserves[a] ?? 0)])) },
    columns: columns.map((c) => ({ index: c.index, occupied: c.occupied, need: Math.round(c.need), capTarget: Math.round(c.capTarget), margin: c.margin, tier: c.tier, allocated: Math.round(c.allocated), width: Math.round(colWidths[c.index]) })),
    rows,
    regions,
    seats: { scale: round2(seatScale), handBearing: hb },
    outerMargin: Math.round(outerMargin),
    colWidths: colWidths.map((w) => Math.round(w)),
  }
}

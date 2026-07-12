// Pure grid-arranger math: seat rotation (§1) and the per-region scale clamp
// (§3) of grid-arranger-spec.md. No Vue, no DOM — unit-testable; the Vue
// GridArrangement component measures geometry and calls these.

import { rowReservePx } from '../components/handMetrics.js'

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

/** Reserve width (px, 1.0×) for an N-card seat row — re-exported for the component. */
export { rowReservePx }

// ── Layout ledger (the one-directional allocator, as a pure function) ─────────
// The 3×3 column topology is fixed (n-absorption is a ROW change, not a column
// one), so it's hardcoded here; everything else is input.
const LEDGER_COLUMNS = [['nw', 'w', 'sw'], ['n', 'center', 's'], ['ne', 'e', 'se']]
const LEDGER_COL_OF = { nw: 0, w: 0, sw: 0, n: 1, center: 1, s: 1, ne: 2, e: 2, se: 2 }
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
 * @returns {LayoutLedger}
 */
export function computeLayoutLedger(o) {
  const { budget, occupied, reserves, tiers, seatReserve, handBearingAreas = [], cellGap = 6, actionHandGap = 14, floor = 0.65 } = o
  const occ = new Set(occupied)
  const tierList = (tiers && tiers.length ? tiers : [['center'], ['n', 'e', 's', 'w'], ['nw', 'ne', 'se', 'sw']]).map((t) => (Array.isArray(t) ? t : [t]))
  const tierOf = (areas) => { let best = tierList.length; for (const a of areas) { const i = tierList.findIndex((t) => t.includes(a)); if (i >= 0 && i < best) best = i } return best }

  const columns = LEDGER_COLUMNS.map((areas, index) => {
    const cOcc = areas.filter((a) => occ.has(a))
    const need = cOcc.length ? Math.max(...cOcc.map((a) => reserves[a] ?? 0)) : 0
    const margin = cOcc.length ? 2 * cellGap + (cOcc.includes('se') ? actionHandGap : 0) : 0
    return { index, occupied: cOcc, need, margin, full: need ? need + margin : 0, tier: cOcc.length ? tierOf(cOcc) : tierList.length, allocated: 0 }
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
  const floorContent = (c) => floor * c.need
  const sumFloor = occCols.reduce((s, c) => s + floorContent(c), 0)
  if (contentBudget <= sumFloor) {
    // Not even the floor-minimums fit — shrink them proportionally (all starve).
    const ratio = sumFloor > 0 ? Math.max(0, contentBudget) / sumFloor : 0
    for (const c of occCols) content[c.index] = floorContent(c) * ratio
  } else {
    for (const c of occCols) content[c.index] = floorContent(c)
    let surplus = contentBudget - sumFloor
    for (const t of [...new Set(occCols.map((c) => c.tier))].sort((a, b) => a - b)) {
      if (surplus <= 0) break
      const cols = occCols.filter((c) => c.tier === t)
      const growth = cols.reduce((s, c) => s + (c.need - floorContent(c)), 0)
      if (surplus >= growth) {
        for (const c of cols) content[c.index] = c.need
        surplus -= growth
      } else {
        const r = growth > 0 ? surplus / growth : 0
        for (const c of cols) content[c.index] = floorContent(c) + (c.need - floorContent(c)) * r
        surplus = 0
      }
    }
  }
  columns.forEach((c) => { c.allocated = content[c.index] })
  const colWidths = columns.map((c) => (content[c.index] ? content[c.index] + c.margin : 0))
  const outerMargin = Math.max(0, budget - colWidths.reduce((a, b) => a + b, 0))

  // Per-region scale = min(1, allocated/reserve), floored. Record the BINDING
  // constraint and the losing candidates — the diagnosis the ledger exists for.
  // Binding = which constraint set the scale. 'overflow' (fit < floor) is the
  // STARVED state: even clamped to the floor the region can't render in its
  // allocation (alloc < floor × reserve) — distinct from 'floor' (pinned exactly
  // at the legibility floor, but legal). 'budget' shrinks between floor and 1.
  const entry = (area, reserve, colContent, tier) => {
    const fit = reserve > 0 ? colContent / reserve : 1
    const scale = Math.max(floor, Math.min(1, fit))
    let binding, losing
    if (fit >= 1) { binding = 'natural'; losing = [`budget:${round2(fit)}`] }
    else if (fit < floor - 1e-6) { binding = 'overflow'; losing = [`budget:${round2(fit)}`, 'natural:1', `floor:${floor}`] }
    else if (fit <= floor + 1e-6) { binding = 'floor'; losing = [`budget:${round2(fit)}`, 'natural:1'] }
    else { binding = 'budget'; losing = ['natural:1', `floor:${floor}`] }
    return { reserve, allocated: Math.round(colContent), scale: round2(scale), tier, binding, losing }
  }
  const regions = {}
  for (const c of columns) for (const a of c.occupied) regions[a] = entry(a, reserves[a] ?? 0, content[c.index], c.tier)

  // Uniform seat scale over the hand-bearing seats (min fit); overrides each seat's
  // individual scale so hands never differ in size on one deal.
  const hb = handBearingAreas.filter((a) => occ.has(a))
  let seatScale = 1
  if (hb.length) {
    seatScale = Math.max(floor, Math.min(1, ...hb.map((a) => (content[LEDGER_COL_OF[a]] || 0) / seatReserve)))
    hb.forEach((a) => { if (regions[a]) regions[a].scale = round2(seatScale) })
  }

  return {
    schemaVersion: 1,
    budget: Math.round(budget),
    // Inputs block first — the stage's CAUSES (budget, occupancy, tiers, reserve
    // versions), so a ledger diff shows which input changed, not just the outputs.
    inputs: { budget: Math.round(budget), occupied: [...occ].sort(), tiers: tierList, reserves: Object.fromEntries([...occ].sort().map((a) => [a, Math.round(reserves[a] ?? 0)])) },
    columns: columns.map((c) => ({ index: c.index, occupied: c.occupied, need: Math.round(c.need), margin: c.margin, tier: c.tier, allocated: Math.round(c.allocated), width: Math.round(colWidths[c.index]) })),
    regions,
    seats: { scale: round2(seatScale), handBearing: hb },
    outerMargin: Math.round(outerMargin),
    colWidths: colWidths.map((w) => Math.round(w)),
  }
}

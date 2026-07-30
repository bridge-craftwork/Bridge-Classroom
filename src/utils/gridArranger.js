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
  const { budget, occupied, reserves, tiers, seatReserve, handBearingAreas = [], cellGap = 6, actionHandGap = 14, floor = 0.65, floors = {}, caps = {}, columnWeights = [1, 1, 1] } = o
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
    const capTarget = cOcc.length ? Math.max(...cOcc.map((a) => numericCap(a) * (reserves[a] ?? 0))) : 0
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

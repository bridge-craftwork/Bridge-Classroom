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

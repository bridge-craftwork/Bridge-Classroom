// Single source of truth for HandDisplay's suit-row unit geometry, at
// --table-scale: 1.0 / --suit-scale: 1.0, 'full' density (px).
//
// HandDisplay's scoped CSS reads `labelPx` / `gapPx` via CSS custom properties
// set on its root (so the render uses these exact numbers), and the grid arranger
// imports `rowReservePx()` to provision the uniform seat scale. Both layers share
// this module, so the render and the provisioning can't drift
// (grid-arranger-spec.md Reconciliation 4 — the 7-card reserve retired from
// HandDisplay's fit, #154, and promoted to the arranger's provisioning).
export const HAND_UNIT = {
  labelPx: 28, // .suit-symbol zone width — SHARED with HandDisplay CSS
  gapPx: 8,    // .suit-row symbol→cards gap — SHARED with HandDisplay CSS
  // Provisioning estimate of one card's advance (incl. inter-card space) at the
  // 24px base, sized to the wide "10" case. HandDisplay renders cards inline, so
  // this is the arranger's reserve estimate, NOT a CSS value — deliberately
  // generous so the reserve never under-fits (a slightly-large reserve only makes
  // the seat scale a hair smaller; HandDisplay then measures its real box and
  // runs its own compression cascade inside).
  cellPx: 32,
}

// Natural width (px, at 1.0× / full density) of an N-card suit row — the
// arranger's seat-scale reserve: label + symbol-gap + N·cell. The uniform seat
// scale is availableSeatTrackWidth / rowReservePx(7).
export function rowReservePx(cards = 7, u = HAND_UNIT) {
  return u.labelPx + u.gapPx + cards * u.cellPx
}

// Extra horizontal advance a two-glyph rank ("10"/"T", rendered "10") adds over a
// single-glyph card at the 24px base. Measured ~21px from real renders (a 5-card
// suit holding one "10" is ~217px vs rowReservePx(5)=196); rounded UP so a
// ten-heavy suit's reserve never under-fits.
export const TEN_EXTRA_PX = 24

// 'T' renders as "10"; some deal sources store the literal '10'. Both are two glyphs.
function isWideRank(rank) {
  const r = String(rank).toUpperCase()
  return r === 'T' || r === '10'
}

// Natural reserve WIDTH (px, 1.0×) of a HAND = its widest suit row, from the deal's
// ACTUAL cards rather than the 7-card worst case: label + gap + N·cell + (#tens)·extra,
// maxed over the four suits. Cards are the full holding (played cards are struck in
// the render, never removed from the hand), so this is the hand's WIDEST extent and is
// STABLE across the play of the deal — the seat scale won't creep up as cards are
// played (2026-07-13 report). Empty/absent hand → the 7-card reserve (safe fallback).
export function handReservePx(hand, u = HAND_UNIT) {
  if (!hand) return rowReservePx(7, u)
  let max = 0
  for (const suit of ['spades', 'hearts', 'diamonds', 'clubs']) {
    const cards = hand[suit] || []
    if (!cards.length) continue
    const tens = cards.filter(isWideRank).length
    const w = u.labelPx + u.gapPx + cards.length * u.cellPx + tens * TEN_EXTRA_PX
    if (w > max) max = w
  }
  return max || rowReservePx(7, u)
}

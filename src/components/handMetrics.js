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

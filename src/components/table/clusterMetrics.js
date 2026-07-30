// Single source of truth for the widths of the two SHELL-COMPOSED corner clusters,
// so the arranger provisions the column from the same number the cluster draws —
// the biddingBoxMetrics / boardIndicatorMetrics / auctionMetrics pattern.
//
// These clusters differ from those three in one way that shapes the whole design:
// their MEMBERSHIP is not fixed. A table owner sees the deal transport; an invited
// player (B3) sees none of it. The bidding box is present in bidding and gone in
// play. So a cluster cannot export "its width" as a constant — it exports a
// FUNCTION OF WHAT IS ACTUALLY RENDERED, and the shell (the only party that knows)
// calls it and hands the result to `BridgeTable :region-reserves`.
//
// The buttons take a fixed min-width from these same constants, so the metric is
// exact by construction rather than an estimate of text width.

export const CLUSTER_UNIT = {
  // Stacked transport buttons (NW): every button is min-width'd to the widest
  // label ("Restart cardplay"), so a stacked column is exactly this wide.
  stackedBtnPx: 148,
  // Side-by-side action buttons (SE): "Undo" and "Claim…" are short.
  inlineBtnPx: 78,
  gapPx: 8,
  // The board·dealer·vul glyph and the transport stack sit in the same NW column,
  // so the column is the wider of the two — not their sum (they stack vertically).
}

/**
 * NW transport cluster width (px, 1.0×). Stacked, so the width is one button —
 * but only if any button renders at all. A viewer with no transport (B3) gets 0,
 * which lets the caller fall back to the board glyph's own extent.
 */
export function dealControlsReservePx({ showRestart = true, showNext = true, showRestartCardplay = false } = {}) {
  const any = showRestart || showNext || showRestartCardplay
  return any ? CLUSTER_UNIT.stackedBtnPx : 0
}

/**
 * SE action cluster width (px, 1.0×). Undo and Claim sit side by side, so this is
 * additive — the one place these clusters grow horizontally.
 */
export function actionClusterReservePx({ showUndo = true, showClaim = false } = {}) {
  const n = (showUndo ? 1 : 0) + (showClaim ? 1 : 0)
  if (n === 0) return 0
  return n * CLUSTER_UNIT.inlineBtnPx + (n - 1) * CLUSTER_UNIT.gapPx
}

// DoubleDummyTable's natural width (px, 1.0×) — six columns (seat label + 4 suits
// + NT) at the component's own cell sizing, plus its border. It moves into SE at
// review, which is the one time that corner holds something much wider than the
// bidding box, so the arranger has to be told.
export const DD_UNIT = { seatColPx: 34, strainColPx: 33, strains: 5, borderPx: 2 }
export function doubleDummyReservePx(u = DD_UNIT) {
  return u.seatColPx + u.strains * u.strainColPx + u.borderPx
}

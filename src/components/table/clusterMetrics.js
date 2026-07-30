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

// ICON-ONLY transport (2026-07-29, Rick). The first cut used labelled buttons
// min-width'd to the widest label ("Restart cardplay") at 148px — visibly wider than
// their own text, and wide enough that NW's reserve grew from the glyph's ~89px to
// 148px, which starved the grid and collided with North at ~820px. Icons at 32px put
// NW back UNDER the glyph's own extent, so the transport is free: the corner reserves
// exactly what it reserved before the controls arrived. Meaning lives in the tooltip
// and the aria-label, which is also the accessible name.
export const CLUSTER_UNIT = {
  iconBtnPx: 32,
  // The transport WRAPS at two icons per row. Three in a line would be 108px —
  // still wider than the 89px glyph above it, so NW would keep growing and the
  // North collision could come back. Two per row is 70px: strictly under the glyph,
  // so the transport is genuinely free. The CSS max-width is derived from this.
  maxPerRow: 2,
  // "Claim…" keeps its word — it is rare, consequential, and has no obvious glyph.
  textBtnPx: 78,
  gapPx: 6,
}

/**
 * NW transport cluster width (px, 1.0×). A ROW of icon buttons, so it grows with the
 * count. A viewer with no transport (B3, or a kibitzing teacher) gets 0, which lets
 * the caller fall back to the board glyph's own extent.
 */
export function dealControlsReservePx({ showRestart = true, showNext = true, showRestartCardplay = false } = {}) {
  const n = (showRestart ? 1 : 0) + (showNext ? 1 : 0) + (showRestartCardplay ? 1 : 0)
  if (n === 0) return 0
  const perRow = Math.min(n, CLUSTER_UNIT.maxPerRow)
  return perRow * CLUSTER_UNIT.iconBtnPx + (perRow - 1) * CLUSTER_UNIT.gapPx
}

/** The CSS max-width that produces the wrap the metric assumes. */
export function dealControlsMaxWidthPx() {
  return CLUSTER_UNIT.maxPerRow * CLUSTER_UNIT.iconBtnPx + (CLUSTER_UNIT.maxPerRow - 1) * CLUSTER_UNIT.gapPx
}

/**
 * SE action cluster width (px, 1.0×). Undo (icon) and Claim (text) sit side by side.
 */
export function actionClusterReservePx({ showUndo = true, showClaim = false } = {}) {
  const parts = []
  if (showUndo) parts.push(CLUSTER_UNIT.iconBtnPx)
  if (showClaim) parts.push(CLUSTER_UNIT.textBtnPx)
  if (!parts.length) return 0
  return parts.reduce((a, b) => a + b, 0) + (parts.length - 1) * CLUSTER_UNIT.gapPx
}

// DoubleDummyTable's natural width (px, 1.0×). MEASURED, not derived: the first cut
// computed 201 from guessed cell widths and the real table lays out at 205, so the
// corner was under-provisioned and the arranger compressed it. Re-measured in the
// harness (offsetWidth, untransformed) at 205 across b1-review and b2-review; the
// +6 is a one-cell tolerance so a font tweak doesn't silently re-starve the corner.
// If DoubleDummyTable ever exports its own metric, delete this and import that.
export const DD_MEASURED_PX = 205
export function doubleDummyReservePx() {
  return DD_MEASURED_PX + 6
}

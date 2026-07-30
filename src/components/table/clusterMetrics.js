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

import { A1_BOARD_SIZE, boardIndicatorExtentPx } from '../boardIndicatorMetrics.js'

// ICON-ONLY transport (2026-07-29, Rick). The first cut used labelled buttons
// min-width'd to the widest label ("Restart cardplay") at 148px — visibly wider than
// their own text, and wide enough that NW's reserve grew from the glyph's ~89px to
// 148px, which starved the grid and collided with North at ~820px. Icons at 32px put
// NW back UNDER the glyph's own extent, so the transport is free: the corner reserves
// exactly what it reserved before the controls arrived. Meaning lives in the tooltip
// and the aria-label, which is also the accessible name.
export const CLUSTER_UNIT = {
  iconBtnPx: 32,
  // Below this the icons stop being a usable target, so the row is allowed to exceed
  // the glyph rather than shrink further. Nothing renders that many buttons today —
  // it's the escape hatch if something ever does.
  minIconBtnPx: 24,
  // "Claim…" keeps its word — it is rare, consequential, and has no obvious glyph.
  textBtnPx: 78,
  gapPx: 6,
}

// ONE ROW, always (2026-07-30, Rick: three buttons were wrapping to 2+1). The
// transport used to wrap at two icons per row, because three at full size is 108px —
// wider than the 89px board glyph it sits under, and NW growing past the glyph is what
// once collided with North. Both goals hold if the BUTTONS give way instead of the
// row: the icons shrink just enough that the whole transport still fits the glyph's
// extent, so the corner reserves exactly what it reserved before the controls arrived.
const SINGLE_ROW_MAX_PX = boardIndicatorExtentPx(A1_BOARD_SIZE)

/** Icon edge (px) for a transport of `n` buttons — full size until a row needs more
 *  than the glyph's width, then shrunk to fit (never below `minIconBtnPx`). */
export function dealControlsIconPx(n) {
  if (n <= 0) return 0
  const fit = Math.floor((SINGLE_ROW_MAX_PX - (n - 1) * CLUSTER_UNIT.gapPx) / n)
  return Math.max(CLUSTER_UNIT.minIconBtnPx, Math.min(CLUSTER_UNIT.iconBtnPx, fit))
}

/**
 * NW transport cluster width (px, 1.0×) — one row of icon buttons at the size
 * `dealControlsIconPx` gives them. A viewer with no transport (B3, or a kibitzing
 * teacher) gets 0, which lets the caller fall back to the board glyph's own extent.
 */
export function dealControlsReservePx({ showRestart = true, showNext = true, showRestartCardplay = false } = {}) {
  const n = (showRestart ? 1 : 0) + (showNext ? 1 : 0) + (showRestartCardplay ? 1 : 0)
  if (n === 0) return 0
  return n * dealControlsIconPx(n) + (n - 1) * CLUSTER_UNIT.gapPx
}

/** The widest the transport is allowed to lay out before its icons shrink. */
export function dealControlsMaxWidthPx() {
  return SINGLE_ROW_MAX_PX
}

/**
 * SE action cluster width (px, 1.0×). Undo and Claim sit side by side, both labelled.
 */
export function actionClusterReservePx({ showUndo = true, showClaim = false } = {}) {
  // Both are TEXT buttons: SE is sized by the bidding box, so words are free here.
  const parts = []
  if (showUndo) parts.push(CLUSTER_UNIT.textBtnPx)
  if (showClaim) parts.push(CLUSTER_UNIT.textBtnPx)
  if (!parts.length) return 0
  return parts.reduce((a, b) => a + b, 0) + (parts.length - 1) * CLUSTER_UNIT.gapPx
}

// DoubleDummyTable's natural width (px, 1.0×) in its CORNER (compact) form.
// MEASURED, not derived — the first cut computed 201 from guessed cell widths, the
// real table laid out at 205, and the corner was under-provisioned. Then the compact
// density (2026-07-29) squeezed the per-cell padding from 10px a side to 4px and the
// type from 13px to 11px, taking the table from 205 → 120: the air was ~40% of it.
// Re-measured in the harness with offsetWidth (untransformed); +6 is a one-cell
// tolerance so a font tweak doesn't silently re-starve the corner.
export const DD_COMPACT_MEASURED_PX = 120
export function doubleDummyReservePx() {
  return DD_COMPACT_MEASURED_PX + 6
}

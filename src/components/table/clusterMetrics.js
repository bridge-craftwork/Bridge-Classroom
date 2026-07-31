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
  // The transport's row HEIGHT — fixed, whatever the button count, so the controls
  // read as one consistent strip rather than resizing under you as a third button
  // appears at review.
  iconBtnPx: 32,
  // Below this a button stops being a usable target, so the row is allowed to exceed
  // the glyph rather than divide further. Nothing renders that many buttons today —
  // it's the escape hatch if something ever does.
  minIconBtnPx: 24,
  // "Claim…" keeps its word — it is rare, consequential, and has no obvious glyph.
  textBtnPx: 78,
  gapPx: 6,
}

// The transport SPANS the board glyph above it, and divides that width between however
// many buttons it has (2026-07-30, Rick: "center the vcr buttons under the board glyph
// — even better, scale them to use that width").
//
// It used to wrap at two icons per row, because three at a fixed 32px is 108px — wider
// than the 89px glyph, and NW growing past the glyph is what once collided with North.
// Spanning the glyph satisfies both at once and needs no centring rule: the row is the
// same width as the thing above it, so it is aligned by construction, and the corner
// reserves exactly what it reserved before the controls existed.
const GLYPH_W = boardIndicatorExtentPx(A1_BOARD_SIZE)

/** Button WIDTH (px) for a transport of `n` — the glyph's width divided between them
 *  (gaps taken off first), never below `minIconBtnPx`. Height is always `iconBtnPx`. */
export function dealControlsButtonWidthPx(n) {
  if (n <= 0) return 0
  const share = Math.floor((GLYPH_W - (n - 1) * CLUSTER_UNIT.gapPx) / n)
  return Math.max(CLUSTER_UNIT.minIconBtnPx, share)
}

/**
 * NW transport cluster width (px, 1.0×) — the glyph's width, since the row spans it.
 * (Only a button count large enough to hit the minimum width exceeds it.) A viewer
 * with no transport (B3, or a kibitzing teacher) gets 0, which lets the caller fall
 * back to the board glyph's own extent.
 */
export function dealControlsReservePx({ showRestart = true, showNext = true, showRestartCardplay = false } = {}) {
  const n = (showRestart ? 1 : 0) + (showNext ? 1 : 0) + (showRestartCardplay ? 1 : 0)
  if (n === 0) return 0
  // The glyph's width, except when the per-button minimum has forced the row wider.
  // Stating it as the glyph (rather than the summed buttons, which floor 1–2px short)
  // is what makes the row flush with the glyph's edges instead of a hair inside them.
  const buttons = n * dealControlsButtonWidthPx(n) + (n - 1) * CLUSTER_UNIT.gapPx
  return Math.max(Math.round(GLYPH_W), buttons)
}

/** The width the transport lays out to — the board glyph's extent. */
export function dealControlsMaxWidthPx() {
  return GLYPH_W
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
// Re-measured 2026-07-30 from the harness specimens at 1.0x, after `collapse` became
// the default. Collapsing makes the grid SHORTER (2 rows, h 60 vs 79) but marginally
// WIDER — the row label is now "NS" rather than "N", and a two-character label is a
// wider cell. 121 → 127. The old 120 + a 6px tolerance would have landed at 126 and
// under-reserved by a pixel; measuring beat assuming that the collapse could only
// shrink things.
export const DD_COMPACT_MEASURED_PX = 127
// Rotated form: 5 strain rows over N declarer columns, plus the strain-glyph column.
// MEASURED: 2 declarer columns (both pairs collapsed) → 72px; 4 → 90px. Roughly HALF
// the upright width, which is the whole point of offering it to a corner that is
// narrow rather than short — and it is taller in exchange (h 123 vs 60).
export const DD_ROTATED_MEASURED_PX = { 2: 72, 4: 90 }

/**
 * Natural WIDTH (px, 1.0x) of the DD table in its corner form.
 *
 * SHAPE-AWARE, because the component now renders in more than one shape and a reserve
 * that reports a single number would mis-provision the rest. This is the same trap
 * §6.2 hit with the auction: auctionReservePx() provisioned a NORMAL auction, so
 * compare mode systematically under-reserved. The shell knows which shape it asked
 * for, so the shell passes it — same division of labour as regionReserves.
 *
 * `rows` is how many rows the grid will actually show: 2 when a collapse merged both
 * partnerships (the common case), 4 when a pair disagrees. It only affects the
 * ROTATED width, where rows become columns.
 */
export function doubleDummyReservePx({ rotated = false, rows = 2 } = {}) {
  if (rotated) {
    // Rows become COLUMNS when rotated, so 3 rows is 3 declarer columns — wider than
    // 2 and nearly as wide as 4. Round UP to the 4-column measurement for anything
    // above a clean pair: under-reserving is the failure this function exists to
    // prevent, and the cost of over-reserving by a few px is nothing.
    const w = DD_ROTATED_MEASURED_PX[rows > 2 ? 4 : 2]
    return w + 6
  }
  return DD_COMPACT_MEASURED_PX + 6
}

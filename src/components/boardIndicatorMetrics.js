// Single source of truth for the BoardIndicator's rendered footprint, so the grid
// arranger provisions the NW status column from the SAME number the glyph draws
// (same pattern as biddingBoxMetrics / auctionMetrics — render and provisioning
// can't drift). The board·dealer·vul truncated pyramid (board-indicator-spec.md)
// reserves a flag-border slot around its size-S footprint:
//   slot   = gap (0.038·S) + border stroke (0.031·S) = 0.069·S
//   extent = S + 2·slot = S·(1 + 2·0.069) ≈ 1.138·S

// The footprint edge A1 renders the NW board glyph at (A1Scene passes this to
// BoardIndicator; the arranger reserves the matching column width).
export const A1_BOARD_SIZE = 78

// Full rendered extent (px, 1.0×) of a BoardIndicator of footprint edge `size`,
// including the always-reserved flag-border slot (spec §7).
export function boardIndicatorExtentPx(size = A1_BOARD_SIZE) {
  const slot = 0.069 * size
  return size + 2 * slot
}

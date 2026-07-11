// Single source of truth for AuctionTable's footprint at --table-scale: 1.0 (px).
// AuctionTable reads `minWidthPx` via a CSS var on its root, and the grid arranger
// imports `auctionReservePx()` to provision the auction region's scale — so the
// render and the provisioning share the numbers and can't drift (grid-arranger-
// spec Reconciliation 4, same pattern as handMetrics). Fixes the stale NE reserve
// that let the auction overflow its track at computed 1.0×.
export const AUCTION_UNIT = {
  // Four-column min-width at the component-standard 18px bid font (fix 1a). Down
  // from the old 308 (sized for the removed 26px enlargement) — the coupled fix:
  // a too-large reserve made the center-bidding auction shrink instead of grow
  // and over-shrank the NE reference. 220 lets the center grow toward its cap and
  // keeps NE ≈ 1.0 and contained.
  minWidthPx: 220,
  columns: 4,
}

// Natural width (px, 1.0×) the auction needs — its four-column grid min-width.
export function auctionReservePx(u = AUCTION_UNIT) {
  return u.minWidthPx
}

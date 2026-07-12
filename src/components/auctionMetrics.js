// Single source of truth for AuctionTable's footprint at --table-scale: 1.0 (px).
// AuctionTable reads `minWidthPx` via a CSS var on its root, and the grid arranger
// imports `auctionReservePx()` to provision the auction region's scale — so the
// render and the provisioning share the numbers and can't drift (grid-arranger-
// spec Reconciliation 4, same pattern as handMetrics). Fixes the stale NE reserve
// that let the auction overflow its track at computed 1.0×.
export const AUCTION_UNIT = {
  // Four-column min-width. CONFIRMED UNCHANGED after the glyph-scale restyle
  // (documentation/design/glyph-scale.md): calls went 18→24px and suits to the
  // cap-height rule, but the widest normal cell measures ~42px content + 12 padding
  // = 54px, ×4 ≈ 216 → the bigger glyphs fit the previously-roomy cells, so the
  // width reserve stays 220. (Only the auction's vertical footprint shrank — the
  // header band compressed ~⅓; that feeds the grid arranger's height reserve.)
  minWidthPx: 220,
  columns: 4,
}

// Natural width (px, 1.0×) the auction needs — its four-column grid min-width.
export function auctionReservePx(u = AUCTION_UNIT) {
  return u.minWidthPx
}

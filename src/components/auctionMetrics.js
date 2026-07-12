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
  // Vertical footprint (px, 1.0×), MEASURED from the gallery (scripts/measure):
  // the W/N/E/S header band and one call-round row. Used by the arranger to size
  // the bidding stage's growth reserve (grid-arranger-spec §1). These must track the
  // real AuctionTable row heights — if they overshoot, `growthReservePx(1)` exceeds
  // a one-round auction and the bottom-anchored auction floats down inside the
  // reserve (a per-round wobble); if they undershoot, it clips.
  headerRowPx: 26,
  roundRowPx: 33,
}

// Natural width (px, 1.0×) the auction needs — its four-column grid min-width.
export function auctionReservePx(u = AUCTION_UNIT) {
  return u.minWidthPx
}

// Growth-reserve HEIGHT (px, 1.0×) for a bottom-anchored bidding auction: enough
// vertical room for a realistic `rounds`-round auction (default 6 — real lesson
// auctions rarely exceed it). This is the stage's reserved height; the auction
// bottom-anchors within it and grows upward into the reserve, so the hand/BB hold
// position through any normal auction and only displace on a freak one. Bounded by
// design — NOT the viewport (the grid never reads viewport dimensions; the shell
// owns placement).
export function auctionGrowthReservePx(rounds = 6, u = AUCTION_UNIT) {
  return u.headerRowPx + rounds * u.roundRowPx
}

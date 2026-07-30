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
  // Vertical footprint (px, 1.0×), MEASURED from the gallery (scripts/measure-
  // auction.mjs, re-baselined 2026-07-12 after the glyph-scale restyle). These must
  // track the real AuctionTable row heights — if they overshoot, `growthReservePx(1)`
  // exceeds a one-round auction and the bottom-anchored auction floats down inside
  // the reserve; if they undershoot, it clips. The a1:gallery walk now ASSERTS the
  // rendered auction height equals `auctionGrowthReservePx(rounds)` within ±2px
  // (bidding len1/5/9), so a future typography pass that shifts these row heights
  // fails the walk instead of silently re-floating the auction.
  //
  // Measured full-table heights at 1.0×: 1 round → 54, 2 → 89, 3 → 124 (marginal
  // 35/round). So `roundRowPx = 35`, and `headerRowPx` is the FIXED overhead — the
  // W/N/E/S band (~16px) PLUS the table's 2px top/bottom borders — chosen so
  // `headerRowPx + rounds·roundRowPx` reproduces the measured heights exactly
  // (19 + 35 = 54, 19 + 70 = 89, 19 + 105 = 124). The restyle compressed the header
  // band (padding 8→2px, font 14→11px), which is why the pre-restyle 26/33 (reserve
  // 59) overshot the real 54 by 5px.
  headerRowPx: 19,
  roundRowPx: 35,
  // Extra height (px, 1.0×) a round costs when one of its cells is a "you vs BBA"
  // stack. MEASURED 2026-07-30 from the AuctionTable specimens (plain vs
  // diverged-stacked / diverged-shipped, --table-scale 1): a plain round row is
  // 43.5-44.5px; a row carrying a stacked cell is 70.2-76.2px. Delta 26-32; take
  // the worst case, since under-reserving is what report #49 looked like (the
  // auction cramped once compare was on) while over-reserving only leaves slack.
  //
  // The stacked cell is four lines (● You / call / ○ BBA / call) but drops to a
  // compact font, which is why it costs ~0.7× a row rather than 3× one.
  stackedRoundExtraPx: 32,
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
// How many auction ROUNDS a divergence map touches. The reserve is per-round, not
// per-cell: two divergences in the same round of four cost one taller row, not two.
// Keys are auction indices (0-based, dealer first), so the round is idx >> 2.
export function stackedRoundCount(divergedBids) {
  if (!divergedBids) return 0
  const rounds = new Set()
  for (const k of Object.keys(divergedBids)) {
    const idx = Number(k)
    if (Number.isInteger(idx) && idx >= 0) rounds.add(idx >> 2)
  }
  return rounds.size
}

// `stackedRounds` — how many of those rounds carry a "you vs BBA" stacked cell.
// The reserve provisions a NORMAL auction by default, so with the BBA comparison
// on it systematically under-reserved and the auction cramped (#49). The count
// comes from the shell, which is the only party that knows its own divergences —
// the same division of labour as `regionReserves`.
export function auctionGrowthReservePx(rounds = 6, stackedRounds = 0, u = AUCTION_UNIT) {
  const stacked = Math.max(0, Math.min(stackedRounds, rounds))
  return u.headerRowPx + rounds * u.roundRowPx + stacked * u.stackedRoundExtraPx
}

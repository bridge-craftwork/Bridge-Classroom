// Single source of truth for BiddingBox's natural width at --table-scale: 1.0 (px),
// after the glyph-ratio restyle (documentation/design/biddingbox-glyph-restyle.md).
// The grid arranger imports `biddingBoxReservePx()` to provision the action (se)
// column, so the render and the provisioning share the number and can't drift —
// same pattern as handMetrics / auctionMetrics. Post-restyle this is ~222px (down
// from the pre-restyle ~308), the honestly narrower form with bigger glyphs.
export const BIDDINGBOX_UNIT = {
  levelBtnPx: 26, // 7 level buttons wide (narrower; the digit fills a taller box)
  levels: 7,
  strainBtnPx: 38, // 5 strain buttons wide
  strains: 5,
  btnGapPx: 3,     // gap between buttons in a row
  padPx: 10,       // container padding (each side)
}

// Natural width (px, 1.0×): the widest inner row (levels vs strains) + container
// padding. Levels dominate (7 narrow buttons); strains are close behind.
export function biddingBoxReservePx(u = BIDDINGBOX_UNIT) {
  const levels = u.levels * u.levelBtnPx + (u.levels - 1) * u.btnGapPx
  const strains = u.strains * u.strainBtnPx + (u.strains - 1) * u.btnGapPx
  return Math.max(levels, strains) + 2 * u.padPx
}

// A1 (Scenario Mastery) table config — grid-arranger-spec.md §6.
// Plain JS object validated against the TableConfig @typedef (Reconciliation 1).
// Ships dark: production a1 stays on 'legacy'; this drives the grid in the
// gallery until the A1 flip slice.
/** @type {import('../utils/gridArranger.js').TableConfig} */
export default {
  arrangement: 'grid',
  orientation: 'south', // compass-fixed — preserves A1 print convention (§1)

  regions: {
    nw: 'status',       // StatusStrip: board · dealer · vul → contract → result
    ne: 'auction-ref',  // completed auction pinned (play/review)
    se: 'action',       // BiddingBox (bidding) / Undo·Claim (play)
    sw: 'none',         // deliberately sparse
    center: 'slot',     // AuctionTable (bidding) / TrickArea (play), via slots.center
  },

  tracks: {
    columns: [1.1, 1.3, 1.1], // center widest (stage + hero column); sides close behind
    rows: [0.85, 1.15, 1.3],  // top short, middle stage, bottom heaviest (hero row)
  },

  scale: {
    wishVar: '--table-scale',
    caps: { center: 1.8, seats: 1.4, nw: 1.0, ne: 1.0, se: 1.0, sw: 1.0 },
    legibilityFloor: 0.65,
  },

  densities: {
    bidding: { ne: 'none' },
    play: { ne: 'full' },   // pinned auction, full density
    review: { ne: 'full' },
  },

  shell: {
    // NOTE: spec §6 drafts "companion left" for desktop-wide, but Rick's standing
    // instruction is the narrative floats RIGHT on landscape (as A1 does today).
    // Rendering 'right'; the discrepancy is flagged for the gallery review.
    perViewport: [
      { minWidth: 1000, mode: 'two-column', companionPosition: 'right' },
      { maxWidth: 999, mode: 'stacked', companionPosition: 'below' },
    ],
  },
}

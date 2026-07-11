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

  // Seat CHIPS by visibility (fix 3): the seat AREAS always exist (fixed fr
  // tracks guarantee geometry), but A1 renders a seat only when the deal's
  // display directive names it (hero; dummy in defense) — everything else is an
  // empty area. Table configs use 'always' (live presence/names).
  seatChips: 'directive',

  tracks: {
    columns: [1.1, 1.3, 1.1], // center widest (stage + hero column); sides close behind
    rows: [0.85, 1.15, 1.3],  // top short, middle stage, bottom heaviest (hero row)
  },

  // Bidding-scene vertical model (design direction 2026-07-11, final): BOTTOM-anchor
  // the working cluster (hand + bidding box at the floor; BB never above the hand).
  // The AuctionTable is sized to its content — one row initially — and grows as
  // calls are added. Play/review keep the weighted-fr rows. See grid-arranger-spec §1.
  anchor: { bidding: 'bottom' },
  // Bidding growth reserve, in call-rounds (tableConfig field). A1 = 1: the stage
  // is sized to a single-row auction; longer auctions take the monotone displacement
  // path (the cluster is pushed down one round at a time). The grid shrink-wraps and
  // the shell owns placement (the arranger never reads the viewport).
  reserveRounds: 1,

  scale: {
    wishVar: '--table-scale',
    // se cap is a RELATIONSHIP, not a constant (fix 2): the action cluster belongs
    // to the hand row and must never render larger than the seats — cap =
    // min(1.0, seat scale), floored by touch ergonomics (≥44px targets), not
    // typography. The arranger resolves 'seats' → min(1.0, computed seat scale).
    caps: { center: 1.8, seats: 1.4, nw: 1.0, ne: 1.0, se: 'seats', sw: 1.0 },
    legibilityFloor: 0.65, // also the se touch floor — the box never shrinks below
                           // this (its buttons stay tappable), but 'SE ≤ seats'
                           // dominates: at a 0.65 table the box matches, not exceeds.
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

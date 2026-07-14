// Table (multiplayer host/play) grid config — the server + local play tables.
// Data only; it drives the SAME arranger engine as A1 (gridArranger.js +
// GridArrangement.vue), so all the actual-width / reserve / scale math is shared —
// this file only expresses where the table DIVERGES from the lesson surface
// (2026-07-14, Rick: config per surface, engine shared).
//
// Region behaviour matches A1 (the layout Rick asked for): board status in NW, the
// AuctionTable in the CENTRE during bidding then pinned to NE during play, the
// BiddingBox in SE during bidding (hidden in play — the view drops the SE slot).
// The differences from A1 are seat semantics: a table shows all four seats always
// (live players), not just the PBN-named ones.
/** @type {import('../utils/gridArranger.js').TableConfig} */
export default {
  arrangement: 'grid',
  orientation: 'south', // your seat renders at the bottom, opponents fixed compass

  regions: {
    nw: 'status',       // board · dealer · vul
    ne: 'auction-ref',  // completed auction, pinned in play (densities.play.ne)
    se: 'action',       // BiddingBox in bidding; the view omits the slot in play
    sw: 'none',
    center: 'slot',     // AuctionTable (bidding) / TrickArea (play), via slots.center
  },

  // A TABLE renders every seat (live presence + names), unlike A1's 'directive'
  // (render only the deal's named hero/dummy). This is the hard divergence that makes
  // a separate config worthwhile.
  seatChips: 'always',
  // Seat labels on the table come from SeatControlTable's injected label component
  // (draggable occupant chips), so these badge roles are inert here — left neutral.
  seatBadges: { hero: 'off', partner: 'off', opponents: 'off' },

  tracks: {
    columns: [1.1, 1.3, 1.1],
    rows: [0.85, 1.15, 1.3],
  },

  anchor: { bidding: 'bottom', play: 'bottom' },
  reserveRounds: 1,
  spacing: { actionHandGap: 14 },

  allocationPriority: [['center', 'n', 'e', 's', 'w'], ['se', 'nw', 'ne', 'sw']],

  scale: {
    wishVar: '--table-scale',
    caps: { center: 1.8, seats: 1.4, nw: 1.0, ne: 1.0, se: 'seats', sw: 1.0 },
    legibilityFloor: 0.65,
  },

  densities: {
    bidding: { ne: 'none' },
    play: { ne: 'full' },   // auction pinned to NE during play
    review: { ne: 'none' },
  },

  shell: {
    perViewport: [
      { minWidth: 1000, mode: 'two-column', companionPosition: 'right' },
      { maxWidth: 999, mode: 'stacked', companionPosition: 'below' },
    ],
  },
}

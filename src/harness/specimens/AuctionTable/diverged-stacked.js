// The BBA-tracked "your bid vs BBA's bid" case with EVERYTHING production shows:
// several diverged cells, each tinted (wrongBidIndices — prod derives these from
// the diverged indices), both bids stacked label-over-bid with the rejected one
// struck through and a per-cell toggle, plus the live current-turn `?` (South is
// next to bid). Three divergences on purpose, across two rounds, so the grid is
// stress-tested with multiple tall/tinted cells at once.
export default {
  label: 'diverged · you vs BBA (tinted, stacked, ? to bid)',
  props: {
    dealer: 'N',
    bids: ['1D', '2C', '2S', '3C', 'Pass', '3S'],
    currentBidIndex: 6,          // South is next → the `?` current-turn indicator
    showTurnIndicator: true,
    wrongBidIndices: [1, 2, 4],  // diverged cells carry the pink tint (as shipped)
    allowDivergenceToggle: true,
    divergedBids: {
      1: { user: 'X', bba: '2C' },     // BBA's bid is live
      2: { user: '2S', bba: '3D' },    // your bid is live
      4: { user: 'Pass', bba: '3NT' }, // your bid is live — a wide token vs Pass
    },
  },
}

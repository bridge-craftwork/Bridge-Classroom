// Faithful reproduction of the real shipped case: one tinted diverged cell
// (you opened 1♦, BBA would have opened 1NT — BBA's line is live), the auction
// continued Pass–3NT–Pass, and South is back on to bid (`?`). This is the exact
// state in the production screenshot, kept as a specimen so that layout is
// regression-covered pixel-for-pixel.
export default {
  label: 'diverged · shipped (1♦ vs 1NT, ? to bid)',
  props: {
    dealer: 'S',
    bids: ['1NT', 'Pass', '3NT', 'Pass'],
    currentBidIndex: 4,          // back to South → `?`
    showTurnIndicator: true,
    wrongBidIndices: [0],
    allowDivergenceToggle: true,
    divergedBids: {
      0: { user: '1D', bba: '1NT' }, // you bid 1♦; BBA's 1NT is live
    },
  },
}

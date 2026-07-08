// Baseline: an ordinary auction, no divergence. Its only job is to prove the
// grid conversion (fix #1) leaves normal auctions pixel-identical — this cell is
// the control against which the diverged specimen is judged.
export default {
  label: 'plain auction (no divergence)',
  props: {
    dealer: 'N',
    bids: ['1D', '2C', '2S', '3C', 'Pass', 'Pass'],
    currentBidIndex: -1,
    showTurnIndicator: false,
  },
}

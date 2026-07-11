// Acceptance probe for the bottom-anchor bidding model (grid-arranger-spec §1).
// SAME deal as `a1-bidding-exercise`, auction truncated to 1 call. Paired with
// -len5 / -len9 (1/2/3 call-rounds): the hand + bidding-box row hold position while
// the bottom-anchored auction grows UPWARD into its bounded reserve (its bottom
// edge stays adjacent to the hand). clickableSeat forced to S so the working
// cluster (BiddingBox) renders in all three — the layout is what's under test.
import base from './a1-bidding-exercise.js'
export default {
  ...base,
  label: 'A1 · bidding · 1 call',
  bids: ['1H'],
  lastBid: '1H',
  clickableSeat: 'S',
}

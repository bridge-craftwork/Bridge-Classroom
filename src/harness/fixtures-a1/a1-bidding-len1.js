// Acceptance probe for the bottom-anchor bidding model (grid-arranger-spec §1,
// A1 reserveRounds=1). SAME deal as `a1-bidding-exercise`, auction truncated to 1
// call. Paired with -len5 / -len9 (1/2/3 call-rounds): the auction top is fixed
// just below the status, and the hand + bidding-box row take the monotone
// displacement path (pushed down one round each round). clickableSeat forced to S
// so the working cluster (BiddingBox) renders in all three — layout under test.
import base from './a1-bidding-exercise.js'
export default {
  ...base,
  label: 'A1 · bidding · 1 call',
  bids: ['1H'],
  lastBid: '1H',
  clickableSeat: 'S',
}

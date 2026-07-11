// Acceptance probe for the bottom-anchor bidding model (grid-arranger-spec §1).
// SAME deal as `a1-bidding-exercise`, auction truncated to 1 call. Paired with
// -len5 / -len9: the hand + bidding-box row must hold an IDENTICAL screen position
// across len1↔len5 (slack absorbs the growth); len9 may displace only once the
// slack is exhausted at that viewport. clickableSeat forced to S so the working
// cluster (BiddingBox) renders in all three — the layout is what's under test.
import base from './a1-bidding-exercise.js'
export default {
  ...base,
  label: 'A1 · bidding · 1 call',
  bids: ['1H'],
  lastBid: '1H',
  clickableSeat: 'S',
}

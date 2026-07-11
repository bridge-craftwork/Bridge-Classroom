// Acceptance probe — SAME deal as `a1-bidding-exercise`, auction at 9 calls (3
// call-rounds). See a1-bidding-len1.js for the contract: the auction has grown two
// rounds UPWARD into its reserve, while the hand + BB hold the same position as len1.
import base from './a1-bidding-exercise.js'
export default {
  ...base,
  label: 'A1 · bidding · 9 calls',
  bids: ['1H', 'Pass', '1S', 'Pass', '2H', 'Pass', '3H', 'Pass', '4H'],
  lastBid: '4H',
  clickableSeat: 'S',
}

// Acceptance probe — SAME deal as `a1-bidding-exercise`, auction at 5 calls.
// See a1-bidding-len1.js for the hand/BB position contract.
import base from './a1-bidding-exercise.js'
export default {
  ...base,
  label: 'A1 · bidding · 5 calls',
  bids: ['1H', 'Pass', '1S', 'Pass', '2H'],
  lastBid: '2H',
  clickableSeat: 'S',
}

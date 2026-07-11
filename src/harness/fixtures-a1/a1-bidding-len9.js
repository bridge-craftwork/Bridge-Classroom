// Acceptance probe — SAME deal as `a1-bidding-exercise`, auction at 9 calls (the
// slack-exhaustion case). See a1-bidding-len1.js for the hand/BB position contract:
// hand + BB may displace downward here ONLY if the 9-round auction outgrows the
// viewport's slack.
import base from './a1-bidding-exercise.js'
export default {
  ...base,
  label: 'A1 · bidding · 9 calls',
  bids: ['1H', 'Pass', '1S', 'Pass', '2H', 'Pass', '3H', 'Pass', '4H'],
  lastBid: '4H',
  clickableSeat: 'S',
}

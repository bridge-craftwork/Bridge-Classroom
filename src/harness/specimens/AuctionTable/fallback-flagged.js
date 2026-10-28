// "Flag BBA fallback calls" (a Table settings testing option): North's 4♦ was
// BBA's call where Rusty had no rule, tinted violet with a BBA tag.
export default {
  label: 'BBA fallback call flagged',
  props: {
    dealer: 'N',
    bids: ['1S', 'Pass', '2NT', 'Pass', '4D', 'Pass', '4NT', 'Pass'],
    currentBidIndex: 8,
    showTurnIndicator: true,
    flaggedBids: [4],
  },
}

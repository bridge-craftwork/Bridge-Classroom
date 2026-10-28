// Long Rusty-style meanings on a narrow auction: the hover tooltip must escape the
// table's overflow:hidden and stay inside the window (it is teleported to <body>).
// Hover the 1♠ or 7♠ to check.
export default {
  label: 'long bid meanings (tooltip escapes the box)',
  props: {
    dealer: 'N',
    bids: ['1S', 'Pass', '2S', 'Pass', '4N', 'Pass', '5N', 'Pass', '7S', 'Pass'],
    currentBidIndex: -1,
    showTurnIndicator: false,
    meanings: [
      { position: 0, bid: '1S', tooltip: 'Opening bid\nShows: 4 aces, 0-2 kings\n11-15 HCP, 4-8 S, 0-3 H, 0-1 D, 0-9 C, unbalanced' },
      { position: 8, bid: '7S', tooltip: 'Grand slam: all keycards and the trump queen are held\n11-15 HCP, 4-8 S, unbalanced' },
    ],
  },
}

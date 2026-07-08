// Scene-tier twin of the diverged-stacked specimen: the same "you vs BBA"
// auction inside the full table + rail landscape, so the stacked grid is walked
// across all five viewports (the diverged cells are widest relative to the rail
// at the narrow/stacked breakpoints, where the auction rail is full-width).
export default {
  label: 'auction · diverged (you vs BBA)',
  surface: 'table',
  seat: 'S',
  dealer: 'N',
  vulnerable: 'NS',
  phase: 'bidding',
  clickableSeat: 'S',
  hands: {
    N: { spades: ['K', 'J', '4'], hearts: ['Q', '9', '3'], diamonds: ['A', 'K', '8', '5'], clubs: ['7', '2'] },
    E: { spades: ['A', 'Q', '9'], hearts: ['K', 'J', 'T'], diamonds: ['Q', '7'], clubs: ['K', 'Q', '9', '4'] },
    S: { spades: ['T', '8', '7', '5', '2'], hearts: ['A', '5'], diamonds: ['J', '9', '3'], clubs: ['A', '8'] },
    W: { spades: ['6', '3'], hearts: ['8', '7', '6', '4', '2'], diamonds: ['T', '6', '4'], clubs: ['J', '5', '3'] },
  },
  bids: ['1D', '2C', '2S', '3C', 'Pass', 'Pass'],
  lastBid: '3C',
  allowDivergenceToggle: true,
  wrongBidIndices: [1, 2, 4],
  divergedBids: {
    1: { user: 'X', bba: '2C' },
    2: { user: '2S', bba: '3D' },
    4: { user: 'Pass', bba: '3S' },
  },
  context: {
    title: 'Coach',
    text: 'BBA would have jumped to 3♦ here — you competed 2♠ instead.\nTap a cell to compare the two lines.',
  },
}

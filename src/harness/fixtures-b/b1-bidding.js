// B1 · bidding (solo practice table, LocalEngine). South (you) is responding to
// partner's 1♥ opening; only your hand shows during bidding. Unlike A1, ALL four
// seats are named live occupants — N=BBA (bids; becomes Dummy in play), E/W=BBA+BEN
// (bid + cardplay bots), S=you — the seat-semantics divergence (seatChips:'always'
// + occupants) that distinguishes the practice table from the lesson surface.
export default {
  label: 'B1 · bidding (solo)',
  surface: 'b1',
  seat: 'S',
  scenario: 'What should I bid?',
  systemNS: 'Basic-Bridge',
  systemEW: 'Basic-Bridge',
  board: 3,
  dealer: 'N',
  vulnerable: 'EW',
  phase: 'bidding',
  clickableSeat: 'S',
  hiddenSeats: ['N', 'E', 'W'],
  bids: ['1H', 'Pass'],
  lastBid: '1H',
  occupants: {
    N: { name: 'BBA' },
    E: { name: 'BBA+BEN' },
    S: { name: 'Rick Wilson' },
    W: { name: 'BBA+BEN' },
  },
  hands: {
    S: { spades: ['K', 'Q', '10', '2'], hearts: ['A', '8', '4'], diamonds: ['Q', 'J', '9'], clubs: ['K', '6', '3'] },
    N: {}, E: {}, W: {},
  },
}

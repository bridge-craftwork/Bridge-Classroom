// B1 · cardplay (solo practice table). South declares 3NT; the solo table supports
// South-as-declarer, so North is the DUMMY South plays (occupant flips BBA→Dummy),
// and E/W are the cardplay bots (hidden). Trick one is done (S won the ♦A); South is
// on lead to trick two. Slot check vs bidding: TrickArea in CENTRE, completed auction
// PINNED at NE, no BiddingBox (the view drops SE in play), Cardplay card in the rail.
export default {
  label: 'B1 · cardplay (solo)',
  surface: 'b1',
  seat: 'S',
  scenario: 'Play it out',
  systemNS: 'Basic-Bridge',
  systemEW: 'Basic-Bridge',
  board: 5,
  dealer: 'S',
  vulnerable: 'NS',
  phase: 'play',
  contract: '3NT',
  declarer: 'S',
  clickableSeat: 'S',
  nextSeat: 'S',
  hiddenSeats: ['E', 'W'], // show South (declarer) + North (dummy); E/W are hidden bots
  tricksTaken: { NS: 1, EW: 0 },
  bids: ['1NT', 'Pass', '3NT', 'Pass', 'Pass', 'Pass'], // dealer S → S declares 3NT
  occupants: {
    N: { name: 'Dummy' },
    E: { name: 'BBA+BEN' },
    S: { name: 'Rick Wilson' },
    W: { name: 'BBA+BEN' },
  },
  // Hands AFTER trick one (each played one card below), so the display is consistent
  // without a separate playedCards list — E/W are hidden anyway.
  hands: {
    N: { spades: ['J', '6', '3'], hearts: ['A', 'J', '3'], diamonds: ['K', '5'], clubs: ['Q', 'J', '6', '2'] },
    S: { spades: ['A', 'K', 'Q'], hearts: ['K', 'Q', '4'], diamonds: ['J', '9'], clubs: ['A', 'K', '3'] },
    E: {}, W: {},
  },
  // Trick one, complete: West led ♦Q, dummy ♦2, East ♦5, declarer won the ♦A.
  lastFinishedTrick: {
    leader: 'W',
    winner: 'S',
    plays: [
      { seat: 'W', suit: 'diamonds', rank: 'Q' },
      { seat: 'N', suit: 'diamonds', rank: '2' },
      { seat: 'E', suit: 'diamonds', rank: '5' },
      { seat: 'S', suit: 'diamonds', rank: 'A' },
    ],
  },
  currentTrick: { leader: 'S', plays: [] },
}

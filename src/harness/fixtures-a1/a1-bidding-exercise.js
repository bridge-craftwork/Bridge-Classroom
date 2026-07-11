// A1 · bidding exercise. The student (South) has the only visible hand; partner
// opened 1♥ and it's South's call. Slot check: AuctionTable in CENTER (live,
// turn indicator on), BiddingBox at SE (wantsCall → action slot), TableInfo at
// NW (Board 7 · NS vul · dealer), narrative floated right.
export default {
  label: 'A1 · bidding exercise',
  surface: 'a1',
  seat: 'S',
  board: 7,
  dealer: 'N',
  vulnerable: 'NS',
  phase: 'bidding',
  clickableSeat: 'S',
  hiddenSeats: ['N', 'E', 'W'],
  bids: ['1H', 'Pass'],
  lastBid: '1H',
  hands: {
    S: { spades: ['A', 'Q', '7'], hearts: ['K', 'J', '5'], diamonds: ['A', '8', '3'], clubs: ['Q', '6', '4', '2'] },
    N: {}, E: {}, W: {},
  },
  context: {
    mode: 'commentary',
    title: 'Coach',
    text: 'Partner opened 1♥. You hold 13 HCP with three-card heart support —\ncomfortably worth a game try. What do you bid?',
  },
}

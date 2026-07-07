// A competitive auction in progress, all four hands visible (teaching view),
// South to bid. Exercises the 4-seat table + auction rail + bidding box +
// context panel — the full landscape composition to review across viewports.
export default {
  label: 'auction · mid-competitive',
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
  context: {
    title: 'Table chat',
    text: 'Snow White: nice weak jump ♠\nRick: thanks — thinking 3♠ to compete\nSnow White: I have a little something',
  },
}

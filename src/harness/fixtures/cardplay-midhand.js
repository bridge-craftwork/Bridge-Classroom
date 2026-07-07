// Mid-play, declarer's view: South declares 4♥, dummy (North) is up, defenders
// hidden, a diamond trick in progress with South to play. Exercises the center
// trick-area slot + play status rail — the cardplay composition to review.
export default {
  label: 'cardplay · mid-hand',
  surface: 'table',
  seat: 'S',
  dealer: 'S',
  vulnerable: 'None',
  phase: 'play',
  contract: '4H',
  declarer: 'S',
  clickableSeat: 'S',
  nextSeat: 'S',
  hiddenSeats: ['E', 'W'],
  tricksTaken: { NS: 4, EW: 3 },
  bids: ['1H', 'Pass', '3H', 'Pass', '4H', 'Pass', 'Pass', 'Pass'],
  hands: {
    S: { spades: ['A', 'K'], hearts: ['Q', 'J', '9'], diamonds: ['5', '4'], clubs: ['A', '3'] },
    N: { spades: ['Q', 'J', 'T'], hearts: ['8'], diamonds: ['K', 'Q'], clubs: ['K', 'Q'] },
    E: {}, W: {},
  },
  currentTrick: {
    plays: [
      { seat: 'W', suit: 'diamonds', rank: 'K' },
      { seat: 'N', suit: 'diamonds', rank: 'A' },
      { seat: 'E', suit: 'diamonds', rank: '3' },
    ],
  },
  context: {
    title: 'Coach',
    text: 'You’re in 4♥ needing the rest. Win the ♦A in dummy?\nCount your winners before you commit.',
  },
}

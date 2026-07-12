// A1 · cardplay exercise — the defensive-signals shape, A1 convention (matches the
// production "Defensive Signals" board 1). Declarer SOUTH plays 3NT; the student is
// WEST, on lead to trick two after the opening ♠K. Dummy (North) is visible; the
// student's hand (West) and dummy (North) show — declarer (South) and partner
// (East) are hidden, their trick-one cards shown in the centre TrickArea.
//
// South anchor puts the hero (West) hand at SCREEN-LEFT (col 0), sharing that
// column with the NW status glyph — so the status rides along in a tier-0 column
// (no lone-corner starvation). Slot check: completed auction PINNED at NE, no
// bidding box — SE holds Undo · Claim; the signal trick sits in CENTER.
export default {
  label: 'A1 · cardplay exercise (defensive signals)',
  surface: 'a1',
  seat: 'W',            // hero = West (defender), "You are West"
  heroName: 'Rick Wilson',
  board: 1,
  dealer: 'S',
  vulnerable: 'None',
  phase: 'play',
  contract: '3NT',
  declarer: 'S',
  clickableSeat: 'W',
  nextSeat: 'W',
  hiddenSeats: ['E', 'S'], // show West (hero) + North (dummy); E/S cards in the trick
  tricksTaken: { NS: 0, EW: 1 },
  bids: ['1C', '1S', '3C', 'Pass', '3NT', 'Pass', 'Pass', 'Pass'], // dealer South
  hands: {
    W: { spades: ['K', 'Q', 'T', '4', '2'], hearts: ['9', '8', '5'], diamonds: ['T', '9', '7'], clubs: ['A', '4'] },
    N: { spades: ['6', '3'], hearts: ['A', 'J', '3'], diamonds: ['K', '5', '2'], clubs: ['K', 'Q', 'J', '6', '2'] },
    E: {}, S: {},
  },
  // Trick one, complete: West led the ♠K (won), partner East signalled the ♠7,
  // declarer South followed the ♠5. West is back on lead for trick two.
  lastFinishedTrick: {
    leader: 'W',
    winner: 'W',
    plays: [
      { seat: 'W', suit: 'spades', rank: 'K' },
      { seat: 'N', suit: 'spades', rank: '3' },
      { seat: 'E', suit: 'spades', rank: '7' },
      { seat: 'S', suit: 'spades', rank: '5' },
    ],
  },
  currentTrick: { leader: 'W', plays: [] },
  context: {
    mode: 'commentary',
    title: 'Coach',
    text: 'You are West. You led the ♠K; partner played the ♠7 and declarer the ♠5.\nPartner’s spade shows their count. What do you play to the second trick?',
  },
}

// A1 · cardplay exercise — the defensive-signals shape. Student (South) defends
// 4♠ by West; dummy (East) is visible, partner (North) and declarer (West) are
// hidden. Slot check: completed auction PINNED at NE (full density), TrickArea
// in CENTER, no bidding box — SE holds Undo · Claim. Partner led a low diamond,
// dummy played the queen; South is on lead to signal.
export default {
  label: 'A1 · cardplay exercise (defensive signals)',
  surface: 'a1',
  seat: 'S',
  board: 12,
  dealer: 'W',
  vulnerable: 'EW',
  phase: 'play',
  contract: '4S',
  declarer: 'W',
  clickableSeat: 'S',
  nextSeat: 'S',
  hiddenSeats: ['N', 'W'],
  tricksTaken: { NS: 1, EW: 1 },
  bids: ['1S', 'Pass', '3S', 'Pass', '4S', 'Pass', 'Pass', 'Pass'],
  hands: {
    S: { spades: ['5', '4'], hearts: ['K', 'Q', '9'], diamonds: ['A', '8', '6'], clubs: ['J', 'T', '7'] },
    E: { spades: ['A', 'K', 'Q'], hearts: ['J', '5'], diamonds: ['Q', '7', '2'], clubs: ['K', 'Q', '4'] },
    N: {}, W: {},
  },
  currentTrick: {
    leader: 'N',
    plays: [
      { seat: 'N', suit: 'diamonds', rank: '5' },
      { seat: 'E', suit: 'diamonds', rank: 'Q' },
    ],
  },
  context: {
    mode: 'commentary',
    title: 'Coach',
    text: 'Partner led the ♦5 and dummy played the queen. You hold the ace —\nwin now, or signal and hold up? Your card tells partner your count.',
  },
}

// A1 · review. All four hands revealed, the board played out. Slot check:
// result/contract in the NW StatusStrip (4♠ by West, down 2), auction pinned at
// NE, no bidding box or trick area (center empty — the hands are the subject).
// This is annotated-hand territory: the review commentary points at the cards.
//
// KNOWN GAP the fixture exposes: BridgeTable derives only `played`/`active-seat`
// marks from props — it has no per-card badge/fill passthrough, so the
// annotation channel HandDisplay supports can't yet reach a reviewed hand. That
// passthrough is Phase-1 work; this fixture is why.
export default {
  label: 'A1 · review',
  surface: 'a1',
  seat: 'S',
  board: 12,
  dealer: 'W',
  vulnerable: 'EW',
  phase: 'review',
  contract: '4S',
  declarer: 'W',
  hiddenSeats: [],
  tricksTaken: { NS: 5, EW: 8 },
  bids: ['1S', 'Pass', '3S', 'Pass', '4S', 'Pass', 'Pass', 'Pass'],
  hands: {
    N: { spades: ['K', 'J', '4'], hearts: ['Q', '9', '3'], diamonds: ['A', 'K', '8', '5', '2'], clubs: ['7', '2'] },
    E: { spades: ['A', 'Q', '9'], hearts: ['K', 'J', 'T'], diamonds: ['Q', '7'], clubs: ['K', 'Q', 'T', '9', '4'] },
    S: { spades: ['T', '8', '7', '5', '2'], hearts: ['A', '5'], diamonds: ['J', '9', '3'], clubs: ['A', '8', '6'] },
    W: { spades: ['6', '3'], hearts: ['8', '7', '6', '4', '2'], diamonds: ['T', '6', '4'], clubs: ['J', '5', '3'] },
  },
  context: {
    mode: 'commentary',
    title: 'Review',
    text: '4♠ went two down. The defence cashed its diamonds and South’s ♣A —\nyour count signal at trick two is what set up the extra trick.',
  },
}

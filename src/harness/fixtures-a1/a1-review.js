// A1 · review — the same Defensive Signals board 1, played out. All four hands
// revealed: declarer SOUTH's 3NT, defended by WEST (hero) + EAST. Badges name the
// student (West → their first name), partner (East → "Partner"), and the opponents
// by role — "N: Dummy" and "S: Declarer" (item 5). South anchor keeps the hero at
// screen-left. Slot check: result/contract in the NW StatusStrip (3NT by South,
// down 1), auction pinned at NE, no bidding box or trick area (the hands are the
// subject).
//
// KNOWN GAP the fixture exposes: BridgeTable derives only `played`/`active-seat`
// marks from props — no per-card badge/fill passthrough, so the annotation channel
// HandDisplay supports can't yet reach a reviewed hand. That passthrough is Phase-1
// work; this fixture is why.
export default {
  label: 'A1 · review',
  surface: 'a1',
  seat: 'W',
  heroName: 'Rick Wilson',
  board: 1,
  dealer: 'S',
  vulnerable: 'None',
  phase: 'review',
  contract: '3NT',
  declarer: 'S',
  hiddenSeats: [],
  tricksTaken: { NS: 8, EW: 5 }, // 3NT by South, down one
  bids: ['1C', '1S', '3C', 'Pass', '3NT', 'Pass', 'Pass', 'Pass'], // dealer South
  hands: {
    N: { spades: ['6', '3'], hearts: ['A', 'J', '3'], diamonds: ['K', '5', '2'], clubs: ['K', 'Q', 'J', '6', '2'] },
    E: { spades: ['9', '8', '7'], hearts: ['T', '7', '6', '2'], diamonds: ['8', '6', '4', '3'], clubs: ['5', '3'] },
    S: { spades: ['A', 'J', '5'], hearts: ['K', 'Q', '4'], diamonds: ['A', 'Q', 'J'], clubs: ['T', '9', '8', '7'] },
    W: { spades: ['K', 'Q', 'T', '4', '2'], hearts: ['9', '8', '5'], diamonds: ['T', '9', '7'], clubs: ['A', '4'] },
  },
  context: {
    mode: 'commentary',
    title: 'Review',
    text: '3NT by South went one down. West’s spades — unblocked after East’s count\nsignal at trick one — plus the ♣A entry cashed the setting tricks.',
  },
}

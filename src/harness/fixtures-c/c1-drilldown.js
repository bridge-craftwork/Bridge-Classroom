// C1 · drill-in (teacher kibitzing one table from the console). The teacher clicks a
// tile's name and the console opens `<UnifiedTable server />` in a panel below the
// grid, over the same socket, read-only.
//
// WHY THIS IS ITS OWN SCENE rather than an alias of the B2/B3 server scene (Rick,
// 2026-07-29: "i think the drill in will need to have some differences too — not sure
// yet"). Today it renders the same component as B2/B3, so anything we move in the
// grid lands here for free. But the VIEWER is different in a way the B fixtures never
// express, and those differences are already visible:
//
//   • The teacher is NOT SEATED. No bidding box (SE holds nothing in bidding), no
//     Undo, no deal transport in NW — a kibitzer acts on nothing. This is the
//     emptiest the action corner ever gets, and the case that proves a corner
//     collapses rather than reserving width for absent controls.
//   • ALL FOUR HANDS are visible. A teacher watching sees everything; a player never
//     does mid-deal. So the seat panels are at their fullest exactly when the
//     peripheral clusters are at their emptiest — the opposite balance from B1/B2.
//   • It is NESTED. Unlike B2/B3 this table renders inside console chrome (the
//     kibitz bar) *below* a tile grid, so its width budget is the console's, not the
//     viewport's.
//
// Keeping it separate gives those differences somewhere to be modelled as they get
// decided, instead of being invisible until someone opens the live console.
export default {
  label: 'C1 · drill-in (kibitz)',
  surface: 'c1',
  view: 'drilldown',
  sessionName: 'Tuesday 7pm — Intermediate',
  connectionStatus: 'connected',
  watchingName: 'Table 2',

  // The watched table, in the arranger's hand shape (not MiniTable's).
  seat: 'S',            // orientation anchor; the teacher holds no seat of their own
  kibitzer: true,
  board: 4,
  dealer: 'N',
  vulnerable: 'None',
  phase: 'play',
  contract: '4S',
  declarer: 'S',
  nextSeat: 'W',
  hiddenSeats: [],      // a kibitzing teacher sees every hand
  tricksTaken: { NS: 3, EW: 1 },
  bids: ['Pass', '1S', 'Pass', '2S', 'Pass', '4S', 'Pass', 'Pass', 'Pass'],
  occupants: {
    N: { name: 'Eli', connected: true },
    E: { name: 'RulesBot' },
    S: { name: 'Fay', connected: true },
    W: { name: 'Gus', connected: false },
  },
  seats: {
    N: { kind: 'human', name: 'Eli', connected: true },
    E: { kind: 'bot' },
    S: { kind: 'human', name: 'Fay', connected: true },
    W: { kind: 'human', name: 'Gus', connected: false },
  },
  // Four tricks played, so each hand holds nine.
  hands: {
    N: { spades: ['K', '7'], hearts: ['Q', '9'], diamonds: ['A', 'J'], clubs: ['K', '8', '4'] },
    E: { spades: ['6'], hearts: ['10', '8', '6'], diamonds: ['9', '8'], clubs: ['10', '9', '3'] },
    S: { spades: ['A', 'Q', 'J'], hearts: ['A', 'J'], diamonds: ['K', '10'], clubs: ['J', '7'] },
    W: { spades: ['9', '5'], hearts: ['K', '4'], diamonds: ['Q', '5'], clubs: ['A', 'Q', '6'] },
  },
  lastFinishedTrick: {
    leader: 'N',
    winner: 'S',
    plays: [
      { seat: 'N', suit: 'diamonds', rank: '6' },
      { seat: 'E', suit: 'diamonds', rank: '7' },
      { seat: 'S', suit: 'diamonds', rank: 'A' },
      { seat: 'W', suit: 'diamonds', rank: '3' },
    ],
  },
  currentTrick: {
    leader: 'S',
    plays: [{ seat: 'S', suit: 'spades', rank: 'A' }, { seat: 'W', suit: 'spades', rank: '5' }],
  },
  kibitzers: ['Nina'],
  ddtricks: '9a6879a6874375643756',
}

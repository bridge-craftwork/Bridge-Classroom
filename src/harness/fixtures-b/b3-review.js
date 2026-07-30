// B3 · review (server practice table, invited guest). Board 4 played out, seen from
// East. The guest's review state is deliberately the SPARSEST of the six B scenes,
// and that is what it's here to show.
//
// Against b2-review: same board, same result banner, same reveal — but no host
// advance ("Next deal →"), no seat management, no PassBot, no Deal source. The guest
// can mark ready for the next board and nothing else. When the VCR row and Deal
// source move into NW, this is the fixture that has to prove the corner collapses
// cleanly rather than reserving width for controls the guest never sees.
export default {
  label: 'B3 · review (server)',
  surface: 'b3',
  seat: 'E',
  heroName: 'Dana Lee',
  scenario: "Rick's table",
  board: 4,
  dealer: 'N',
  vulnerable: 'None',
  phase: 'review',
  contract: '4S',
  declarer: 'S',
  hiddenSeats: [], // the reveal shows every hand
  tricksTaken: { NS: 10, EW: 3 },
  bids: ['Pass', '1S', 'Pass', '2S', 'Pass', '4S', 'Pass', 'Pass', 'Pass'],
  divergedBids: [5],
  divergence: true,
  canManage: false,
  canHostAdvance: false,
  yourSeats: ['E'],
  myToken: 't-e',
  sessionId: 'sess-demo',
  occupants: {
    N: { name: 'Lia', connected: true },
    E: { name: 'Dana Lee', connected: true },
    S: { name: 'Rick Wilson', connected: true },
    W: { name: 'BBA+RulesBot' },
  },
  seats: {
    N: { kind: 'human', name: 'Lia', connected: true },
    E: { kind: 'human', name: 'Dana Lee', connected: true },
    S: { kind: 'human', name: 'Rick Wilson', connected: true },
    W: { kind: 'bot' },
  },
  hands: {
    N: { spades: ['K', '7', '4'], hearts: ['Q', '9', '3'], diamonds: ['A', 'J', '6'], clubs: ['K', '8', '4', '2'] },
    S: { spades: ['A', 'Q', 'J', '10', '8'], hearts: ['A', 'J', '7'], diamonds: ['K', '10', '2'], clubs: ['J', '7'] },
    E: { spades: ['6', '3'], hearts: ['10', '8', '6', '5', '2'], diamonds: ['9', '8', '7'], clubs: ['10', '9', '3'] },
    W: { spades: ['9', '5', '2'], hearts: ['K', '4'], diamonds: ['Q', '5', '4', '3'], clubs: ['A', 'Q', '6', '5'] },
  },

  // ── Review-only furniture (guest subset) ──
  result: { took: 10, needed: 10, made: true },
  resultBanner: '4♠ by South — <strong>made</strong> (10 tricks)',
  summary: '4♠ by South · none vulnerable',
  kibitzers: ['Marta'],
  ddtricks: '9a6879a6874375643756',
}

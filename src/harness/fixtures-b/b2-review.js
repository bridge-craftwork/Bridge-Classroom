// B2 · review (server practice table, host-as-player). Board 4 from b2-cardplay,
// played out: 4♠ by South, ten tricks, made exactly.
//
// The host-only review furniture is the point (2026-07-29 audit — none of it was in
// the gallery): the Result card with the result banner, the "Ready for next board"
// button plus the ready-seat tally, and the host's own "Next deal →" advance. This
// is also the only B fixture that exercises the BBA divergence card (#304) — the
// shared table's you-vs-BBA comparison, which is read-only on a served table.
export default {
  label: 'B2 · review (server)',
  surface: 'b2',
  seat: 'S',
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
  // BBA would have stopped in 2♠ — the 4♠ raise is the divergence (#304).
  divergedBids: [5],
  divergence: true,
  canManage: true,
  canHostAdvance: true,
  yourSeats: ['S'],
  myToken: 't-s',
  sessionId: 'sess-demo',
  inviteUrl: 'https://bridge-classroom.org/table/BRG-8F2K',
  occupants: {
    N: { name: 'Lia', connected: true },
    E: { name: '' },
    S: { name: 'Rick Wilson', connected: true },
    W: { name: 'BBA+RulesBot' },
  },
  seats: {
    N: { kind: 'human', name: 'Lia', connected: true },
    E: { kind: 'empty' },
    S: { kind: 'human', name: 'Rick Wilson', connected: true },
    W: { kind: 'bot' },
  },
  hands: {
    N: { spades: ['K', '7', '4'], hearts: ['Q', '9', '3'], diamonds: ['A', 'J', '6'], clubs: ['K', '8', '4', '2'] },
    S: { spades: ['A', 'Q', 'J', '10', '8'], hearts: ['A', 'J', '7'], diamonds: ['K', '10', '2'], clubs: ['J', '7'] },
    E: { spades: ['6', '3'], hearts: ['10', '8', '6', '5', '2'], diamonds: ['9', '8', '7'], clubs: ['10', '9', '3'] },
    W: { spades: ['9', '5', '2'], hearts: ['K', '4'], diamonds: ['Q', '5', '4', '3'], clubs: ['A', 'Q', '6', '5'] },
  },

  // ── Review-only furniture ──
  result: { took: 10, needed: 10, made: true },
  resultBanner: '4♠ by South — <strong>made</strong> (10 tricks)',
  summary: '4♠ by South · none vulnerable',
  readySeats: ['N'],
  iAmReady: false,
  kibitzers: ['Marta'],
  ddtricks: '9a6879a6874375643756',
}

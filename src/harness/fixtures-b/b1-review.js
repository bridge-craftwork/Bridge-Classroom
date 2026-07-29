// B1 · review (solo practice table). The SAME board 5 / 3NT-by-South deal as
// b1-cardplay, played out: nine tricks, contract made exactly. Review is the phase
// with the MOST out-of-grid furniture in the live view — the contract banner, the
// made/down line, the cardplay-line note, bot stats, the double-dummy table and the
// Next deal / Replay pair all live in the shell below the table — and until this
// fixture existed none of it appeared in the gallery at all (2026-07-29 audit).
//
// Slot check vs play: center = 'review' (the reveal), auction still PINNED at NE,
// no BiddingBox, all four hands visible (the reveal shows everything).
export default {
  label: 'B1 · review (solo)',
  surface: 'b1',
  seat: 'S',
  scenario: 'Play it out',
  systemNS: 'Basic-Bridge',
  systemEW: 'Basic-Bridge',
  board: 5,
  dealer: 'S',
  vulnerable: 'NS',
  phase: 'review',
  contract: '3NT',
  declarer: 'S',
  hiddenSeats: [], // the reveal shows every hand
  tricksTaken: { NS: 9, EW: 4 },
  bids: ['1NT', 'Pass', '3NT', 'Pass', 'Pass', 'Pass'],
  occupants: {
    N: { name: 'Dummy' },
    E: { name: 'BBA+BEN' },
    S: { name: 'Rick Wilson' },
    W: { name: 'BBA+BEN' },
  },
  // The full deal, restored for the reveal (13 cards per hand).
  hands: {
    N: { spades: ['J', '6', '3'], hearts: ['A', 'J', '3'], diamonds: ['K', '5', '2'], clubs: ['Q', 'J', '6', '2'] },
    S: { spades: ['A', 'K', 'Q'], hearts: ['K', 'Q', '4'], diamonds: ['A', 'J', '9'], clubs: ['A', 'K', '3', '7'] },
    E: { spades: ['10', '8', '7', '4'], hearts: ['9', '7', '6', '2'], diamonds: ['8', '6', '3'], clubs: ['10', '9'] },
    W: { spades: ['9', '5', '2'], hearts: ['10', '8', '5'], diamonds: ['Q', '10', '7', '4'], clubs: ['8', '5', '4'] },
  },

  // ── Review-only furniture (all of it OUTSIDE the grid in the live view) ──
  result: { took: 9, needed: 9, made: true },
  summary: '3NT by South · NS vulnerable',
  // Composite cardplay bot (#305): the recorded line was followed, then abandoned.
  lineNote: 'followed the recorded line to trick 6, then BEN took over',
  botStats: { count: 11, mean: 512, max: 1840, total: 5632 },
  // Seat [N,S,E,W] × strain [NT,S,H,D,C]. South makes exactly 9 at NT.
  ddtricks: '95467954674897648976',
  divergence: false,
}

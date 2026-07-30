// B1 · review, BIDDING-ONLY (solo). The auction finished and the hand was never
// played — "Play the hand after bidding" off, or a deal that doesn't support it.
//
// Added 2026-07-29 from a beetle report (dev-reports/…/here-is-b1-review-in-a-
// landscape-format-…): the gallery had review fixtures, but every one of them had
// PLAYED, so the bidding-only review state — the one a bidding-practice user hits
// most — could not be seen at all. Two defects were hiding in it:
//
//   • the stage renders `bidding-anchored`, reserving auction GROWTH height for an
//     auction that is over, because `deriveSlots` returns center: null (its review
//     branch needs hasCardplay) and the view's ternary falls through to 'bidding';
//   • Restart-cardplay must NOT offer here — nothing was played. This fixture is what
//     the scene's `cardplayCompleted` gate is checked against (no tricks → 2 icons).
//
// Deal is the reporter's: 2NT by South after 1♣–1♥–1NT–2♦–2NT, one bid diverging
// from BBA.
export default {
  label: 'B1 · review, bidding only (solo)',
  surface: 'b1',
  seat: 'S',
  scenario: 'New Minor Force',
  systemNS: '21GF-DEFAULT',
  systemEW: '21GF-GIB',
  board: 1,
  dealer: 'S',
  vulnerable: 'None',
  phase: 'review',
  contract: '2NT',
  declarer: 'S',
  hiddenSeats: [], // the auction is over — every hand is revealed
  // NO tricksTaken: nothing was played. Absent (not zeroed) so the distinction from
  // "played and took none" stays visible to the scene.
  bids: ['1C', 'Pass', '1H', 'Pass', '1NT', 'Pass', '2D', 'Pass', '2NT', 'Pass', 'Pass', 'Pass'],
  // South's 2NT diverged from BBA. Index 8 in the call list.
  divergedBids: [8],
  divergence: true,
  summary: '1 of your bids differed from the BBA — see the divergent cells above.',
  occupants: {
    N: { name: 'BBA' },
    E: { name: 'BBA' },
    S: { name: 'Rick Wilson' },
    W: { name: 'BBA' },
  },
  hands: {
    N: { spades: ['A', 'K', '5'], hearts: ['J', '9', '8', '7', '3'], diamonds: ['10', '4', '2'], clubs: ['A', '8'] },
    E: { spades: ['J', '9', '8', '3'], hearts: ['K', '4'], diamonds: ['9', '6', '5', '3'], clubs: ['Q', '9', '3'] },
    S: { spades: ['Q', '10', '2'], hearts: ['10', '6'], diamonds: ['A', 'K', '7'], clubs: ['K', 'J', '7', '4', '2'] },
    W: { spades: ['7', '6', '4'], hearts: ['A', 'Q', '5', '2'], diamonds: ['Q', 'J', '8'], clubs: ['10', '6', '5'] },
  },
  // No cardplay ⇒ no double-dummy table (the solver runs off the played hand).
}

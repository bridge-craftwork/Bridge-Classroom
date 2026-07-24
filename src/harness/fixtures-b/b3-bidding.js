// B3 · player (server practice table, invited guest). You joined Rick's table by
// invite link and took the EAST seat; South (Rick) hosts, North is his friend Lia,
// West is a bot. You canNOT manage seats (guest) — the player chrome is a slim bar
// (Leave table + identity), not the host strip. Same SeatControlTable + grid as B2;
// the difference from B2 is the chrome + can-manage. Mid-auction, your call.
export default {
  label: 'B3 · player (server)',
  surface: 'b3',
  seat: 'E',
  heroName: 'Dana Lee',
  scenario: "Rick's table",
  board: 4,
  dealer: 'N',
  vulnerable: 'None',
  phase: 'bidding',
  clickableSeat: 'E',
  nextSeat: 'E',
  hiddenSeats: ['N', 'S', 'W'],
  bids: ['Pass', '1S', 'Pass', '2S', 'Pass'],
  lastBid: '2S',
  canManage: false,
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
    E: { spades: ['A', 'Q', 'J', '7'], hearts: ['K', '5'], diamonds: ['Q', '7', '5'], clubs: ['A', '10', '9', '4'] },
    N: {}, S: {}, W: {},
  },
}

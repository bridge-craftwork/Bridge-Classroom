// B2 · host (server practice table, host-as-player). You (South) host a shared
// table: North is a human friend who joined (Lia), East is empty (open seat), West
// is a bot — and you can MANAGE seats (drag/assign/kick, invite a friend onto the
// empty seat). Rendered through the REAL SeatControlTable, so the seat chips carry
// occupant kind (human/bot/empty) + connection — the management chrome B1's plain
// BridgeTable doesn't have. Mid-auction, your call. show-hcp is OFF on a shared table.
export default {
  label: 'B2 · host (server)',
  surface: 'b2',
  seat: 'S',
  scenario: "Rick's table",
  board: 4,
  dealer: 'N',
  vulnerable: 'None',
  phase: 'bidding',
  clickableSeat: 'S',
  nextSeat: 'S',
  hiddenSeats: ['N', 'E', 'W'],
  bids: ['Pass', '1S', 'Pass'],
  lastBid: '1S',
  canManage: true,
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
    S: { spades: ['9', '6', '2'], hearts: ['A', 'J', '7'], diamonds: ['K', '10', '8', '2'], clubs: ['J', '7', '5'] },
    N: {}, E: {}, W: {},
  },
}

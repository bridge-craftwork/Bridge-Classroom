// B3 · cardplay (server practice table, invited guest). The SAME board 4 / 4♠-by-South
// table as b2-cardplay, seen from East — the seat you took by invite link.
//
// Pair this with b2-cardplay to read the OWNER-vs-GUEST control difference directly
// (Rick, 2026-07-29): the guest gets no host strip, no Deal source, no Pause bots, no
// Undo, no Next deal, no PassBot card and no seat management — just the leave/identity
// bar and the play cues. That difference is exactly what makes the NW reserve
// context-dependent rather than constant, so the two fixtures need to sit side by side
// in the gallery before the VCR row moves into the corner.
//
// You are a DEFENDER here (b2 is declarer), so the visible hands differ too: your own
// hand plus the dummy, with declarer and partner hidden.
export default {
  label: 'B3 · cardplay (server)',
  surface: 'b3',
  seat: 'E',
  heroName: 'Dana Lee',
  scenario: "Rick's table",
  board: 4,
  dealer: 'N',
  vulnerable: 'None',
  phase: 'play',
  contract: '4S',
  declarer: 'S',
  clickableSeat: null, // not your turn — South is on play
  nextSeat: 'S',
  hiddenSeats: ['S', 'W'], // your hand + dummy (North) show; declarer and partner hidden
  tricksTaken: { NS: 1, EW: 1 },
  bids: ['Pass', '1S', 'Pass', '2S', 'Pass', '4S', 'Pass', 'Pass', 'Pass'],
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
  // Two tricks complete + two cards into trick three: North has played to all three
  // (10 left), East has played to two (11 left).
  hands: {
    N: { spades: ['K', '7', '4'], hearts: ['Q', '9'], diamonds: ['A', 'J', '6'], clubs: ['K', '8'] },
    E: { spades: ['6', '3'], hearts: ['10', '8', '6', '5'], diamonds: ['9', '8', '7'], clubs: ['10', '9'] },
    S: {}, W: {},
  },
  lastFinishedTrick: {
    leader: 'W',
    winner: 'W',
    plays: [
      { seat: 'W', suit: 'hearts', rank: 'K' },
      { seat: 'N', suit: 'hearts', rank: '3' },
      { seat: 'E', suit: 'hearts', rank: '2' },
      { seat: 'S', suit: 'hearts', rank: '7' },
    ],
  },
  currentTrick: {
    leader: 'W',
    plays: [
      { seat: 'W', suit: 'clubs', rank: 'A' },
      { seat: 'N', suit: 'clubs', rank: '2' },
    ],
  },
  kibitzers: ['Marta'],
  // Table chat — no backend yet; this exercises the rail's future occupant so the
  // companion column can be sized for it before it ships.
  chat: [
    { from: 'Lia', text: 'nice lead' },
    { from: 'You', text: 'thanks — thought about the heart', own: true },
    { from: 'Marta', text: '(watching) tough defence here' },
  ],
  ddtricks: '9a6879a6874375643756',
}

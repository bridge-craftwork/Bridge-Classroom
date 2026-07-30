// B2 · cardplay (server practice table, host-as-player). Same shared table as
// b2-bidding (board 4, Rick hosts South, Lia is North, East open, West a bot), now
// in play: South declares 4♠ after the auction, so North is the dummy everyone can
// see. Trick two is in progress.
//
// What this fixture exists to show that b2-bidding cannot (2026-07-29 audit): the
// SERVER rail in its play state — the Play card with the turn/waiting cue and the
// bot-latency note, the Double dummy card, PassBot and Kibitz — none of which was
// modelled in the gallery. Grid-side it also proves the play slots on the server
// path: TrickArea in CENTRE, completed auction PINNED at NE, SE dropped.
export default {
  label: 'B2 · cardplay (server)',
  surface: 'b2',
  seat: 'S',
  scenario: "Rick's table",
  board: 4,
  dealer: 'N',
  vulnerable: 'None',
  phase: 'play',
  contract: '4S',
  declarer: 'S',
  clickableSeat: 'S',
  nextSeat: 'S',
  hiddenSeats: ['E', 'W'], // declarer + dummy visible; the defenders are hidden
  tricksTaken: { NS: 1, EW: 1 },
  bids: ['Pass', '1S', 'Pass', '2S', 'Pass', '4S', 'Pass', 'Pass', 'Pass'],
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
  // Two tricks complete + two cards into trick three, so North (who has played to
  // all three) holds 10 and South holds 11.
  hands: {
    N: { spades: ['K', '7', '4'], hearts: ['Q', '9'], diamonds: ['A', 'J', '6'], clubs: ['K', '8'] },
    S: { spades: ['A', 'Q', 'J', '10', '8'], hearts: ['A', 'J'], diamonds: ['K', '10', '2'], clubs: ['J'] },
    E: {}, W: {},
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
  // Rail state (server-only cards the gallery previously never rendered).
  kibitzers: ['Marta'],
  // Table chat — no backend yet; this exercises the rail's future occupant so the
  // companion column can be sized for it before it ships.
  chat: [
    { from: 'Lia', text: 'nice lead' },
    { from: 'You', text: 'thanks — thought about the heart', own: true },
    { from: 'Marta', text: '(watching) tough defence here' },
  ],
  passBotSeats: ['E'],
  // Seat [N,S,E,W] × strain [NT,S,H,D,C]; NS/EW complement to 13 per strain.
  // South takes 10 at spades — the 4♠ contract makes exactly.
  ddtricks: '9a6879a6874375643756',
}

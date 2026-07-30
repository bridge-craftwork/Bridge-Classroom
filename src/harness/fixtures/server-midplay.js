// A live server table rendered from a FROZEN snapshot via the Phase-0.2 fixture
// driver (useRemoteTable.loadFixture) — no socket. This is the referee for the
// Phase-3 serverEngine refactor: drive the old server path and the new binding
// from this same snapshot and pixel-diff them.
//
// Mid-play: you are South and declarer in 4♥, so dummy (North) is revealed and
// on lead — you play dummy's card (clickableSeat resolves to N). Opponents E/W
// are hidden (counts only). Concrete on purpose (specific declarer/dummy, a
// finished trick, hidden defenders) so a seat-mapping regression can't hide.
//
// The `snapshot` matches useRemoteTable.captureFixture() output exactly, so real
// captures (window.__captureTableFixture() in a dev session) drop in here.
export default {
  label: 'server · mid-play (4♥ by S, playing dummy)',
  surface: 'server',
  snapshot: {
    sessionId: 'fixture',
    tableId: 't1',
    yourName: 'Rick',
    role: 'player',
    yourSeats: ['S'],
    myToken: null,
    roster: [],
    seeAll: false,
    botMode: 'rules',
    boardMode: 'bid-and-play',
    setLabel: 'Demo set',
    seq: 40,
    board: { number: 1, dealer: 'N', vulnerable: 'NS' },
    phase: 'play',
    auction: ['1H', 'Pass', '2H', 'Pass', '4H', 'Pass', 'Pass', 'Pass'],
    contract: { text: '4H', declarer: 'S' },
    nextToAct: 'N', // dummy on lead → declarer (you, S) plays dummy's card
    hands: {
      S: { spades: ['A', 'K'], hearts: ['A', 'K', 'Q', 'J', '9'], diamonds: ['7', '3'], clubs: ['8', '5'] },
      N: { spades: ['Q', 'J'], hearts: ['T', '8', '4'], diamonds: ['A', 'K', '5'], clubs: ['K', 'Q', '7'] },
      E: null,
      W: null,
    },
    handCounts: { N: 11, E: 11, S: 11, W: 11 },
    currentTrick: { leader: 'N', plays: [] },
    lastFinishedTrick: {
      leader: 'W',
      plays: [
        { seat: 'W', suit: 'C', rank: 'A' },
        { seat: 'N', suit: 'C', rank: '6' },
        { seat: 'E', suit: 'C', rank: '3' },
        { seat: 'S', suit: 'C', rank: '4' },
      ],
      winner: 'W',
    },
    tricksTaken: { NS: 1, EW: 1 },
    seats: {
      N: { kind: 'human', name: 'Snow White', connected: true },
      E: { kind: 'empty' },
      S: { kind: 'human', name: 'Rick', connected: true },
      W: { kind: 'empty' },
    },
    boardsOpen: null,
    boardComplete: null,
    sessionClosed: false,
  },
}

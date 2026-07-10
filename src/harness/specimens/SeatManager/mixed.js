// Host seat management: S is you, N a seated guest, E/W empty (bots), two people
// waiting on the bench.
export default {
  label: 'you + guest + empties + waiters',
  props: {
    seats: {
      N: { kind: 'human', name: 'Lia', connected: true },
      E: { kind: 'empty' },
      S: { kind: 'human', name: 'Rick Wilson', connected: true },
      W: { kind: 'empty' },
    },
    roster: [
      { token: 't-s', name: 'Rick Wilson', connected: true, seats: ['S'] },
      { token: 't-n', name: 'Lia', connected: true, seats: ['N'] },
      { token: 't-w1', name: 'Kemistry', connected: true, seats: [] },
      { token: 't-w2', name: 'Guest 2', connected: false, seats: [] },
    ],
    yourSeats: ['S'],
    myToken: 't-s',
    shareUrl: 'https://bridge-classroom.org/solo-practice-app/#/play/BRG-ABCD',
  },
}

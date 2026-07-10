// Host view: grabbable seat labels (human seats draggable) + the ⌄ pulldown.
export default {
  label: 'host manage (draggable labels + menu)',
  props: {
    hands: {
      N: { spades: ['K', '8', '4', '3'], hearts: ['10', '5', '4', '2'], diamonds: ['J', '6'], clubs: ['8', '6', '3'] },
      E: { spades: ['A', 'Q', 'J', '7'], hearts: ['K'], diamonds: ['Q', '7', '5'], clubs: ['A', '10', '9', '4', '2'] },
      S: { spades: ['9', '6', '2'], hearts: ['A', 'J', '7'], diamonds: ['K', '10', '8', '2'], clubs: ['J', '7', '5'] },
      W: { spades: ['10', '5'], hearts: ['Q', '9', '8', '6', '3'], diamonds: ['A', '9', '4', '3'], clubs: ['K', 'Q'] },
    },
    occupants: {
      N: { name: 'Lia', connected: true },
      E: { name: 'BBA+RulesBot' },
      S: { name: 'Rick Wilson', connected: true },
      W: { name: 'BBA+RulesBot' },
    },
    seats: {
      N: { kind: 'human', name: 'Lia', connected: true },
      E: { kind: 'empty' },
      S: { kind: 'human', name: 'Rick Wilson', connected: true },
      W: { kind: 'empty' },
    },
    yourSeats: ['S'],
    myToken: 't-s',
    canManage: true,
    activeSeat: 'S',
    compact: true,
  },
}

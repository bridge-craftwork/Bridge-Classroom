// Grid host view: the SAME occupant naming + seat management as `host`, but in
// the grid arrangement (arrangement='grid' + the table config) that the server
// host / local table actually render. Verifies that occupant NAMES (player names
// and bot labels like "BBA+RulesBot") reach the grid seat labels — the grid path
// derives seat names from `occupants`, not the A1 config-role badges.
import tableConfig from '../../../table-configs/table.tableConfig.js'

export default {
  label: 'host manage — grid (occupant names on grid seats)',
  props: {
    arrangement: 'grid',
    tableConfig,
    phase: 'bidding',
    heroSeat: 'S',
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
  },
}

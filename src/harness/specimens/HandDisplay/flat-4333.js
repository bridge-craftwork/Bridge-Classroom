// Flattest common shape — the everyday case; carries a 10 in a short suit.
export default {
  label: 'flat 4-3-3-3',
  props: {
    hand: { spades: ['K', 'Q', 'T', '2'], hearts: ['A', '8', '4'], diamonds: ['Q', 'J', '9'], clubs: ['K', '6', '3'] },
    seat: 'S',
    showHcp: true,
  },
}

// Flattest common shape — the everyday case; no suit is long or short.
export default {
  label: 'flat 4-3-3-3',
  props: {
    hand: { spades: ['K', 'Q', '7', '2'], hearts: ['A', '8', '4'], diamonds: ['Q', 'J', '9'], clubs: ['K', '6', '3'] },
    seat: 'S',
    showHcp: true,
  },
}

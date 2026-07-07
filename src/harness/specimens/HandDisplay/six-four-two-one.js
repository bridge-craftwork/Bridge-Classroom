// Distributional 6-4-2-1 — a long suit next to a singleton stresses row widths.
export default {
  label: '6-4-2-1',
  props: {
    hand: { spades: ['A', 'K', 'Q', 'J', '9', '4'], hearts: ['K', 'Q', '7', '3'], diamonds: ['A', '8'], clubs: ['5'] },
    seat: 'S',
    showHcp: true,
  },
}

// 9-card suit: compresses to ~0.78 (7/9) to fit the reserved width.
export default {
  label: '9-card suit',
  props: {
    hand: { spades: ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '4'], hearts: ['K'], diamonds: ['Q'], clubs: ['J', '3'] },
    showHcp: true,
  },
}

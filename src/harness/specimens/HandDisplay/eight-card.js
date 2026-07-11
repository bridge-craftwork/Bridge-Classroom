// 8-card suit (compression trigger): scales to ~0.875 to fit the reserved
// 7-card width instead of wrapping.
export default {
  label: '8-card suit',
  props: {
    hand: { spades: ['A', 'K', 'Q', 'J', 'T', '9', '7', '4'], hearts: ['K', '8'], diamonds: ['Q'], clubs: ['J', '3'] },
    showHcp: true,
  },
}

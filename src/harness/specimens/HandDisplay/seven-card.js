// 7-card suit (reserve boundary) with a 10 — the widest row + a two-glyph cell.
export default {
  label: '7-card suit',
  props: {
    hand: { spades: ['A', 'K', 'Q', 'J', 'T', '7', '4'], hearts: ['K', '8'], diamonds: ['Q', '5'], clubs: ['J', '3'] },
    showHcp: true,
  },
}

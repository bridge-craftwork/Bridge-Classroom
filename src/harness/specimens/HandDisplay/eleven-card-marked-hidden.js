// A mark on a LOW spade (the 4) that truncates out at narrow widths: the +N
// chip must show its indicator dot in-grid; the mark itself renders in the popup.
export default {
  label: '11-card · marked hidden card',
  props: {
    hand: { spades: ['A','K','Q','J','T','9','8','7','6','5','4'], hearts: ['K'], diamonds: ['Q'], clubs: [] },
    marks: { cards: { S4: { badge: 'DD' } } },
    clickable: true,
    showHcp: true,
  },
}

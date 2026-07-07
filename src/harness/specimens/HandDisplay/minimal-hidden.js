// Minimal + hidden: the compact suit-symbol row used for hidden E/W on desktop.
export default {
  label: 'minimal + hidden',
  props: {
    hand: { spades: ['A', 'K', 'T', '5'], hearts: ['A', 'K', '4'], diamonds: ['K', 'Q', 'T'], clubs: ['A', '7', '2'] },
    seat: 'W',
    hidden: true,
    minimal: true,
  },
}

// A hidden hand: the face-down card back (opponents you can't see).
export default {
  label: 'hidden (card back)',
  props: {
    hand: { spades: ['A', 'K', 'T', '5'], hearts: ['A', 'K', '4'], diamonds: ['K', 'Q', 'T'], clubs: ['A', '7', '2'] },
    seat: 'E',
    hidden: true,
  },
}

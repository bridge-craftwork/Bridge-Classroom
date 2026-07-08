// An opponent has bid (1♠) and it's your turn: the double control is live as
// "X" (orange). Levels above 1♠ / higher strains at the 1-level are biddable.
export default {
  label: 'can double (X active)',
  props: { lastBid: '1S', canDouble: true, canRedouble: false },
}

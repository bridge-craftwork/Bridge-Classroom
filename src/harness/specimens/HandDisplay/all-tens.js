// Width-jitter stressor: a 10 in every suit. Today each 10 is two glyphs wide;
// this specimen is where the future fixed-width cell will visibly snap to one.
export default {
  label: 'all tens',
  props: {
    hand: { spades: ['A', 'T', '9'], hearts: ['A', 'K', 'T', '4'], diamonds: ['T', '8'], clubs: ['A', 'T', '9', '2'] },
    showHcp: true,
  },
}

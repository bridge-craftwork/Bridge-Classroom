// Partial hand (showcards directive): fewer than 5 cards, empty suits omitted
// (dashes would imply voids), HCP suppressed. Carries a 10.
export default {
  label: 'partial (showcards)',
  props: {
    hand: { spades: ['A'], hearts: [], diamonds: ['K', 'T'], clubs: [] },
    seat: 'S',
    showHcp: true,
  },
}

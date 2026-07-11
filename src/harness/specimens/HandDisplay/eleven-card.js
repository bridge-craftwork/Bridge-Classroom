// 11-card freak (growth path): 7/11 ≈ 0.64 is below the ~0.65 floor, so the row
// holds at 0.65 and GROWS past the reserved 7-card width into the arranger's
// slack rather than compressing illegibly.
export default {
  label: '11-card suit',
  props: {
    hand: { spades: ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4'], hearts: ['K'], diamonds: ['Q'], clubs: [] },
    showHcp: true,
  },
}

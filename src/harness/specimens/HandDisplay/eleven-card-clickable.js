// Clickable twin of `eleven-card` (the plain, non-clickable counterpart). Same
// holding, `clickable: true` → the +N chip renders as a dressed pill (bordered,
// subtle bg, full-weight, tappable), the sole popup portal. View the two
// side-by-side at tile/narrow to compare the dressed vs plain chip vocabularies.
export default {
  label: '11-card suit · clickable (dressed pill)',
  props: {
    hand: { spades: ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4'], hearts: ['K'], diamonds: ['Q'], clubs: [] },
    clickable: true,
    showHcp: true,
  },
}

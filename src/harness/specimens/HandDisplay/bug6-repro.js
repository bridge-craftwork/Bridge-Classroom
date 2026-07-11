// Repro of bug-artifacts #6: a1 South hand (2over1 deal 4). Non-clickable
// bidding hand in a narrow panel — hearts truncate to "A 9 +3" (stranded, no
// popup) while clubs (4) fit. Diagnosing over-aggressive truncation.
export default {
  label: 'bug6 · a1 south (non-clickable)',
  props: {
    hand: { spades: ['Q'], hearts: ['A', '9', '5', '4', '3'], diamonds: ['9', '6', '2'], clubs: ['A', '7', '4', '2'] },
    showHcp: true,
  },
}

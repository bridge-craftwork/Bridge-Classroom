// Item 4 acceptance — badge containment + scale coupling, isolated from the
// other channels (no fills/played/active noise). Badges sit where they'd clip:
//   SA — first row, top-left: proves the top edge no longer crops the pill.
//   S7 — the long suit's last card: rides the compression as spades shrink, and
//        when the 8-card suit fills the width it proves the right edge is clear.
//   H5 — a short suit's rightmost card: badge on a card that isn't at the frame.
// Walk across widths × scales: pills scale with their row and never clip.
export default {
  label: 'badges at edges (containment)',
  props: {
    hand: { spades: ['A', 'K', 'Q', 'J', 'T', '9', '8', '7'], hearts: ['A', 'K', '5'], diamonds: ['Q', '4'], clubs: ['3'] },
    marks: {
      cards: {
        SA: { badge: 'DD' },
        S7: { badge: 'R' },
        H5: { badge: '2' },
      },
    },
    showHcp: true,
  },
}

// The player's own live hand: clickable cells + the active-seat frame, with two
// cards already played+struck in the flex row (incl. a struck 10). Interaction
// (clickable) and the frame (marks.activeSeat) are now separate concerns.
export default {
  label: 'clickable (live hand)',
  props: {
    hand: { spades: ['A', 'K', 'T', '5'], hearts: ['A', 'K', '4'], diamonds: ['K', 'Q', 'T'], clubs: ['A', '7', '2'] },
    seat: 'S',
    clickable: true,
    marks: { cards: { SA: { played: true }, DT: { played: true } }, activeSeat: true },
  },
}

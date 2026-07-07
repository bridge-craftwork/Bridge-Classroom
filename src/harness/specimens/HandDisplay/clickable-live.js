// The player's own live hand: clickable cells (blue frame), with two cards
// already played+struck in the flex row (incl. a struck 10) — the interactive
// rendering Slice 3/4 also touch.
export default {
  label: 'clickable (live hand)',
  props: {
    hand: { spades: ['A', 'K', 'T', '5'], hearts: ['A', 'K', '4'], diamonds: ['K', 'Q', 'T'], clubs: ['A', '7', '2'] },
    seat: 'S',
    clickable: true,
    playedCards: ['SA', 'DT'],
  },
}

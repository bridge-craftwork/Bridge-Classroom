// Mid-play: a 10 remains (spades) and a 10 is played+hidden (diamonds) — so a
// two-glyph cell must collapse out cleanly while another stays put.
export default {
  label: 'mid-play (cards gone)',
  props: {
    hand: { spades: ['A', 'K', 'T', '5'], hearts: ['A', 'K', '4'], diamonds: ['K', 'Q', 'T'], clubs: ['A', '7', '2'] },
    seat: 'S',
    playedCards: ['SA', 'DT', 'C2'],
    hidePlayedCards: true,
  },
}

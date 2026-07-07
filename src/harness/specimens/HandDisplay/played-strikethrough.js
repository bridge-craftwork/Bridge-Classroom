// Played cards, strikethrough (review) mode — the OTHER played state next to
// midplay-cards-gone (same hand + played set, hidePlayedCards off). Includes a
// struck 10 (♦T). This strikethrough is what Slice 4 replaces with cell-collapse
// in live play while keeping it for review, so the gallery captures it now.
export default {
  label: 'played · strikethrough',
  props: {
    hand: { spades: ['A', 'K', 'T', '5'], hearts: ['A', 'K', '4'], diamonds: ['K', 'Q', 'T'], clubs: ['A', '7', '2'] },
    seat: 'S',
    playedCards: ['SA', 'DT', 'C2'],
    hidePlayedCards: false,
  },
}

// Played cards, strikethrough (review) mode — same hand + played marks as
// midplay-cards-gone, but shown struck (hidePlayedCards off). Includes a struck
// 10 (♦T). Slice 4 replaces this strikethrough with cell-collapse in live play.
export default {
  label: 'played · strikethrough',
  props: {
    hand: { spades: ['A', 'K', 'T', '5'], hearts: ['A', 'K', '4'], diamonds: ['K', 'Q', 'T'], clubs: ['A', '7', '2'] },
    marks: { cards: { SA: { played: true }, DT: { played: true }, C2: { played: true } } },
  },
}

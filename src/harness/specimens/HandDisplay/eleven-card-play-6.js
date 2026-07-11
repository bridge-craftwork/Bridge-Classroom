export default {
  label: '11-card · 6 played',
  props: {
    hand: { spades: ['A','K','Q','J','T','9','8','7','6','5','4'], hearts: ['K'], diamonds: ['Q'], clubs: [] },
    marks: { cards: { SA: { played: true }, SK: { played: true }, SQ: { played: true }, SJ: { played: true }, ST: { played: true }, S9: { played: true } } },
    hidePlayedCards: true,
    showHcp: true,
  },
}

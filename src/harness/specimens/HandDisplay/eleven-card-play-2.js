// 11-card play sequence, 2 spades played (A K). As high spades leave, the suit
// shrinks and the +N chip shrinks monotonically — never grows. hidePlayedCards.
export default {
  label: '11-card · 2 played',
  props: {
    hand: { spades: ['A','K','Q','J','T','9','8','7','6','5','4'], hearts: ['K'], diamonds: ['Q'], clubs: [] },
    marks: { cards: { SA: { played: true }, SK: { played: true } } },
    hidePlayedCards: true,
    showHcp: true,
  },
}

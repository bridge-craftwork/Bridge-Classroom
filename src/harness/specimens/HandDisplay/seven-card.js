// 7-card suit — the width-reservation boundary (~99.5% of hands fit in 7).
export default {
  label: '7-card suit',
  props: {
    hand: { spades: ['A', 'K', 'Q', 'J', '9', '7', '4'], hearts: ['K', '8'], diamonds: ['Q', '5'], clubs: ['J', '3'] },
    seat: 'S',
    showHcp: true,
  },
}

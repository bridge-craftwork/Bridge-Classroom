// Mid-play: four cards already played and hidden (real-bridge default), so the
// remaining shape must read true with cells collapsed out.
export default {
  label: 'mid-play (cards gone)',
  props: {
    hand: { spades: ['A', 'K', 'Q', '5'], hearts: ['A', 'K', '4'], diamonds: ['K', 'Q', '3'], clubs: ['A', '7', '2'] },
    seat: 'S',
    playedCards: ['SA', 'HK', 'DQ', 'C2'],
    hidePlayedCards: true,
  },
}

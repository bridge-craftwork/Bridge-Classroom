// Hidden seat: no holding — the chip carries the card count instead.
export default {
  label: 'hidden (chip + count)',
  props: { seat: 'E', hand: { spades: ['K', 'Q', 'T', '2'], hearts: ['A', '8', '4'], diamonds: ['Q', 'J', '9'], clubs: ['K', '6', '3'] }, hidden: true },
}

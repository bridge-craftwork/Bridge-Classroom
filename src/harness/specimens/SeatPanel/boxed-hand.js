// The table seat: box + compass name + holding — reproduces the old boxed hand.
export default {
  label: 'boxed hand (full density)',
  props: { seat: 'S', hand: { spades: ['K', 'Q', 'T', '2'], hearts: ['A', '8', '4'], diamonds: ['Q', 'J', '9'], clubs: ['K', '6', '3'] }, showHcp: true },
}

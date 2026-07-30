// Hidden seat with a NAMED occupant — the multiplayer case, and the one that
// broke (2026-07-30 report). The count used to sit in SeatIndicator's adorn slot,
// which is subtracted from the name's width budget, so "BBA+RulesBot" collapsed to
// "BB…". The count now takes its own row and the name gets the full width.
//
// A long bot handle is the stress case on purpose: real player names are longer
// still, and the seat is only ~190px wide at these densities.
export default {
  label: 'hidden + NAMED (count on its own row)',
  props: {
    seat: 'E',
    name: 'BBA+RulesBot',
    presence: 'connected',
    hand: { spades: ['K', 'Q', 'T', '2'], hearts: ['A', '8', '4'], diamonds: ['Q', 'J', '9'], clubs: ['K', '6', '3'] },
    hidden: true,
    phase: 'play',
  },
}

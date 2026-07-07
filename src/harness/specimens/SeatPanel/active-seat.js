// On turn: the active-seat frame (from marks.activeSeat) around the same box.
export default {
  label: 'active seat (on-turn frame)',
  props: { seat: 'S', hand: { spades: ['K', 'Q', 'T', '2'], hearts: ['A', '8', '4'], diamonds: ['Q', 'J', '9'], clubs: ['K', '6', '3'] }, showHcp: true, marks: { activeSeat: true } },
}

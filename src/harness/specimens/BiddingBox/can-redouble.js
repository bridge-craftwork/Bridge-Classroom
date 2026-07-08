// Your side's bid was doubled by an opponent: the same control switches to "XX"
// (blue) to redouble. canDouble and canRedouble are never both true, which is
// exactly why one control can serve both.
export default {
  label: 'can redouble (XX active)',
  props: { lastBid: '1S', canDouble: false, canRedouble: true },
}

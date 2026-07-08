// Opening bid: nothing to double yet, so the single double/redouble control is
// a disabled "X". This is the host-table screenshot state — now Pass + X fit any
// rail width without spilling.
export default {
  label: 'opening (X disabled)',
  props: { lastBid: null, canDouble: false, canRedouble: false },
}

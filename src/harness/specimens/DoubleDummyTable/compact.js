// Corner form: the air comes out of the sides, then the type steps down. This is what
// the SE grid corner renders at review, and what doubleDummyReservePx() mirrors.
export default {
  label: 'compact (grid corner)',
  props: {
    ddtricks: '64748647487969579695',
    finalContract: { contract: '1H', declarer: 'S' },
    compact: true,
  },
}

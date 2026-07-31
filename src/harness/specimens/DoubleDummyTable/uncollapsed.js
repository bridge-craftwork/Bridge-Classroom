// N and S disagree, so that pair stays split while E/W still merges. This is the
// case worth looking at, and it is exactly when the collapse declines to hide it.
export default {
  label: 'pair disagrees → N / S / EW (3 rows)',
  props: {
    ddtricks: '12345' + '54321' + '66666' + '66666',
    finalContract: { contract: '2H', declarer: 'S' },
    compact: true,
  },
}

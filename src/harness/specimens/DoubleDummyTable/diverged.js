// The contract cell reads pink rather than green when the auction diverged from the
// BBA reference — same grid, different verdict.
export default {
  label: 'compact · contract diverged',
  props: {
    ddtricks: '64748647487969579695',
    finalContract: { contract: '3NT', declarer: 'N' },
    compact: true,
    diverged: true,
  },
}

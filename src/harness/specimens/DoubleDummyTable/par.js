// Par contract + score, the optional line under the grid. Both halves are independent
// — either may be given alone.
export default {
  label: 'collapsed + par contract & score',
  props: {
    ddtricks: '77777' + '77777' + '66666' + '66666',
    finalContract: { contract: '3NT', declarer: 'N' },
    compact: true,
    par: { contract: '4S', declarer: 'S', score: 620 },
  },
}

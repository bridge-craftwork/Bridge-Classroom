// Transposed for a NARROW corner: declarers across the top, strains down the side.
// Five strain rows over two declarer columns is far thinner than the upright grid —
// the shape a starved corner actually wants.
export default {
  label: 'rotated · collapsed (narrow corner)',
  props: {
    ddtricks: '77777' + '77777' + '66666' + '66666',
    finalContract: { contract: '3NT', declarer: 'N' },
    compact: true,
    rotated: true,
  },
}

// Play: contract + contract-relative tricks ("NS 7 · needs 10") with the
// minimal vul glyph so the count leads.
import { deriveStatus } from '../../../composables/engines/useTableStatus.js'
export default {
  label: 'play · contract + tricks vs target',
  props: {
    status: deriveStatus({
      phase: 'play',
      dealer: 'N',
      vulnerable: 'NS',
      contract: { text: '4H', declarer: 'S' },
      tricks: { NS: 7, EW: 3 },
    }),
  },
}

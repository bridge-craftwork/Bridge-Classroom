// Review: made with an overtrick.
import { deriveStatus } from '../../../composables/engines/useTableStatus.js'
export default {
  label: 'review · made +1',
  props: {
    status: deriveStatus({
      phase: 'review',
      dealer: 'N',
      vulnerable: 'None',
      contract: { text: '4H', declarer: 'S' },
      tricks: { NS: 11, EW: 2 },
    }),
  },
}

// Review: defeated contract.
import { deriveStatus } from '../../../composables/engines/useTableStatus.js'
export default {
  label: 'review · down 2',
  props: {
    status: deriveStatus({
      phase: 'review',
      dealer: 'E',
      vulnerable: 'EW',
      contract: { text: '3NT', declarer: 'E' },
      tricks: { NS: 6, EW: 7 },
      played: true,
    }),
  },
}

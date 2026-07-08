// Stress: the widest contract (grand slam, redoubled) with both sides
// vulnerable — the layout must hold and the doubling must render.
import { deriveStatus } from '../../../composables/engines/useTableStatus.js'
export default {
  label: 'stress · 7NTXX, all vul (mid-play)',
  props: {
    status: deriveStatus({
      phase: 'play',
      dealer: 'S',
      vulnerable: 'All',
      contract: { text: '7NTXX', declarer: 'W' },
      tricks: { NS: 2, EW: 9 },
    }),
  },
}

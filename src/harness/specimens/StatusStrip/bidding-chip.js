// Bidding at chip density → text-pill fallback (tile width, item 3).
import { deriveStatus } from '../../../composables/engines/useTableStatus.js'
export default {
  label: 'bidding · chip fallback (pills)',
  props: { board: 7, density: 'chip', status: deriveStatus({ phase: 'bidding', dealer: 'N', vulnerable: 'NS' }) },
}

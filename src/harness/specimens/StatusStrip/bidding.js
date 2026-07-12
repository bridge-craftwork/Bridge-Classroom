// Bidding: no contract yet, so the strip shows dealer + vulnerability.
import { deriveStatus } from '../../../composables/engines/useTableStatus.js'
export default {
  label: 'bidding · dealer + vul',
  props: { status: deriveStatus({ phase: 'bidding', dealer: 'N', vulnerable: 'NS' }) },
}

// Bidding: no contract yet → the board · dealer · vul glyph (vul-diamond).
import { deriveStatus } from '../../../composables/engines/useTableStatus.js'
export default {
  label: 'bidding · vul-diamond',
  props: { board: 7, status: deriveStatus({ phase: 'bidding', dealer: 'N', vulnerable: 'NS' }) },
}

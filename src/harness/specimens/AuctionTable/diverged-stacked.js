// The BBA-tracked "your bid vs BBA's bid" case: some cells carry BOTH bids
// stacked, the rejected one struck through, with per-cell toggle enabled. This
// is the layout that skews the grid — a stacked cell's content is far wider than
// a plain "1♠", so under the old per-row flex it stole width from its row only.
// Three divergences on purpose: idx1 lives on BBA's bid (● on the BBA row),
// idx2 and idx4 live on the user's (● on the You row), and idx4 pits a wide
// "Pass" against "3♠" — the widest realistic stacked cell.
export default {
  label: 'diverged · you vs BBA (stacked + toggle)',
  props: {
    dealer: 'N',
    bids: ['1D', '2C', '2S', '3C', 'Pass', 'Pass'],
    currentBidIndex: -1,
    showTurnIndicator: false,
    allowDivergenceToggle: true,
    divergedBids: {
      1: { user: 'X', bba: '2C' },   // BBA's bid is live
      2: { user: '2S', bba: '3D' },  // your bid is live
      4: { user: 'Pass', bba: '3S' }, // your bid is live — widest stacked cell
    },
  },
}

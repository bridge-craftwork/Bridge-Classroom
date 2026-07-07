// Full four-seat table with played cards (struck) and an active/clickable South.
// BridgeTable's external props are unchanged by Slice 3 — it now builds the
// per-seat `marks` internally — so this same specimen renders on both main and
// this branch, pixel-diffing BridgeTable's marks-building for free.
export default {
  label: 'played + active South',
  props: {
    hands: {
      N: { spades: ['A', 'K', '5'], hearts: ['Q', 'J', '9', '2'], diamonds: ['K', '7'], clubs: ['A', 'T', '8', '3'] },
      E: { spades: ['Q', 'J', 'T'], hearts: ['A', 'K', '5'], diamonds: ['Q', 'J', '9', '4'], clubs: ['K', 'Q', '6'] },
      S: { spades: ['9', '8', '7'], hearts: ['T', '8', '6', '4', '3'], diamonds: ['A', '8'], clubs: ['9', '7', '2'] },
      W: { spades: ['6', '4', '3', '2'], hearts: ['7'], diamonds: ['T', '6', '5', '3', '2'], clubs: ['J', '5', '4'] },
    },
    showHcp: true,
    clickableSeat: 'S',
    playedCards: { N: ['HQ'], E: ['SQ'], S: ['H8', 'DA'], W: ['D6'] },
  },
}

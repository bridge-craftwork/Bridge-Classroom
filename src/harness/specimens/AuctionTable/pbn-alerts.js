// A Baker lesson's alerts ([Note] / =N= in the PBN, issue #475): 4NT and 5♦
// carry notes, shown dotted-underlined with the note on hover.
export default {
  label: 'PBN alerts (Blackwood)',
  props: {
    dealer: 'S',
    bids: ['1D', 'Pass', '2C', 'Pass', '3D', 'Pass', '4NT', 'Pass', '5D', 'Pass', '6D', 'Pass', 'Pass', 'Pass'],
    meanings: [
      { position: 6, bid: '4NT', meaning: 'Blackwood', isAlert: true },
      { position: 8, bid: '5D', meaning: '1 ace', isAlert: true },
    ],
  },
}

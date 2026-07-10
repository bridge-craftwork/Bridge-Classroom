// The card-selector popup open on an 11-card spade suit — the ONLY place cards
// wrap. All 11 present as ≥44px tap targets across continuation lines (hanging
// indent, no repeated symbol); the 4 carries a mark.
//
// The popup renders as it really does — fixed overlay, anchored — so the frame
// crop would miss it. `capture` tells the walker to photograph the popup element
// itself (locator screenshot), which is more honest than a synthetic in-flow mode.
export default {
  label: 'card selector · 11-card suit',
  capture: '.cs-popup',
  props: {
    suit: 'spades',
    anchor: { top: 24, left: 24 },
    cards: [
      { rank: 'A' }, { rank: 'K' }, { rank: 'Q' }, { rank: 'J' }, { rank: 'T' },
      { rank: '9' }, { rank: '8' }, { rank: '7' }, { rank: '6' }, { rank: '5' },
      { rank: '4', badge: 'DD' },
    ],
  },
}

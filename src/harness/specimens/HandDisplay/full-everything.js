// The noise-ceiling reference: a dense hand (7-card suit + tens) carrying every
// channel at once — played (strikethrough), active-seat (frame), plus the
// generic placeholder channels `fill` (background tint) and `badge` (corner
// chip) that stand in for future marks (recommendation, dd-error, group…).
// Answers "how big must a cell get to hold all annotations." Harness-only:
// production emits no fill/badge, so real hands never grow one.
export default {
  label: 'full-everything (placeholder channels)',
  props: {
    hand: { spades: ['A', 'K', 'Q', 'J', 'T', '7', '4'], hearts: ['A', 'K', '4'], diamonds: ['K', 'Q'], clubs: ['A'] },
    marks: {
      cards: {
        SA: { played: true },
        SK: { fill: '#e3f2fd' },
        ST: { badge: 'DD' },
        S7: { fill: '#fff3cd', badge: 'R' },
        HA: { badge: '2' },
        HK: { played: true },
        DK: { fill: '#f3e5f5' },
        CA: { badge: 'W' },
      },
      activeSeat: true,
    },
  },
}

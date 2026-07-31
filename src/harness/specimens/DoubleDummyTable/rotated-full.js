// Rotated with all four declarers — the widest the rotated form gets, and the number
// doubleDummyReservePx({ rotated: true, rows: 4 }) has to cover.
export default {
  label: 'rotated · 4 declarers',
  props: {
    ddtricks: '12345' + '54321' + '13579' + '97531',
    finalContract: { contract: '4S', declarer: 'W' },
    compact: true,
    rotated: true,
  },
}

// The NW transport at its fullest: restart, restart-cardplay, next. Icon-only and
// wrapping at two per row, so the cluster never grows wider than the board glyph
// it sits under — see clusterMetrics.dealControlsReservePx.
export default {
  label: 'all three · icons, wrapped 2-up',
  props: { canRestart: true, canNext: true, showRestartCardplay: true, canRestartCardplay: true },
}

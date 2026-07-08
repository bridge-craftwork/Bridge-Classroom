// Teacher mode: a stat line + command buttons (display-only in the gallery).
export default {
  label: 'teacher (controls)',
  props: {
    mode: 'teacher',
    title: 'Teacher',
    stat: '4 tables · 3 seated · 1 diverged',
    actions: [
      { label: 'Next board', kind: 'primary' },
      { label: 'Pause bots' },
      { label: 'Resync' },
      { label: 'End session', kind: 'danger' },
    ],
  },
}

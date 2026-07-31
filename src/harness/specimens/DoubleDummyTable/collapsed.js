// Both partnerships agree in every strain, so each pair merges to one row — the
// common case, and the reason `collapse` defaults on. Lossless: a pair only merges
// when every cell already matches.
export default {
  label: 'collapsed → NS / EW (2 rows)',
  props: {
    ddtricks: '77777' + '77777' + '66666' + '66666',
    finalContract: { contract: '3NT', declarer: 'N' },
    compact: true,
  },
}

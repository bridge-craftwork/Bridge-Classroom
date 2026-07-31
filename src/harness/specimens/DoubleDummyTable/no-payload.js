// A short/absent ddtricks renders NOTHING, deliberately: ddTrickAt returns 0 for any
// character it can't read, so a truncated payload would otherwise draw a full grid of
// confident zeros — a table claiming every contract makes nothing. hasDdTricks() is
// the guard, and this specimen pins that "no table" is the honest rendering.
export default {
  label: 'short payload → renders nothing',
  props: { ddtricks: '123', finalContract: { contract: '', declarer: null } },
}

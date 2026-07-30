// The SE corner during cardplay: Undo beside Claim, with the bot status line that
// took over from the removed Cardplay rail panel.
export default {
  label: 'cardplay · undo + claim + bot status',
  props: { canUndo: true, showClaim: true, canClaim: true, botStatus: 'BEN thinking…' },
}

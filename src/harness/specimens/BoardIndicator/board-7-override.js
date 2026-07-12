// Non-standard board: the A1 bidding fixture is "board 7" but dealt by North
// with NS vul (the 16-cycle would derive dealer S / all-vul). Exercises the
// dealer + vulnerable override props (§4).
export default { label: 'Board 7 · override (dealer N, NS vul)', props: { boardNumber: 7, size: 130, dealer: 'N', vulnerable: 'NS' } }

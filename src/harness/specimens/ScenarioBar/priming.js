// Before any deal exists — the bar carries the instructions instead of a deal name.
export default {
  label: 'no deal yet · priming',
  props: {
    name: 'No deal yet',
    meta: ['You sit South; three BBA bots fill the other seats.', 'Pick a deal source to start bidding.'],
  },
  slots: { actions: '<button class="bp-btn">Deal source…</button>' },
}

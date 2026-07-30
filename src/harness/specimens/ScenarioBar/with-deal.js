// The everyday state: a named deal, the convention cards in play, and the actions
// that change the deal. Note the layout the component exists to protect — actions
// ABOVE, info full-width beneath.
export default {
  label: 'deal loaded · name + convention cards',
  props: {
    name: 'New Minor Force',
    meta: ['CC · NS: 21GF-DEFAULT · EW: 21GF-GIB'],
  },
  slots: {
    actions:
      '<button class="bp-btn">Deal source…</button>' +
      '<button class="bp-btn">Invite friends…</button>' +
      '<button class="bp-btn">Description</button>',
  },
}

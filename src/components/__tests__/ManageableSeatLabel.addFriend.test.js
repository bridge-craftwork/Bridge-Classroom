import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ManageableSeatLabel from '../table/ManageableSeatLabel.vue'
import { useFriends } from '../../composables/useFriends.js'
import { useUserStore } from '../../composables/useUserStore.js'

// The "Add friend" affordance on a seat label is the ONLY route into the
// friends feature — ADR-0005 ships no user search, so if this button doesn't
// appear for the right people, a friends list can never be seeded at all.
// These tests pin who it's offered to.

vi.mock('../../composables/useUserStore.js', () => {
  const { ref } = require('vue')
  const currentUser = ref({ id: 'u-me', firstName: 'Me', lastName: 'Myself' })
  return { useUserStore: () => ({ currentUser }) }
})

const ME = 'u-me'
const THEM = 'u-them'

function seatLabel({ roster, canManage = false, seat = 'N' } = {}) {
  return mount(ManageableSeatLabel, {
    props: {
      seat,
      name: 'Someone',
      seats: { N: { kind: 'human' }, S: { kind: 'human' } },
      yourSeats: ['S'],
      canManage,
      myToken: 'tok-me',
      roster,
    },
    global: { stubs: { SeatChip: true } },
  })
}

/** A roster entry for a seat. `account_id: null` = a guest. */
const entry = (seat, account_id) => ({
  token: `tok-${seat}`,
  name: 'Someone',
  connected: true,
  seats: [seat],
  account_id,
})

const openMenu = async (w) => {
  await w.find('.msl').trigger('click')
  return w
}
const friendBtn = (w) => w.find('.msl-friend')
const note = (w) => w.find('.msl-note')

describe('ManageableSeatLabel — Add friend', () => {
  beforeEach(() => {
    const f = useFriends()
    f.reset()
    // `loaded` short-circuits the lazy fetch so the component never calls out.
    f.loaded.value = true
  })

  it('offers Add friend to a plain player (no host powers)', async () => {
    const w = await openMenu(seatLabel({ roster: [entry('N', THEM)], canManage: false }))
    expect(friendBtn(w).exists()).toBe(true)
    expect(friendBtn(w).text()).toContain('Add friend')
  })

  it('does NOT offer it for a guest (no account_id)', async () => {
    // Guests cannot be friended — ADR-0005 §2.
    const w = await openMenu(seatLabel({ roster: [entry('N', null)] }))
    expect(friendBtn(w).exists()).toBe(false)
    expect(note(w).exists()).toBe(false)
  })

  it('does NOT offer it against an older table service that omits account_id', async () => {
    // Forward-compatibility: the two deploys can land in either order.
    const stale = { token: 'tok-N', name: 'Someone', connected: true, seats: ['N'] }
    const w = await openMenu(seatLabel({ roster: [stale] }))
    expect(friendBtn(w).exists()).toBe(false)
  })

  it('does NOT offer it against yourself', async () => {
    const w = await openMenu(seatLabel({ roster: [entry('N', ME)] }))
    expect(friendBtn(w).exists()).toBe(false)
  })

  it('shows "Already friends" instead of the button once befriended', async () => {
    const f = useFriends()
    f.friends.value = [{ user_id: THEM, name: 'Someone', friends_since: 'now' }]
    const w = await openMenu(seatLabel({ roster: [entry('N', THEM)] }))
    expect(friendBtn(w).exists()).toBe(false)
    expect(note(w).text()).toBe('Already friends')
  })

  it('shows "Friend request sent" while one is outstanding', async () => {
    const f = useFriends()
    f.outgoing.value = [{ id: 'r1', user_id: THEM, name: 'Someone', created_at: 'now' }]
    const w = await openMenu(seatLabel({ roster: [entry('N', THEM)] }))
    expect(friendBtn(w).exists()).toBe(false)
    expect(note(w).text()).toBe('Friend request sent')
  })

  it('points at the Friends tab when THEY have already asked YOU', async () => {
    const f = useFriends()
    f.incoming.value = [{ id: 'r1', user_id: THEM, name: 'Someone', created_at: 'now' }]
    const w = await openMenu(seatLabel({ roster: [entry('N', THEM)] }))
    expect(note(w).text()).toContain('Friends tab')
  })

  it('opens a menu for a non-host ONLY when there is something in it', async () => {
    // A non-host clicking a bot/empty seat should get no menu at all, rather
    // than an empty popover.
    const bot = mount(ManageableSeatLabel, {
      props: {
        seat: 'N',
        name: 'Bot',
        seats: { N: { kind: 'bot' } },
        yourSeats: ['S'],
        canManage: false,
        roster: [],
      },
      global: { stubs: { SeatChip: true } },
    })
    await bot.find('.msl').trigger('click')
    expect(bot.find('.msl-menu').exists()).toBe(false)
  })

  it('still shows host controls for a host, alongside Add friend', async () => {
    const w = await openMenu(seatLabel({ roster: [entry('N', THEM)], canManage: true }))
    expect(friendBtn(w).exists()).toBe(true)
    const labels = w.findAll('.msl-item').map((b) => b.text())
    expect(labels).toContain('Kick from table')
  })
})

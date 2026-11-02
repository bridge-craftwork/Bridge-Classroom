import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

const user = ref(null)
const isViewingAs = ref(false)
vi.mock('../../composables/useUserStore.js', () => ({
  useUserStore: () => ({ currentUser: user, isViewingAs, updateUser: vi.fn() }),
}))
vi.mock('../../composables/useAppConfig.js', () => ({
  useAppConfig: () => new Proxy({ setUIPref: vi.fn(), clearConfig: vi.fn() }, {
    get: (target, key) => target[key] ?? ref(false), // any other setting: an off toggle
  }),
}))
vi.mock('../../composables/useAssignmentStore.js', () => ({
  useAssignmentStore: () => ({ getAllAssignments: () => [] }),
}))

import SettingsPanel from '../SettingsPanel.vue'

const grants = [
  { id: 'g-teacher', grantor_id: 'stu', grantee_id: 'v-teacher', grantee_name: 'Tess Teacher' },
  { id: 'g-admin', grantor_id: 'stu', grantee_id: 'v-admin', grantee_name: 'Site Admin' },
]
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

function routes(over = {}) {
  return vi.fn(async (url, options = {}) => {
    const u = String(url)
    if (options.method === 'DELETE') return over.delete ? over.delete(u) : json({ success: true })
    if (u.includes('/keys/admin')) return over.admin ? over.admin() : json({ viewer_id: 'v-admin' })
    if (u.includes('/grants?')) return over.grants ? over.grants() : json({ grants })
    return json({})
  })
}

const stopButtons = (w) => w.findAll('button').filter(b => b.text().startsWith('Stop'))
const open = async () => {
  const w = mount(SettingsPanel, { props: { visible: true } })
  await flushPromises()
  return w
}

describe('SettingsPanel: Stop sharing (#16)', () => {
  beforeEach(() => {
    user.value = { id: 'stu', firstName: 'S', lastName: 'T', email: 's@t', classrooms: [] }
    isViewingAs.value = false
    vi.stubGlobal('fetch', routes())
    vi.stubGlobal('confirm', vi.fn(() => true))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('lists teacher grants for this student, without the admin grant', async () => {
    const w = await open()
    const url = fetch.mock.calls.map(([u]) => String(u)).find(u => u.includes('/grants?'))
    expect(url).toContain('grantor_id=stu')
    expect(w.text()).toContain('Tess Teacher')
    expect(w.text()).not.toContain('Site Admin')
    expect(stopButtons(w)).toHaveLength(1)
  })

  it('hides the section when there is nothing to stop', async () => {
    vi.stubGlobal('fetch', routes({ grants: () => json({ grants: [] }) }))
    const w = await open()
    expect(w.text()).not.toContain('Sharing My Data')
  })

  it('does nothing until the panel opens', async () => {
    mount(SettingsPanel, { props: { visible: false } })
    await flushPromises()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('revokes the grant after confirming, and removes the row', async () => {
    const w = await open()
    await stopButtons(w)[0].trigger('click')
    await flushPromises()
    const del = fetch.mock.calls.find(([, o]) => o?.method === 'DELETE')
    expect(String(del[0])).toMatch(/\/grants\/g-teacher$/)
    expect(w.text()).not.toContain('Tess Teacher')
  })

  it('says what stopping does and does not do', async () => {
    const w = await open()
    await stopButtons(w)[0].trigger('click')
    const text = confirm.mock.calls[0][0]
    expect(text).toContain('Tess Teacher')
    expect(text).toContain("can't be taken back")
    expect(text).toContain('still see your assignment progress')
    expect(text).toContain('turns sharing back on')
  })

  it('does not revoke when the confirmation is declined', async () => {
    confirm.mockReturnValue(false)
    const w = await open()
    await stopButtons(w)[0].trigger('click')
    await flushPromises()
    expect(fetch.mock.calls.some(([, o]) => o?.method === 'DELETE')).toBe(false)
    expect(w.text()).toContain('Tess Teacher')
  })

  it('keeps the row and shows an error when the revoke fails', async () => {
    vi.stubGlobal('fetch', routes({ delete: () => json({}, 500) }))
    const w = await open()
    await stopButtons(w)[0].trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Tess Teacher')
    expect(w.find('[role="alert"]').text()).toContain('Could not stop sharing')
    expect(stopButtons(w)[0].attributes('disabled')).toBeUndefined()
  })

  it('shows an error, not an empty list, when grants cannot load', async () => {
    vi.stubGlobal('fetch', routes({ grants: () => json({}, 500) }))
    const w = await open()
    expect(w.find('[role="alert"]').exists()).toBe(true)
  })

  it('does not list anything if it cannot tell which grant is the admin one', async () => {
    vi.stubGlobal('fetch', routes({ admin: () => json({}, 500) }))
    const w = await open()
    expect(w.text()).not.toContain('Site Admin')
    expect(stopButtons(w)).toHaveLength(0)
  })

  it('still lists teachers when no admin is configured', async () => {
    vi.stubGlobal('fetch', routes({ admin: () => json({}, 404), grants: () => json({ grants: [grants[0]] }) }))
    const w = await open()
    expect(stopButtons(w)).toHaveLength(1)
  })

  it('is not available during an admin View as', async () => {
    isViewingAs.value = true
    const w = await open()
    expect(fetch.mock.calls.some(([u]) => String(u).includes('/grants?'))).toBe(false)
    expect(w.text()).not.toContain('Sharing My Data')
  })
})

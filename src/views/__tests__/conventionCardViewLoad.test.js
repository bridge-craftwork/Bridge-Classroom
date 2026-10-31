import { describe, it, expect, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'

// Refreshing #/convention-card?card=<id> loaded the card before the user
// store was hydrated, so the request went out without viewer_id and the API
// read the private card as anonymous: 403 "Failed to load card".

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), resolve: () => ({ href: '#' }), currentRoute: { value: {} } }),
  useRoute: () => ({ params: {}, query: { card: 'card-1' }, path: '/convention-card', hash: '' }),
}))

const { apiFetch } = vi.hoisted(() => ({
  apiFetch: vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}), text: async () => '' }),
}))
vi.mock('../../utils/apiFetch.js', () => ({ apiFetch, API_KEY: 'test' }))

describe('ConventionCardView', () => {
  it('loads the address\'s card as the signed-in user on a fresh page', async () => {
    localStorage.setItem('bridgePractice', JSON.stringify({
      users: { 'user-1': { id: 'user-1', firstName: 'Pat' } },
      currentUserId: 'user-1',
    }))
    const mod = await import('../ConventionCardView.vue')
    const wrapper = shallowMount(mod.default, {
      global: { stubs: { RouterLink: true, RouterView: true, Teleport: true } },
    })
    const cardLoad = apiFetch.mock.calls.map(c => String(c[0])).find(u => u.includes('/cards/card-1'))
    expect(cardLoad).toMatch(/\/cards\/card-1\?viewer_id=user-1$/)
    wrapper.unmount()
  }, 20_000)
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'

// Smoke test: does each top-level view's `setup()` RUN without throwing?
//
// This exists because on 2026-07-30 the main lesson app shipped completely dead —
// `document.body.innerText` was two characters (the beetle) — and nothing caught
// it. A `played: isDeclarerPlay` added ~400 lines above that `const`'s declaration
// threw `ReferenceError: Cannot access 'isDeclarerPlay' before initialization`
// inside setup(), so MainLayout never mounted.
//
// Everything that was supposed to catch it looked fine:
//   • `npm run build` compiles a temporal-dead-zone error happily — it is a
//     RUNTIME ordering fault, not a syntax or type one.
//   • 600+ unit tests passed; not one of them mounted a view.
//   • The deploy check diffed the deployed bundle against a local build and
//     grepped it for expected strings: byte-identical, all present, stone dead.
//     Grepping an artifact is not rendering it.
//
// shallowMount stubs the child components but still executes the full `setup()`
// of the view itself, which is precisely where this class of bug lives — TDZ
// violations, a composable called at the wrong time, a destructure of undefined.
// It asserts almost nothing about behaviour on purpose; its whole job is "the
// component can come into existence".

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), currentRoute: { value: {} } }),
  useRoute: () => ({ params: {}, query: {}, path: '/', hash: '' }),
}))

// Network-touching modules: keep the smoke test offline and deterministic.
vi.mock('../../utils/apiFetch.js', () => ({
  apiFetch: vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}), text: async () => '' }),
  API_URL: 'http://test/api',
  API_KEY: 'test',
}))

beforeEach(() => {
  vi.stubGlobal('EventSource', class { constructor() {} close() {} })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({}), text: async () => '',
  }))
  vi.stubGlobal('scrollTo', vi.fn())
})

const VIEWS = {
  MainLayout: () => import('../MainLayout.vue'),
  BiddingPracticeView: () => import('../BiddingPracticeView.vue'),
  TableView: () => import('../TableView.vue'),
  TableLobbyView: () => import('../TableLobbyView.vue'),
}

describe('top-level views survive setup()', () => {
  for (const [name, load] of Object.entries(VIEWS)) {
    it(`${name} mounts`, async () => {
      const mod = await load()
      const errors = []
      const wrapper = shallowMount(mod.default, {
        global: {
          stubs: { RouterLink: true, RouterView: true, Teleport: true, transition: false },
          config: { errorHandler: (e) => errors.push(e) },
        },
      })
      expect(errors, `${name} threw during setup: ${errors[0]?.message}`).toEqual([])
      expect(wrapper.exists()).toBe(true)
      wrapper.unmount()
    })
  }
})

import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ClassroomCard from '../ClassroomCard.vue'

vi.mock('../../../composables/useClassrooms.js', () => ({
  useClassrooms: () => ({ fetchClassroomDetail: vi.fn(async () => null) }),
}))
vi.mock('../../../composables/useAssignments.js', () => ({
  useAssignments: () => ({ fetchClassroomAssignments: vi.fn(async () => []) }),
}))

// The site root is the static hub, which ignores the hash. A join link has to name
// the path the SPA is on, or it opens the hub rather than the join view.
describe('ClassroomCard join link', () => {
  afterEach(() => { window.history.pushState({}, '', '/') })

  function joinLink() {
    const wrapper = mount(ClassroomCard, {
      props: { classroom: { id: 'c1', name: 'Tuesday', join_code: 'ABC123' }, expanded: true },
      global: { stubs: { ClassroomRoster: true } },
    })
    return wrapper.find('.invite-input').element.value
  }

  it('points at the SPA\'s path, where the #/join route exists', () => {
    window.history.pushState({}, '', '/solo-practice-app/')
    expect(joinLink()).toBe(`${window.location.origin}/solo-practice-app/#/join/ABC123`)
  })

  it('keeps a dev server, where the SPA is at the root, linking to itself', () => {
    window.history.pushState({}, '', '/')
    expect(joinLink()).toBe(`${window.location.origin}/#/join/ABC123`)
  })
})

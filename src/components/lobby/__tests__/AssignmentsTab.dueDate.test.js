import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'

// The Assignments tab lets a teacher change or remove a due date by clicking
// it. The store is mocked so mounting is offline; setAssignmentDue mirrors the
// real one by updating the row in place.
const teacherAssignments = ref([])
const setAssignmentDue = vi.fn()

vi.mock('../../../composables/useUserStore.js', () => ({
  useUserStore: () => ({ currentUser: ref({ id: 'teacher-1' }) }),
}))
vi.mock('../../../composables/useAssignments.js', () => ({
  useAssignments: () => ({
    teacherAssignments,
    loading: ref(false),
    fetchTeacherAssignments: vi.fn(),
    setAssignmentClosed: vi.fn(),
    setAssignmentDue,
  }),
}))
vi.mock('../../../composables/useAnonymizer.js', () => ({
  useAnonymizer: () => ({ displayFullName: (u) => `${u.first_name} ${u.last_name}` }),
}))

import AssignmentsTab from '../tabs/AssignmentsTab.vue'

const mountTab = () =>
  mount(AssignmentsTab, {
    global: { stubs: { AssignmentCreateModal: true, AssignmentDetailModal: true, AssignmentStatChips: true } },
  })

beforeEach(() => {
  teacherAssignments.value = [
    { id: 'a1', exercise_name: 'Declarer Play 2', classroom_name: 'Nancy et al', total_boards: 8, due_at: null, closed_at: null },
  ]
  setAssignmentDue.mockReset()
  setAssignmentDue.mockImplementation(async (id, dueAt) => {
    teacherAssignments.value.find(a => a.id === id).due_at = dueAt
    return { success: true }
  })
})

describe('AssignmentsTab: editing a due date', () => {
  it('sets a due date on an assignment that has none', async () => {
    const w = mountTab()
    expect(w.find('.assignment-due').text()).toContain('No due date')

    await w.find('.assignment-due').trigger('click')
    await w.find('.due-input').setValue('2026-10-09')
    await w.find('.due-btn.save').trigger('click')
    await flushPromises()

    expect(setAssignmentDue).toHaveBeenCalledWith('a1', '2026-10-09')
    expect(w.find('.due-editor').exists()).toBe(false)
    expect(w.find('.assignment-due').text()).toMatch(/Due Oct 9/)
  })

  it('starts the picker on the current due date, and can remove it', async () => {
    teacherAssignments.value[0].due_at = '2026-10-03'
    const w = mountTab()

    await w.find('.assignment-due').trigger('click')
    expect(w.find('.due-input').element.value).toBe('2026-10-03')

    const remove = w.findAll('.due-btn').find(b => b.text() === 'Remove')
    await remove.trigger('click')
    await flushPromises()

    expect(setAssignmentDue).toHaveBeenCalledWith('a1', null)
    expect(w.find('.assignment-due').text()).toContain('No due date')
  })

  it('offers no Remove when there is no due date to remove', async () => {
    const w = mountTab()
    await w.find('.assignment-due').trigger('click')
    expect(w.findAll('.due-btn').map(b => b.text())).toEqual(['Save', 'Cancel'])
  })

  it('cancel leaves the due date unchanged', async () => {
    teacherAssignments.value[0].due_at = '2026-10-03'
    const w = mountTab()
    await w.find('.assignment-due').trigger('click')
    await w.find('.due-input').setValue('2026-12-25')
    await w.findAll('.due-btn').find(b => b.text() === 'Cancel').trigger('click')

    expect(setAssignmentDue).not.toHaveBeenCalled()
    expect(w.find('.assignment-due').text()).toMatch(/Due Oct 3/)
  })

  it('clicking the due date does not open the assignment details', async () => {
    const w = mountTab()
    await w.find('.assignment-due').trigger('click')
    await nextTick()
    expect(w.findComponent({ name: 'AssignmentDetailModal' }).exists()).toBe(false)
  })

  it('keeps the editor open and says why when saving fails', async () => {
    setAssignmentDue.mockResolvedValueOnce({ success: false, error: 'Server error (500)' })
    const w = mountTab()
    await w.find('.assignment-due').trigger('click')
    await w.find('.due-input').setValue('2026-10-09')
    await w.find('.due-btn.save').trigger('click')
    await flushPromises()

    expect(w.find('.due-editor').exists()).toBe(true)
    expect(w.find('.due-error').text()).toBe('Server error (500)')
  })
})

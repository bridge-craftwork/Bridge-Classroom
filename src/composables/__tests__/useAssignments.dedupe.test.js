import { describe, it, expect } from 'vitest'
import { dedupeStudentAssignments } from '../useAssignments.js'

// The shape the API returns, newest first (list_student_assignments orders by
// assigned_at DESC).
const mk = (o) => ({
  id: o.id,
  exercise_id: o.exercise_id,
  exercise_name: o.exercise_name || 'Weak Two-bid Exercise 1',
  classroom_id: o.classroom_id || 'tuesday-noon',
  assigned_at: o.assigned_at,
  due_at: o.due_at || null,
  closed_at: o.closed_at || null,
  total_boards: o.total_boards ?? 8,
  attempted_boards: o.attempted_boards ?? 0,
  correct_boards: o.correct_boards ?? 0,
})

describe('dedupeStudentAssignments', () => {
  // The reported case: Tuesday Noon Zoom, "Weak Two-bid Exercise 1" set again on
  // 2026-08-14 after the same exercise had been assigned in February and closed.
  const REASSIGNED = [
    mk({ id: 'new', exercise_id: 'weak-two', assigned_at: '2026-08-14T16:28:16Z', due_at: '2026-08-18', attempted_boards: 0 }),
    mk({ id: 'old', exercise_id: 'weak-two', assigned_at: '2026-02-27T18:29:15Z', due_at: '2026-03-01', attempted_boards: 8, closed_at: '2026-07-16T04:26:50Z' }),
  ]

  it('keeps a repeat assignment for a student who finished the earlier one', () => {
    expect(dedupeStudentAssignments(REASSIGNED).map(a => a.id)).toEqual(['new', 'old'])
  })

  it('keeps both when one exercise reaches a student through two classrooms', () => {
    // Two classrooms, two assignments, two sets of progress — not a duplicate.
    const twoClassrooms = [
      mk({ id: 'a', exercise_id: 'nmf-1', classroom_id: 'noon', assigned_at: '2026-08-14T16:00:00Z', attempted_boards: 0 }),
      mk({ id: 'b', exercise_id: 'nmf-1', classroom_id: 'am', assigned_at: '2026-08-14T16:00:00Z', attempted_boards: 5 }),
    ]
    expect(dedupeStudentAssignments(twoClassrooms).map(a => a.id)).toEqual(['a', 'b'])
  })

  it('keeps both open assignments of one exercise, whatever their dates', () => {
    const both = [
      mk({ id: 'newer', exercise_id: 'nmf-1', assigned_at: '2026-08-14T16:00:00Z', attempted_boards: 0 }),
      mk({ id: 'older', exercise_id: 'nmf-1', assigned_at: '2026-06-01T16:00:00Z', attempted_boards: 8 }),
    ]
    expect(dedupeStudentAssignments(both)).toHaveLength(2)
  })

  it('preserves the order the server sent (newest first)', () => {
    const feed = [
      mk({ id: '1', exercise_id: 'weak-two', assigned_at: '2026-08-14T16:28:16Z' }),
      mk({ id: '2', exercise_id: 'nfm-2', assigned_at: '2026-07-26T20:31:56Z' }),
      mk({ id: '3', exercise_id: 'nmf-1', assigned_at: '2026-07-16T04:55:19Z' }),
    ]
    expect(dedupeStudentAssignments(feed).map(a => a.id)).toEqual(['1', '2', '3'])
  })

  it('collapses the same assignment arriving twice', () => {
    const doubled = [
      mk({ id: 'same', exercise_id: 'weak-two', assigned_at: '2026-08-14T16:00:00Z' }),
      mk({ id: 'same', exercise_id: 'weak-two', assigned_at: '2026-08-14T16:00:00Z' }),
    ]
    expect(dedupeStudentAssignments(doubled)).toHaveLength(1)
  })

  it('keeps rows that carry no id rather than collapsing them together', () => {
    const idless = [
      mk({ id: undefined, exercise_id: 'e1', assigned_at: '2026-08-14T16:00:00Z' }),
      mk({ id: undefined, exercise_id: 'e2', assigned_at: '2026-08-13T16:00:00Z' }),
    ]
    expect(dedupeStudentAssignments(idless)).toHaveLength(2)
  })

  it('handles an empty or missing list', () => {
    expect(dedupeStudentAssignments([])).toEqual([])
    expect(dedupeStudentAssignments(undefined)).toEqual([])
  })
})

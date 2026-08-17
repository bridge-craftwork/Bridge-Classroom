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
    const out = dedupeStudentAssignments(REASSIGNED)
    expect(out.map(a => a.id)).toContain('new')
  })

  it('keeps the closed earlier assignment too, for the review list', () => {
    const out = dedupeStudentAssignments(REASSIGNED)
    expect(out.map(a => a.id).sort()).toEqual(['new', 'old'])
  })

  it('keeps the repeat for a student who never attempted the earlier one', () => {
    // This student always saw it (0 vs 0 left the newest in place), which is why the
    // bug looked like it hit only some of the class.
    const untouched = [
      REASSIGNED[0],
      { ...REASSIGNED[1], attempted_boards: 0 },
    ]
    expect(dedupeStudentAssignments(untouched).map(a => a.id)).toContain('new')
  })

  it('still collapses one exercise reaching a student through two classrooms', () => {
    const twoClassrooms = [
      mk({ id: 'a', exercise_id: 'nmf-1', classroom_id: 'noon', assigned_at: '2026-08-14T16:00:00Z', attempted_boards: 0 }),
      mk({ id: 'b', exercise_id: 'nmf-1', classroom_id: 'am', assigned_at: '2026-08-14T16:00:00Z', attempted_boards: 5 }),
    ]
    const out = dedupeStudentAssignments(twoClassrooms)
    expect(out).toHaveLength(1)
    // Same moment, so progress decides — the student sees the work they have done.
    expect(out[0].id).toBe('b')
  })

  it('prefers the newer of two open assignments of the same exercise', () => {
    const both = [
      mk({ id: 'newer', exercise_id: 'nmf-1', assigned_at: '2026-08-14T16:00:00Z', attempted_boards: 0 }),
      mk({ id: 'older', exercise_id: 'nmf-1', assigned_at: '2026-06-01T16:00:00Z', attempted_boards: 8 }),
    ]
    const out = dedupeStudentAssignments(both)
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('newer')
  })

  it('leaves distinct exercises alone', () => {
    const distinct = [
      mk({ id: 'a', exercise_id: 'weak-two', assigned_at: '2026-08-14T16:00:00Z' }),
      mk({ id: 'b', exercise_id: 'nmf-1', assigned_at: '2026-07-26T20:31:56Z' }),
    ]
    expect(dedupeStudentAssignments(distinct)).toHaveLength(2)
  })

  it('handles an empty or missing list', () => {
    expect(dedupeStudentAssignments([])).toEqual([])
    expect(dedupeStudentAssignments(undefined)).toEqual([])
  })

  it('does not drop assignments with an unparseable assigned_at', () => {
    const odd = [
      mk({ id: 'x', exercise_id: 'e1', assigned_at: 'not-a-date' }),
      mk({ id: 'y', exercise_id: 'e2', assigned_at: '' }),
    ]
    expect(dedupeStudentAssignments(odd)).toHaveLength(2)
  })
})

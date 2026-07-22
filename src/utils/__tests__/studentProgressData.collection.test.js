// The student-progress panel keys lessons by (collection_id, deal_subfolder),
// NOT skill_path. A subfolder reused across two collections must surface as two
// separate lessons, each joined to its own collection's board_status.

import { describe, it, expect } from 'vitest'
import { processData, buildLessonMeta, lessonKeyOf } from '../studentProgressData.js'

const obs = (collection_id, deal_subfolder, deal_number, correct, ts) => ({
  timestamp: ts,
  correct,
  board_result: correct ? 'correct' : 'failed',
  collection_id,
  deal_subfolder,
  deal_number,
})

describe('lessonKeyOf', () => {
  it('composes collection and subfolder; null collection → empty half', () => {
    expect(lessonKeyOf('coll-A', 'Stayman')).toBe('coll-A::Stayman')
    expect(lessonKeyOf(null, 'Stayman')).toBe('::Stayman')
  })
})

describe('processData — keyed by (collection_id, deal_subfolder)', () => {
  it('splits one shared subfolder into two lessons, one per collection', () => {
    const raw = [
      obs('coll-A', 'Stayman', 1, true, '2026-07-20T10:00:00Z'),
      obs('coll-B', 'Stayman', 1, false, '2026-07-20T11:00:00Z'),
    ]
    const lessons = processData(raw)
    expect(lessons).toHaveLength(2)
    const byKey = Object.fromEntries(lessons.map(l => [l.key, l]))
    expect(byKey['coll-A::Stayman'].collectionId).toBe('coll-A')
    expect(byKey['coll-B::Stayman'].collectionId).toBe('coll-B')
    expect(byKey['coll-A::Stayman'].subfolder).toBe('Stayman')
  })

  it('joins board_status by the composite key, not deal_number alone', () => {
    const raw = [
      obs('coll-A', 'Stayman', 1, true, '2026-07-20T10:00:00Z'),
      obs('coll-B', 'Stayman', 1, true, '2026-07-20T11:00:00Z'),
    ]
    // Same deal_number 1 in both collections, DIFFERENT authoritative status.
    const boardStatusByKey = {
      'coll-A::Stayman': [{ deal_number: 1, status: 'clean_correct' }],
      'coll-B::Stayman': [{ deal_number: 1, status: 'failed' }],
    }
    const lessons = processData(raw, {}, {}, boardStatusByKey)
    const byKey = Object.fromEntries(lessons.map(l => [l.key, l]))
    expect(byKey['coll-A::Stayman'].boardLines[0].status).toBe('clean_correct')
    expect(byKey['coll-B::Stayman'].boardLines[0].status).toBe('failed')
  })

  it('reads name/tier/total from the composite-keyed maps', () => {
    const raw = [obs('coll-A', 'Stayman', 1, true, '2026-07-20T10:00:00Z')]
    const key = 'coll-A::Stayman'
    const lessons = processData(raw, { [key]: 25 }, { [key]: 'Stayman Lesson' }, {}, { [key]: 'Learning' })
    expect(lessons[0].name).toBe('Stayman Lesson')
    expect(lessons[0].totalBoards).toBe(25)
    expect(lessons[0].tier).toBe('Learning')
  })

  it('skips rows with no deal_subfolder', () => {
    const raw = [{ timestamp: '2026-07-20T10:00:00Z', correct: true, deal_number: 1, collection_id: 'coll-A' }]
    expect(processData(raw)).toHaveLength(0)
  })
})

describe('buildLessonMeta — keyed by (collection_id, deal_subfolder)', () => {
  it('resolves taxonomy name/total by subfolder (no skill_path)', () => {
    // "Stayman" is a real taxonomy subfolder (Stayman.pbn, 25 deals).
    const { lessonTotals, lessonNames } = buildLessonMeta([
      obs('coll-A', 'Stayman', 1, true, '2026-07-20T10:00:00Z'),
    ])
    expect(lessonNames['coll-A::Stayman']).toBe('Stayman')
    expect(lessonTotals['coll-A::Stayman']).toBe(25)
  })

  it('falls back to the raw subfolder name for an unknown lesson', () => {
    const { lessonNames } = buildLessonMeta([
      obs('coll-A', 'MyCustomPbn', 1, true, '2026-07-20T10:00:00Z'),
    ])
    expect(lessonNames['coll-A::MyCustomPbn']).toBe('MyCustomPbn')
  })
})

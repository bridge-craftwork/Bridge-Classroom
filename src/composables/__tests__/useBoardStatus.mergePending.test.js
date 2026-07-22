// Coverage for the collectionId scope on mergeLocalPending (collectionId audit
// finding #2). A subfolder can belong to more than one collection; a board just
// played (still pending) in collection B must NOT recolour the strip currently
// showing collection A. The filter only skips on a DEFINITE mismatch — both the
// active scope and the observation's collection_id known and different — so
// legacy untagged observations (null collection_id) and ad-hoc PBNs (null scope)
// keep overlaying exactly as before.

import { describe, it, expect, vi, beforeEach } from 'vitest'

let pending = []
vi.mock('../useObservationStore.js', () => ({
  useObservationStore: () => ({ getPendingObservations: () => pending }),
}))

import { useBoardStatus } from '../useBoardStatus.js'

const { mergeLocalPending } = useBoardStatus()

const mastery = () => [
  { boardNumber: 1, status: 'grey' },
  { boardNumber: 2, status: 'grey' },
]
const obs = (deal_number, board_result, collection_id) => ({
  metadata: { deal_subfolder: 'Stayman', deal_number, board_result, collection_id },
})

beforeEach(() => { pending = [] })

describe('mergeLocalPending — collection scope', () => {
  it('overlays a pending board whose collection matches the active scope', () => {
    pending = [obs(1, 'failed', 'coll-A')]
    const m = mastery()
    mergeLocalPending(m, 'Stayman', 'coll-A')
    expect(m[0].status).toBe('red')
  })

  it('skips a pending board from a DIFFERENT collection (the leak)', () => {
    pending = [obs(1, 'failed', 'coll-B')]
    const m = mastery()
    mergeLocalPending(m, 'Stayman', 'coll-A')
    expect(m[0].status).toBe('grey') // unchanged — belongs to coll-B
  })

  it('still overlays when the active scope is null (ad-hoc PBN, no collection)', () => {
    pending = [obs(1, 'corrected', 'coll-B')]
    const m = mastery()
    mergeLocalPending(m, 'Stayman', null)
    expect(m[0].status).toBe('yellow')
  })

  it('still overlays a legacy untagged observation (null collection_id)', () => {
    pending = [obs(1, 'correct', null)]
    const m = mastery()
    mergeLocalPending(m, 'Stayman', 'coll-A')
    expect(m[0].status).toBe('green')
  })

  it('ignores observations from another subfolder regardless of collection', () => {
    pending = [{ metadata: { deal_subfolder: 'Other', deal_number: 1, board_result: 'failed', collection_id: 'coll-A' } }]
    const m = mastery()
    mergeLocalPending(m, 'Stayman', 'coll-A')
    expect(m[0].status).toBe('grey')
  })
})

// Regression test for bug-artifacts #32.
//
// In assignment/exercise mode the strip used to derive every board's colour
// from the DEVICE's local observations only. On a device that hadn't played the
// boards (a second iPad, a fresh browser) that yielded "not attempted" for the
// whole assignment even though the server had all of them completed. The strip
// must instead read the assignment-scoped server rollup, which is the only
// cross-device source of truth.
//
// The fixture mirrors the real report: a MIXED assignment (three subfolders,
// with deal_number 1 appearing in two of them) and an empty local store.

import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'

// The exact 7 boards of the reported exercise, in sort_order.
const EXERCISE_BOARDS = [
  { displayNumber: 1, originalSubfolder: 'NMF', originalBoardNumber: 3 },
  { displayNumber: 2, originalSubfolder: 'Minor', originalBoardNumber: 1 },
  { displayNumber: 3, originalSubfolder: 'NMF', originalBoardNumber: 4 },
  { displayNumber: 4, originalSubfolder: '2over1', originalBoardNumber: 6 },
  { displayNumber: 5, originalSubfolder: 'NMF', originalBoardNumber: 5 },
  { displayNumber: 6, originalSubfolder: 'NMF', originalBoardNumber: 1 },
  { displayNumber: 7, originalSubfolder: 'NMF', originalBoardNumber: 2 },
]

// What the server rollup actually holds for that student.
const SERVER_ENTRIES = [
  { deal_subfolder: 'NMF', deal_number: 3, status: 'corrected', last_observation_at: '2026-07-22T01:36:17Z', max_stars: 0 },
  { deal_subfolder: 'Minor', deal_number: 1, status: 'clean_correct', last_observation_at: '2026-07-21T20:31:22Z', max_stars: 1 },
  { deal_subfolder: 'NMF', deal_number: 4, status: 'clean_correct', last_observation_at: '2026-07-21T20:33:58Z', max_stars: 1 },
  { deal_subfolder: '2over1', deal_number: 6, status: 'clean_correct', last_observation_at: '2026-07-21T20:37:10Z', max_stars: 1 },
  { deal_subfolder: 'NMF', deal_number: 5, status: 'clean_correct', last_observation_at: '2026-07-21T20:40:14Z', max_stars: 1 },
  { deal_subfolder: 'NMF', deal_number: 1, status: 'clean_correct', last_observation_at: '2026-07-21T20:42:01Z', max_stars: 1 },
  { deal_subfolder: 'NMF', deal_number: 2, status: 'clean_correct', last_observation_at: '2026-07-21T20:47:22Z', max_stars: 1 },
]

const fetchAssignmentStatus = vi.fn().mockResolvedValue(SERVER_ENTRIES)

vi.mock('../../composables/useUserStore.js', () => ({
  useUserStore: () => ({ currentUser: ref({ id: 'u-terry' }) }),
}))
vi.mock('../../composables/useAssignmentStatus.js', () => ({
  useAssignmentStatus: () => ({
    cacheVersion: ref(0),
    fetchAssignmentStatus: (...a) => fetchAssignmentStatus(...a),
  }),
}))
// A fresh device: no local observations at all.
vi.mock('../../composables/useBoardMastery.js', () => ({
  useBoardMastery: () => ({
    getObservations: () => [],
    calculateCurrentStatus: () => 'grey',
    calculateAchievement: () => 'none',
    groupIntoBoardAttempts: () => [],
    getLessonCollection: () => null,
  }),
}))

import BoardMasteryStrip from '../BoardMasteryStrip.vue'

const mountStrip = () =>
  mount(BoardMasteryStrip, {
    props: {
      boardNumbers: [1, 2, 3, 4, 5, 6, 7],
      lessonSubfolder: 'NMF',
      userId: 'u-terry',
      exerciseContext: {
        assignmentId: 'assign-1',
        boards: EXERCISE_BOARDS,
        assignedAt: '2026-07-21T00:00:00Z',
      },
    },
    global: { stubs: { PawIcon: true } },
  })

describe('BoardMasteryStrip — assignment mode reads the server rollup (#32)', () => {
  it('queries the assignment-scoped rollup with the assignment id', async () => {
    mountStrip()
    await flushPromises()
    expect(fetchAssignmentStatus).toHaveBeenCalledWith('u-terry', 'assign-1')
  })

  it('shows completed boards even with NO local observations (the bug)', async () => {
    const wrapper = mountStrip()
    await flushPromises()
    const mastery = wrapper.vm.boardMastery

    expect(mastery).toHaveLength(7)
    // Not a single board may be grey — the server says all 7 were played.
    expect(mastery.filter(b => b.status === 'grey')).toHaveLength(0)
  })

  it('maps each subfolder/deal_number onto the right displayNumber', async () => {
    const wrapper = mountStrip()
    await flushPromises()
    const byNum = Object.fromEntries(wrapper.vm.boardMastery.map(b => [b.boardNumber, b]))

    // display 1 == NMF#3, the only 'corrected' board → must not read as clean.
    expect(byNum[1].apiStatus).toBe('corrected')
    // display 2 == Minor#1 and display 6 == NMF#1 — same deal_number, different
    // subfolders. Keying by deal_number alone would collide these.
    expect(byNum[2].apiStatus).toBe('clean_correct')
    expect(byNum[6].apiStatus).toBe('clean_correct')
    // Every other board is a clean pass.
    expect(byNum[7].apiStatus).toBe('clean_correct')
  })

  // Guards the two assertions above: without an assignmentId the component takes
  // the legacy local-observation path, which on this fresh device yields grey
  // for everything — i.e. exactly the reported bug. If the tests above ever pass
  // through THIS path they'd be grey, so they really are proving the rollup.
  it('falls back to local computation when the context has no assignmentId', async () => {
    const wrapper = mount(BoardMasteryStrip, {
      props: {
        boardNumbers: [1, 2, 3, 4, 5, 6, 7],
        lessonSubfolder: 'NMF',
        userId: 'u-terry',
        exerciseContext: {
          // legacy context — no assignmentId
          boards: EXERCISE_BOARDS,
          assignedAt: '2026-07-21T00:00:00Z',
        },
      },
      global: { stubs: { PawIcon: true } },
    })
    await flushPromises()
    const mastery = wrapper.vm.boardMastery
    expect(mastery).toHaveLength(7)
    // Reproduces the pre-fix behaviour: every board grey on a device with no
    // local observations, despite the server holding the completions.
    expect(mastery.every(b => b.status === 'grey')).toBe(true)
  })
})

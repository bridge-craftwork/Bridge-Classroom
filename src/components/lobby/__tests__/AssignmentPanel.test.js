import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'

// Mock the two composables AssignmentPanel pulls in so mounting is offline and
// deterministic (the mastery watcher would otherwise hit the network).
vi.mock('../../../composables/useUserStore.js', () => ({
  useUserStore: () => ({ effectiveUserId: ref(null) }),
}))
vi.mock('../../../composables/useAssignmentStatus.js', () => ({
  useAssignmentStatus: () => ({
    cacheVersion: ref(0),
    fetchAssignmentStatus: vi.fn().mockResolvedValue([]),
  }),
}))

import AssignmentPanel from '../AssignmentPanel.vue'

const DAY = 24 * 60 * 60 * 1000
const iso = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10)

// One assignment with sensible defaults; override per case.
let seq = 0
const mk = (over = {}) => ({
  id: `a${seq++}`,
  exercise_name: 'Weak Twos',
  exercise_id: `e${seq}`,
  total_boards: 4,
  attempted_boards: 0,
  correct_boards: 0,
  ...over,
})

const panel = (assignments) =>
  mount(AssignmentPanel, {
    props: { assignments },
    global: { stubs: { PawIcon: true } },
  })

describe('AssignmentPanel — active filter, closed, and dead-zone', () => {
  it('shows active cards when a current assignment exists', () => {
    const w = panel([mk({ due_at: iso(3) })]) // due in 3 days → active
    expect(w.find('.assignment-cards').exists()).toBe(true)
    expect(w.findAll('.assignment-card').length).toBe(1)
    expect(w.find('.caught-up').exists()).toBe(false)
  })

  it('DEAD-ZONE: assignments exist but all are stale → caught-up state, not blank', () => {
    // Previously no render branch matched this and the panel was blank.
    const w = panel([mk({ due_at: iso(-60) })]) // due 60 days ago → past the 7-day window
    expect(w.find('.caught-up').exists()).toBe(true)
    expect(w.find('.assignment-cards').exists()).toBe(false)
    // The panel isn't the "no assignments yet" empty state — they DO have one.
    expect(w.text()).not.toContain('No assignments yet')
    // And the escape hatch to review prior work is reachable.
    expect(w.find('.view-all-link').exists()).toBe(true)
  })

  it('closed assignments are never active (excluded even when due today)', () => {
    const w = panel([mk({ due_at: iso(0), closed_at: '2026-07-10T00:00:00Z' })])
    expect(w.find('.caught-up').exists()).toBe(true) // nothing active
    expect(w.find('.assignment-cards').exists()).toBe(false)
  })

  it('mixed: active shows as a card, closed only in the All-assignments list (tagged)', () => {
    const w = panel([
      mk({ due_at: iso(2) }), // active
      mk({ due_at: iso(-30), closed_at: '2026-07-01T00:00:00Z' }), // closed
    ])
    // Only the active one is a top-level card.
    expect(w.findAll('.assignment-cards > .assignment-card').length).toBe(1)
    // "All assignments →" present because a non-active one exists.
    expect(w.find('.view-all-link').exists()).toBe(true)
  })

  it('truly empty → the existing "No assignments yet" state, not caught-up', () => {
    const w = panel([])
    expect(w.text()).toContain('No assignments yet')
    expect(w.find('.caught-up').exists()).toBe(false)
  })
})

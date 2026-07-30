import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SeatPanel from '../SeatPanel.vue'
import SeatChip from '../SeatChip.vue'

// A full 13-card holding, and the same hand three cards lighter.
const full = { spades: ['A', 'K', 'Q', 'J'], hearts: ['A', 'K', 'Q'], diamonds: ['A', 'K', 'Q'], clubs: ['A', 'K', 'Q'] }
const played3 = { spades: ['A'], hearts: ['A', 'K', 'Q'], diamonds: ['A', 'K', 'Q'], clubs: ['A', 'K', 'Q'] }

const chipCount = (props) =>
  mount(SeatPanel, { props: { seat: 'E', density: 'chip', ...props } })
    .findComponent(SeatChip).props('cardCount')

// Roadmap 2026-07-30 §2.2. `chipCardCount` counted whenever the holding was
// chipped, in ANY phase — so during the auction every unseen hand read
// "13 cards": true, constant, and uninformative. The count is only worth its
// space once cards start leaving hands.
describe('SeatPanel — the chip card count is phase-aware', () => {
  it('suppresses the count during the auction', () => {
    expect(chipCount({ hand: full, phase: 'bidding' })).toBeNull()
  })

  it('shows it during play and at review', () => {
    expect(chipCount({ hand: played3, phase: 'play' })).toBe(10)
    expect(chipCount({ hand: played3, phase: 'review' })).toBe(10)
  })

  // The tempting fix — hide when the count is 13 — is wrong: at trick one a
  // defender genuinely still holds 13, and that reading is informative
  // precisely because the seats around it are already down to 12.
  it('still shows 13 at trick one, where it is legitimate', () => {
    expect(chipCount({ hand: full, phase: 'play' })).toBe(13)
  })

  it('counts when no phase is supplied (the pre-grid compass never threads one)', () => {
    expect(chipCount({ hand: full })).toBe(13)
  })

  // Pre-existing behaviour that must survive: an undealt-for-display seat reads
  // 0 and is suppressed rather than rendering "0 cards".
  it('suppresses an empty hand rather than rendering zero', () => {
    expect(chipCount({ hand: {}, phase: 'play' })).toBeNull()
  })

  it('never counts when the holding itself is shown', () => {
    expect(chipCount({ hand: played3, phase: 'play', density: 'full' })).toBeNull()
  })
})

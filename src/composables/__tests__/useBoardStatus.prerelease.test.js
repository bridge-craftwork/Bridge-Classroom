import { describe, it, expect } from 'vitest'
import { useBoardStatus } from '../useBoardStatus.js'

// Regression coverage for the ADR-0001 prerelease threading: buildBoardMastery
// must carry the board_status API's per-board `prerelease` flag onto the mapped
// board object so BoardMasteryStrip can render beta boards as a triangle.
describe('buildBoardMastery — prerelease threading', () => {
  const { buildBoardMastery } = useBoardStatus()

  const apiBoard = (deal_number, extra = {}) => ({
    deal_number,
    status: 'clean_correct',
    max_stars: 0,
    wild_achievement: null,
    wilderness: 'Tame',
    last_error_date: null,
    last_star_update: null,
    last_observation_at: '2026-07-05T00:00:00Z',
    ...extra
  })

  it('maps prerelease=true from the API entry onto the board', () => {
    const boards = buildBoardMastery([apiBoard(1, { prerelease: true })], [1])
    expect(boards[0].prerelease).toBe(true)
  })

  it('treats prerelease=false and a missing flag as not-prerelease', () => {
    const boards = buildBoardMastery(
      [apiBoard(1, { prerelease: false }), apiBoard(2 /* no prerelease field */)],
      [1, 2]
    )
    expect(boards[0].prerelease).toBe(false)
    expect(boards[1].prerelease).toBe(false)
  })

  it('defaults prerelease to false for a board with no observations', () => {
    const boards = buildBoardMastery([], [7])
    expect(boards[0].prerelease).toBe(false)
  })

  it('coerces truthy-but-non-boolean prerelease to a strict boolean false (only true counts)', () => {
    // Guards the `=== true` check: a stray 1/undefined must not render a triangle.
    const boards = buildBoardMastery([apiBoard(1, { prerelease: 1 })], [1])
    expect(boards[0].prerelease).toBe(false)
  })
})

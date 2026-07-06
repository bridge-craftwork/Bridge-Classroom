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

  // Local-seed behavior: the triangle must show from the loaded deal's `stable`
  // flag before (and independent of) the server board-status arriving.
  describe('local prerelease seed (pre-server, no flash)', () => {
    it('marks a board beta from the local map when there is no API entry yet', () => {
      const boards = buildBoardMastery([], [1, 2], { 1: true, 2: false })
      expect(boards[0].prerelease).toBe(true)  // beta locally, unattempted
      expect(boards[1].prerelease).toBe(false)
    })

    it('OR-s the local flag with the API entry so it never flips back to a circle', () => {
      // API says not-beta but the deal is still beta locally → stays a triangle.
      const boards = buildBoardMastery([apiBoard(1, { prerelease: false })], [1], { 1: true })
      expect(boards[0].prerelease).toBe(true)
    })

    it('only true in the local map counts (=== true)', () => {
      const boards = buildBoardMastery([], [1, 2], { 1: 1, 2: undefined })
      expect(boards[0].prerelease).toBe(false)
      expect(boards[1].prerelease).toBe(false)
    })

    it('empty/absent local map preserves API-only behavior', () => {
      expect(buildBoardMastery([apiBoard(1, { prerelease: true })], [1]).at(0).prerelease).toBe(true)
      expect(buildBoardMastery([], [9]).at(0).prerelease).toBe(false)
    })
  })
})

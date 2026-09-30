import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useDealPractice } from '../useDealPractice.js'
import { parsePbn } from '../../utils/pbnParser.js'

// An opening-lead board: the [choose-card] is the very first step. advance() only
// starts the prompt clock on steps it lands on, so a step-0 card choice used to
// record time_ms 0 — 351 of 353 OLead observations in Sept 2026 had zero time.
const LEAD_BOARD = `
[Event "Test"]
[Board "1"]
[Dealer "N"]
[Vulnerable "None"]
[Deal "W:865.KQJ97.862.K3 KQ4.642.A3.QT874 T972.T5.QJT95.92 AJ3.A83.K74.AJ65"]
[Declarer "S"]
[Contract "3NT"]
[Student "W"]
[Auction "N"]
Pass Pass 1NT Pass 3NT Pass Pass Pass
{[show W] The contract is 3NT and it is your lead. [choose-card HK] [NEXT] [show NESW] Done.}
`

describe('useDealPractice — timing a card choice that opens the board', () => {
  let dp
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-30T12:00:00Z'))
    dp = useDealPractice()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('records how long the student took over the opening lead', () => {
    dp.loadDeal(parsePbn(LEAD_BOARD)[0])
    vi.advanceTimersByTime(7000)
    expect(dp.makeCardChoice('H', 'K')).toBe(true)

    const prompt = dp.boardState.promptHistory.at(-1)
    expect(prompt).toMatchObject({ type: 'card', expected_card: 'HK', correct: true })
    expect(prompt.time_ms).toBe(7000)
  })
})

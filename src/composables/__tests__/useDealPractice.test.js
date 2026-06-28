import { describe, it, expect, beforeEach } from 'vitest'
import { useDealPractice } from '../useDealPractice.js'
import { parsePbn } from '../../utils/pbnParser.js'

// A judgment board: South (the student) opens and the lesson marks BOTH 3NT
// (the recorded call) and 4S as defensible via [ACCEPT 4S].
const ACCEPT_PBN = `
[Event "Test"]
[Board "1"]
[Dealer "S"]
[Vulnerable "None"]
[Deal "N:AKQ.JT9.876.5432 T98.876.KQJ.AKQ J76.543.AT9.JT9 543.AKQ2.532.876"]
[Student "S"]
[Auction "S"]
3NT Pass Pass Pass
{Decide the strain. [BID 3NT] Either game is sound here. [ACCEPT 4S]}
`

// Same board with NO [ACCEPT] — single-answer scoring is unchanged.
const PLAIN_PBN = `
[Event "Test"]
[Board "1"]
[Dealer "S"]
[Vulnerable "None"]
[Deal "N:AKQ.JT9.876.5432 T98.876.KQJ.AKQ J76.543.AT9.JT9 543.AKQ2.532.876"]
[Student "S"]
[Auction "S"]
3NT Pass Pass Pass
{Only one call. [BID 3NT] Game is in reach.}
`

describe('useDealPractice — [ACCEPT] scoring', () => {
  let dp
  beforeEach(() => {
    dp = useDealPractice()
  })

  it('scores the recorded call correct', () => {
    dp.loadDeal(parsePbn(ACCEPT_PBN)[0])
    expect(dp.makeBid('3NT')).toBe(true)
  })

  it('scores an [ACCEPT] alternative correct', () => {
    dp.loadDeal(parsePbn(ACCEPT_PBN)[0])
    expect(dp.makeBid('4S')).toBe(true)
  })

  it('scores a non-accepted call wrong', () => {
    dp.loadDeal(parsePbn(ACCEPT_PBN)[0])
    expect(dp.makeBid('4H')).toBe(false)
  })

  it('without [ACCEPT], only the recorded call is correct (non-disruption)', () => {
    dp.loadDeal(parsePbn(PLAIN_PBN)[0])
    expect(dp.makeBid('4S')).toBe(false)

    dp.loadDeal(parsePbn(PLAIN_PBN)[0])
    expect(dp.makeBid('3NT')).toBe(true)
  })
})

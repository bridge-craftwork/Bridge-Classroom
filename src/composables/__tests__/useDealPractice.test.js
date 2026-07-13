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

  // B7: an accepted alternative is its own tier — reverted + flagged, not penalized.
  it('flags an accepted alternative (orange tier), not wrong', () => {
    dp.loadDeal(parsePbn(ACCEPT_PBN)[0])
    dp.makeBid('4S')
    expect(dp.auctionState.altBid).toBe('4S')
    expect(dp.auctionState.altRecordedBid).toBe('3NT')   // reverts to the recorded call
    expect(dp.auctionState.wrongBid).toBe(null)          // not the wrong tier
    expect(dp.boardState.boardHadWrong).toBe(false)      // not penalized
    expect(dp.boardState.altStepIndices[0]).toBe(true)   // tracked (suppresses the cheer)
  })

  it('the exact recorded call is not flagged as an alternative', () => {
    dp.loadDeal(parsePbn(ACCEPT_PBN)[0])
    dp.makeBid('3NT')
    expect(dp.auctionState.altBid).toBe(null)
    expect(Object.keys(dp.boardState.altStepIndices)).toHaveLength(0)
  })

  it('a wrong call is the wrong tier, not the alternative tier', () => {
    dp.loadDeal(parsePbn(ACCEPT_PBN)[0])
    dp.makeBid('4H')
    expect(dp.auctionState.wrongBid).toBe('4H')
    expect(dp.auctionState.altBid).toBe(null)
    expect(dp.boardState.boardHadWrong).toBe(true)
  })
})

// A two-bid walkthrough where the student's second call is a PASS — the case that
// exposed both halves of the 2026-07-13 Back-button bug.
const TWO_BID_DEAL = {
  dealer: 'S',
  auctionDealer: 'S',
  studentSeat: 'S',
  // S 1H · W Pass · N 2H · E Pass · S Pass · W Pass · N Pass  (passed out over 2H)
  auction: ['1H', 'Pass', '2H', 'Pass', 'Pass', 'Pass', 'Pass'],
  steps: [
    { type: 'bid', bid: '1H', text: 'Open 1H.' },
    { type: 'bid', bid: 'Pass', text: 'What do you say next?' },
  ],
  hands: { N: {}, E: {}, S: {}, W: {} },
}

describe('useDealPractice — Back from a completed board (2026-07-13 report)', () => {
  let dp
  beforeEach(() => {
    dp = useDealPractice()
    dp.loadDeal(TWO_BID_DEAL)
    dp.makeBid('1H')   // opens; auto-advances to the student's Pass prompt
    dp.makeBid('Pass') // final call → board completes
  })

  it('reaches the completed state after both calls', () => {
    expect(dp.isComplete.value).toBe(true)
  })

  it('Back clears the completion so "Beautifully bid!" no longer shows', () => {
    dp.goBack()
    expect(dp.isComplete.value).toBe(false)
  })

  it('Back re-offers the bidding box by rewinding to the STUDENT\'s Pass, not an opponent\'s', () => {
    dp.goBack()
    // The student's Pass is auction index 4 (S), NOT the first Pass at index 1 (W).
    expect(dp.auctionState.currentBidIndex).toBe(4)
    expect(dp.auctionState.auctionComplete).toBe(false)
    expect(dp.hasBidPrompt.value).toBe(true)
  })

  it('the re-offered board can be completed again', () => {
    dp.goBack()
    expect(dp.makeBid('Pass')).toBe(true)
    expect(dp.isComplete.value).toBe(true)
  })
})

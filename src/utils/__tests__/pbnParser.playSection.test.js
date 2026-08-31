import { describe, it, expect } from 'vitest'
import { parsePbn } from '@/utils/pbnParser.js'

// What a [Play] section MEANS must follow from its content, not from how it was
// typed. Baker-Bridge#42 moved the opening-lead card off the tag line and onto
// the next one (the PBN-conforming form), and every bidding board in the
// collection began parsing as a declarer-play lesson — which hides the bidding
// table and reveals the whole auction at once (Bridge-Classroom, 2026-09-01).

const BOARD = (playSection) => `[Event "Baker Bridge - Blackwood"]
[Board "1"]
[Dealer "N"]
[Vulnerable "None"]
[Deal "W:J6542.A6.976.A52 9.QJT75.AKQ3.KQ4 QT873.83.42.JT97 AK.K942.JT85.863"]
[Declarer "N"]
[Contract "5H"]
[Auction "N"]
1H pass 3H pass 4NT pass 5D pass 5H pass pass pass
[Student "S"]
{[show S]

The bidding has gone as shown. Decide how you would answer 4NT. [BID 5\\D]

[show NS]

The Blackwood response for 1 Ace is 5\\D.}
${playSection}`

const parse = (playSection) => parsePbn(BOARD(playSection))[0]

describe('[Play] section — opening lead vs recorded line', () => {
  it('treats a lone card on the following line as an opening lead, not declarer play', () => {
    const deal = parse('[Play "E"]\nD4')
    expect(deal.isDeclarerPlay).toBe(false)
    expect(deal.playLine).toBeFalsy()
    expect(deal.openingLeader).toBe('E')
    expect(deal.openingLead).toBe('D4')
  })

  it('treats the inline form identically — the two are the same board', () => {
    const onNextLine = parse('[Play "E"]\nD4')
    const inline = parse('[Play "E"]D4')
    expect(inline.isDeclarerPlay).toBe(onNextLine.isDeclarerPlay)
    expect(inline.openingLeader).toBe(onNextLine.openingLeader)
    expect(inline.openingLead).toBe(onNextLine.openingLead)
  })

  it('still recognises a real recorded line', () => {
    const deal = parse('[Play "E"]\nD4 D2 DA D5\nH3 HK H8 H2\nS7 S4 SA S3')
    expect(deal.isDeclarerPlay).toBe(true)
    expect(deal.playLine.leader).toBe('E')
    expect(deal.openingLead).toBe('D4')
    // Columns are seats clockwise from the leader: E, S, W, N.
    expect(deal.playLine.bySeat.E).toEqual(['D4', 'H3', 'S7'])
    expect(deal.playLine.bySeat.S).toEqual(['D2', 'HK', 'S4'])
    expect(deal.playLine.bySeat.W).toEqual(['DA', 'H8', 'SA'])
    expect(deal.playLine.bySeat.N).toEqual(['D5', 'H2', 'S3'])
  })

  it('counts a single complete trick as a recorded line', () => {
    const deal = parse('[Play "E"]\nD4 D2 DA D5')
    expect(deal.isDeclarerPlay).toBe(true)
    expect(deal.playLine.bySeat.E).toEqual(['D4'])
  })

  it('survives a [Play] section with no cards at all', () => {
    const deal = parse('[Play "E"]\n')
    expect(deal.isDeclarerPlay).toBe(false)
    expect(deal.playLine).toBeFalsy()
  })

  it('leaves a board with no [Play] section untouched', () => {
    const deal = parse('')
    expect(deal.isDeclarerPlay).toBe(false)
    expect(deal.openingLead).toBeFalsy()
  })

  it('keeps the auction hidden behind the student prompt on such a board', () => {
    // The symptom, from the other side: a bidding board must still stop at the
    // student's turn rather than laying the whole auction out at once.
    const deal = parse('[Play "E"]\nD4')
    expect(deal.auction.length).toBe(12)
    expect(deal.steps.some((s) => s.bid)).toBe(true)
  })
})

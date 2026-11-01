import { describe, it, expect, vi } from 'vitest'
import { parsePbn } from '../pbnParser.js'

// One malformed board must not break the board after it
// (Practice-Bidding-Scenarios#346: Finesse_Simple board 2).

const DEAL = '[Deal "N:J98.J74.QT3.KQ54 K432.83.J4.T9872 AQT5.AKQT62.6.J3 76.95.AK98752.A6"]'

describe('pbnParser: malformed boards stay contained', () => {
  it('ends an unclosed comment at the next PBN tag', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const pbn = `
[Board "2"]
[Dealer "S"]
${DEAL}
{Board two text.
[BidSystemNS "2/1GF"]
[Board "3"]
[Dealer "S"]
${DEAL}
{Board three text.}
`
    const [b2, b3] = parsePbn(pbn)
    expect(b2.boardNumber).toBe(2)
    expect(b3.boardNumber).toBe(3)
    expect(b2.commentary).toContain('Board two text.')
    expect(b2.commentary).not.toContain('Board three text.')
    expect(b2.commentary).not.toContain('BidSystemNS')
    expect(b3.commentary).toContain('Board three text.')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('stops the auction where it ends, dropping a second copy', () => {
    const pbn = `
[Board "2"]
[Dealer "S"]
${DEAL}
[Auction "S"]
1H    2D    2H    Pass
4H    Pass  Pass  Pass

[Auction "S"]
1H    2D    2H    Pass
4H    Pass  Pass  Pass
`
    const [b2] = parsePbn(pbn)
    expect(b2.auction).toEqual(['1H', '2D', '2H', 'Pass', '4H', 'Pass', 'Pass', 'Pass'])
  })

  it('keeps an all-pass auction at four passes', () => {
    const pbn = `
[Board "1"]
[Dealer "N"]
${DEAL}
[Auction "N"]
Pass Pass Pass Pass Pass
`
    expect(parsePbn(pbn)[0].auction).toEqual(['Pass', 'Pass', 'Pass', 'Pass'])
  })

  it('keeps an unfinished auction whole', () => {
    const pbn = `
[Board "1"]
[Dealer "N"]
${DEAL}
[Auction "N"]
1S Pass 2S Pass Pass
`
    expect(parsePbn(pbn)[0].auction).toEqual(['1S', 'Pass', '2S', 'Pass', 'Pass'])
  })
})

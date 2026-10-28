import { describe, it, expect, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AuctionTable from '../AuctionTable.vue'

const MEANINGS = [
  { position: 0, bid: '1S', tooltip: 'Opening bid: 11-15 HCP, 5+ spades, unbalanced' },
]

describe('AuctionTable bid tooltip', () => {
  let w
  afterEach(() => w?.unmount())

  it('renders the meaning in <body>, outside the clipped table', async () => {
    w = mount(AuctionTable, { props: { bids: ['1S', 'Pass'], dealer: 'N', meanings: MEANINGS }, attachTo: document.body })
    const cell = w.findAll('.bid-cell').find(c => c.text().includes('1'))
    await cell.trigger('mouseenter')
    await flushPromises()
    const tip = document.body.querySelector(':scope > .bid-tooltip')
    expect(tip).not.toBeNull()
    expect(tip.textContent).toContain('11-15 HCP')
    expect(w.element.contains(tip)).toBe(false)
    expect(tip.classList.contains('placed')).toBe(true)

    await cell.trigger('mouseleave')
    expect(document.body.querySelector('.bid-tooltip')).toBeNull()
  })

  it('shows nothing for a bid without a meaning', async () => {
    w = mount(AuctionTable, { props: { bids: ['1S', 'Pass'], dealer: 'N', meanings: MEANINGS }, attachTo: document.body })
    const pass = w.findAll('.bid-cell').find(c => c.text() === 'Pass')
    await pass.trigger('mouseenter')
    await flushPromises()
    expect(document.body.querySelector('.bid-tooltip')).toBeNull()
  })
})

describe('AuctionTable flagged calls', () => {
  it('tints the flagged calls only', () => {
    const w = mount(AuctionTable, { props: { bids: ['1S', 'Pass', '2S', 'Pass'], dealer: 'N', flaggedBids: [2] } })
    const flagged = w.findAll('.bid-cell.fallback-bid')
    expect(flagged).toHaveLength(1)
    expect(flagged[0].text()).toContain('2')
    w.unmount()
  })
})

describe('AuctionTable meaning suits', () => {
  it('colours suit symbols written as text, as well as !H-style codes', async () => {
    const meanings = [{ position: 0, bid: '4D', tooltip: 'Splinter: 4+ ♥, at most one ♦; !S stopper, ♣ length' }]
    const w = mount(AuctionTable, { props: { bids: ['4D'], dealer: 'N', meanings }, attachTo: document.body })
    await w.findAll('.bid-cell').find(c => c.text().includes('4')).trigger('mouseenter')
    await flushPromises()
    const tip = document.body.querySelector(':scope > .bid-tooltip')
    expect(tip.querySelectorAll('.t-suit-h')).toHaveLength(1)
    expect(tip.querySelectorAll('.t-suit-d')).toHaveLength(1)
    expect(tip.querySelectorAll('.t-suit-s')).toHaveLength(1)
    expect(tip.querySelectorAll('.t-suit-c')).toHaveLength(1)
    w.unmount()
  })
})

import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ClaimPanel from '../ClaimPanel.vue'
import TeacherClaimMenu from '../TeacherClaimMenu.vue'
import { buildClaimPosition } from '../../../utils/claimPosition.js'

const DEAL = 'N:AKQT3.J6.KJ42.95 652.AK42.AQ87.T4 J74.QT95.T.AK863 98.873.9653.QJ72'

describe('buildClaimPosition', () => {
  it('builds the solver position, with the opening leader left of declarer', () => {
    const pos = buildClaimPosition({
      deal: DEAL, contract: { text: '4SX', declarer: 'N' }, plays: ['HA'], tricks: { NS: 0, EW: 0 }, claimer: 'N',
    })
    expect(pos.play).toMatchObject({ trump: 'S', declarer: 'N', leader: 'E', plays: ['HA'] })
    expect(pos.play.hands.N.spades).toEqual(['A', 'K', 'Q', 'T', '3'])
    expect(pos.stamp).toBe(1)
  })

  it('notrump, and nothing without a deal or claimer', () => {
    expect(buildClaimPosition({ deal: DEAL, contract: { text: '3N', declarer: 'S' }, plays: [], claimer: 'S' }).play.trump).toBe('NT')
    expect(buildClaimPosition({ deal: null, contract: { text: '3N', declarer: 'S' }, claimer: 'S' })).toBeNull()
    expect(buildClaimPosition({ deal: DEAL, contract: { text: '3N', declarer: 'S' }, claimer: null })).toBeNull()
  })
})

describe('ClaimPanel', () => {
  it('offers 0 … remaining and emits the count', async () => {
    const w = mount(ClaimPanel, { props: { remaining: 3 } })
    const buttons = w.findAll('.claim-btn')
    expect(buttons.map(b => b.text())).toEqual(['0', '1', '2', '3'])
    await buttons[2].trigger('click')
    expect(w.emitted('claim')[0]).toEqual([2])
  })

  it('shows the reason and the guarantee after a rejection', () => {
    const w = mount(ClaimPanel, {
      props: { remaining: 5, rejection: { additional: 5, message: 'Not guaranteed.' }, limit: { claimable: 3, undecided: false } },
    })
    expect(w.text()).toContain('Claim of 5 not accepted.')
    expect(w.text()).toContain('You can guarantee 3 more tricks.')
  })
})

describe('TeacherClaimMenu', () => {
  const table = {
    table_id: 's1-t1',
    phase: 'play',
    deal: DEAL,
    contract: { text: '4S', declarer: 'N' },
    plays: ['HA'],
    tricks: { ns: 0, ew: 0 },
  }

  it('shows Claimable / Makable / All and emits the chosen ruling with its stamp', async () => {
    const asked = []
    const solver = { claimOptions: async (pos) => { asked.push(pos); return { remaining: 13, claimable: 2, claimableUndecided: true, makable: 10 } } }
    const w = mount(TeacherClaimMenu, { props: { t: table, name: 'Table 1', solver } })
    await flushPromises()
    expect(asked[0].claimer).toBe('N')
    const opts = w.findAll('.tcm-opt')
    expect(opts.map(o => o.find('.tcm-opt-n').text())).toEqual(['≥2', '10', '13'])
    await opts[1].trigger('click')
    expect(w.emitted('claim')[0]).toEqual([{ seat: 'N', tricks: 10, playsSeen: 1 }])
    await opts[2].trigger('click')
    expect(w.emitted('claim')[1]).toEqual([{ seat: 'N', tricks: 13, playsSeen: 1 }])
  })

  it('switching to the defenders asks again for the defenders’ side', async () => {
    const asked = []
    const solver = { claimOptions: async (pos) => { asked.push(pos.claimer); return { remaining: 13, claimable: 0, claimableUndecided: false, makable: 3 } } }
    const w = mount(TeacherClaimMenu, { props: { t: table, solver } })
    await flushPromises()
    await w.findAll('.tcm-side-btn')[1].trigger('click')
    await flushPromises()
    expect(asked).toEqual(['N', 'E'])
  })

  it('keeps All available when the solver fails', async () => {
    const solver = { claimOptions: async () => { throw new Error('no wasm') } }
    const w = mount(TeacherClaimMenu, { props: { t: table, solver } })
    await flushPromises()
    const opts = w.findAll('.tcm-opt')
    expect(opts[0].attributes('disabled')).toBeDefined()
    expect(opts[2].attributes('disabled')).toBeUndefined()
    expect(w.text()).toContain('no wasm')
  })
})

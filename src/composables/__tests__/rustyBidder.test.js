import { describe, it, expect, vi } from 'vitest'
import { prepareRustyBoard, runRustyBots } from '../engines/rustyBidder.js'
import { makeFakeRusty, DEAL } from './fakeRusty.js'

async function board(client, cardNames = { ns: '21GF-DEFAULT', ew: '21GF-DEFAULT' }, fetchBbsa) {
  return prepareRustyBoard({ client, deal: DEAL, humanSeats: ['S'], cardNames, fetchBbsa })
}

function hooks(client, overrides = {}) {
  const made = []
  return {
    made,
    h: {
      client,
      bbaCall: vi.fn(async () => ({ call: '2H', meaning: { meaning: 'BBA: 2H' } })),
      onCall: vi.fn(async (call, meta) => { made.push({ call, ...meta }) }),
      onMeanings: vi.fn(),
      onFallback: vi.fn(),
      fallbackMeanings: {},
      ...overrides,
    },
  }
}

describe('prepareRustyBoard', () => {
  it('bids for every seat but the human, with S.H.D.C hands and the board conditions', async () => {
    const b = await board(makeFakeRusty([]))
    expect(b.request.bots).toEqual(['N', 'E', 'W'])
    expect(b.request.hands).toEqual({ N: 'AK52.KJ7.Q94.K83', E: 'QJ3.Q95.KJ3.QJ74', W: '987.64.T8765.A95' })
    expect(b.request).toMatchObject({ engine: 7, dealer: 'N', vul: 'None', scoring: 'MP' })
    expect(b.rulesId).toBe('test-rules')
  })

  it('passes a built-in card by name and fetches any other as .bbsa text', async () => {
    const client = makeFakeRusty([])
    const fetchBbsa = vi.fn(async (name) => `text of ${name}`)
    await board(client, { ns: '21GF-DEFAULT', ew: 'Precision' }, fetchBbsa)
    expect(fetchBbsa).toHaveBeenCalledWith('Precision')
    expect(client.requests[0].cards).toEqual({ ns: '21GF-DEFAULT', ew: { bbsa: 'text of Precision', name: 'Precision' } })
  })

  it('never falls back silently when a card cannot be found', async () => {
    const fetchBbsa = vi.fn(async () => { throw new Error('card Nope: HTTP 404') })
    await expect(board(makeFakeRusty([]), { ns: 'Nope', ew: 'Nope' }, fetchBbsa)).rejects.toThrow('HTTP 404')
  })
})

describe('runRustyBots — the solo-table loop', () => {
  it('bids the bots until the human is to call', async () => {
    const client = makeFakeRusty(['1NT', 'Pass'])
    const { h, made } = hooks(client)
    const res = await runRustyBots(await board(client), [], h)
    expect(res.stop).toBe('human_to_call')
    expect(res.seat).toBe('S')
    expect(made.map((m) => m.call)).toEqual(['1NT', 'Pass'])
    expect(h.bbaCall).not.toHaveBeenCalled()
    // Meanings for every call so far, from Rusty's steps.
    const m = h.onMeanings.mock.calls.at(-1)[0]
    expect(m.map((x) => x.meaning)).toEqual(['Rusty: 1NT', 'Rusty: Pass'])
  })

  it('at a no-rule stop takes BBA\'s call for that seat, logs it, and resumes', async () => {
    // N 1NT, E Pass, S (human) 2C, W Pass, N has no rule → BBA's 2H, E Pass, S human.
    const client = makeFakeRusty(['1NT', 'Pass', null, 'Pass', 'NORULE', 'Pass'])
    const { h, made } = hooks(client)
    const res = await runRustyBots(await board(client), ['1NT', 'Pass', '2C'], h)
    expect(res.stop).toBe('human_to_call')
    expect(made).toEqual([
      { call: 'Pass', by: 'rusty', index: 3 },
      { call: '2H', by: 'bba', index: 4, fallback: true },
      { call: 'Pass', by: 'rusty', index: 5 },
    ])
    expect(h.bbaCall).toHaveBeenCalledWith(['1NT', 'Pass', '2C', 'Pass'], 'N')
    const rec = h.onFallback.mock.calls[0][0]
    expect(rec).toMatchObject({
      rules_id: 'test-rules', cards: { ns: '21GF-DEFAULT', ew: '21GF-DEFAULT' },
      dealer: 'N', vul: 'None', scoring: 'MP', seat: 'N', index: 4, call: '2H',
      auction: ['1NT', 'Pass', '2C', 'Pass'],
    })
    // The resumed request carries the fallback call like any other.
    expect(client.requests.at(-1).req.auction).toEqual(['1NT', 'Pass', '2C', 'Pass', '2H'])
    // The fallback call shows BBA's meaning, marked in the data only.
    const m = h.onMeanings.mock.calls.at(-1)[0]
    expect(m[4]).toMatchObject({ meaning: 'BBA: 2H', fallback: true, position: 4 })
    // The human's 2C has no Rusty rule here: an explicit "no meaning", not "No rule applies".
    expect(m[2].meaning).toBe('Rusty has no meaning for this call')
    expect(m[2].known).toBe(false)
  })

  it('passes when BBA is unreachable at a fallback, and the table goes on', async () => {
    const client = makeFakeRusty(['NORULE', 'Pass'])
    const { h, made } = hooks(client, { bbaCall: vi.fn(async () => { throw new Error('Failed to fetch') }) })
    const res = await runRustyBots(await board(client), [], h)
    expect(res.stop).toBe('human_to_call')
    expect(made.map((m) => m.call)).toEqual(['Pass', 'Pass'])
    expect(h.onFallback.mock.calls[0][0]).toMatchObject({ call: 'Pass', bbaError: 'Failed to fetch' })
  })

  it('stops quietly when a newer board takes over', async () => {
    const client = makeFakeRusty(['1NT', 'Pass'])
    let stale = false
    const { h, made } = hooks(client, {
      isStale: () => stale,
      onCall: vi.fn(async (call) => { made.push({ call }); stale = true }),
    })
    const res = await runRustyBots(await board(client), [], h)
    expect(res.stop).toBe('stale')
    expect(made).toHaveLength(1)
  })

  it('reports the end of the auction', async () => {
    const client = makeFakeRusty(['Pass', 'Pass', null, 'Pass'])
    const { h } = hooks(client)
    const res = await runRustyBots(await board(client), ['Pass', 'Pass', 'Pass'], h)
    expect(res.stop).toBe('complete')
  })
})

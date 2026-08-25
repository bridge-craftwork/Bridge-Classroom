import { describe, it, expect } from 'vitest'
import { needsEwSeatFix, fixEwSeatOrder } from '@/utils/seatOrder.js'

/** An envelope with one result, whose pairs are named for the seats the
 *  CONTRACT says each slot holds once corrected: ns = [N, S], ew = [W, E]. */
function envelope({ schema_version, source, ew = ['east-player', 'west-player'] }) {
  const env = {
    source,
    tournaments: [{ events: [{ sessions: [{ boards: [{
      number: 1,
      results: [{
        ns_pair: { players: ['north-player', 'south-player'] },
        ew_pair: { players: [...ew] },
      }],
    }] }] }] }],
  }
  if (schema_version !== undefined) env.schema_version = schema_version
  return env
}

const ewOf = (env) => env.tournaments[0].events[0].sessions[0].boards[0].results[0].ew_pair.players
const nsOf = (env) => env.tournaments[0].events[0].sessions[0].boards[0].results[0].ns_pair.players

describe('fixEwSeatOrder', () => {
  it('swaps and restamps a 1.1 acbl-live-club envelope', () => {
    const env = envelope({ schema_version: '1.1', source: 'acbl-live-club' })
    expect(needsEwSeatFix(env)).toBe(true)
    fixEwSeatOrder(env)
    // West first, East second — the contract's order.
    expect(ewOf(env)).toEqual(['west-player', 'east-player'])
    expect(env.schema_version).toBe('1.3')
  })

  it('swaps a 1.2 acbl-live envelope too', () => {
    const env = envelope({ schema_version: '1.2', source: 'acbl-live' })
    fixEwSeatOrder(env)
    expect(ewOf(env)).toEqual(['west-player', 'east-player'])
    expect(env.schema_version).toBe('1.3')
  })

  it('leaves a 1.3 envelope untouched', () => {
    const env = envelope({ schema_version: '1.3', source: 'acbl-live-club' })
    expect(needsEwSeatFix(env)).toBe(false)
    fixEwSeatOrder(env)
    expect(ewOf(env)).toEqual(['east-player', 'west-player'])
    expect(env.schema_version).toBe('1.3')
  })

  it('leaves a later version untouched', () => {
    for (const version of ['1.4', '1.10', '2.0']) {
      const env = envelope({ schema_version: version, source: 'acbl-live' })
      fixEwSeatOrder(env)
      expect(ewOf(env)).toEqual(['east-player', 'west-player'])
      expect(env.schema_version).toBe(version)
    }
  })

  it('never touches bbo, at any version', () => {
    for (const version of ['1.0', '1.1', '1.2', '1.3', '2.0']) {
      const env = envelope({ schema_version: version, source: 'bbo' })
      expect(needsEwSeatFix(env)).toBe(false)
      fixEwSeatOrder(env)
      expect(ewOf(env)).toEqual(['east-player', 'west-player'])
      expect(env.schema_version).toBe(version)
    }
  })

  it('never touches an envelope with no schema_version (the file-upload path)', () => {
    for (const source of ['file-upload', 'acbl-live-club', undefined]) {
      const env = envelope({ source })
      expect(needsEwSeatFix(env)).toBe(false)
      fixEwSeatOrder(env)
      expect(ewOf(env)).toEqual(['east-player', 'west-player'])
      expect(env.schema_version).toBeUndefined()
    }
  })

  it('never touches ns_pair', () => {
    const env = envelope({ schema_version: '1.1', source: 'acbl-live' })
    fixEwSeatOrder(env)
    expect(nsOf(env)).toEqual(['north-player', 'south-player'])
  })

  it('is idempotent — running it twice equals running it once', () => {
    const once = envelope({ schema_version: '1.1', source: 'acbl-live-club' })
    const twice = envelope({ schema_version: '1.1', source: 'acbl-live-club' })
    fixEwSeatOrder(once)
    fixEwSeatOrder(twice)
    fixEwSeatOrder(twice)
    expect(twice).toEqual(once)
    expect(ewOf(twice)).toEqual(['west-player', 'east-player'])
  })

  it('leaves a players array with no defined seats alone', () => {
    // Length 0 is a legal phantom/unindexed pair; length 1 is not legal and has
    // no defined seat. Neither may be reversed or inferred from.
    for (const players of [[], ['only-one']]) {
      const env = envelope({ schema_version: '1.1', source: 'acbl-live', ew: players })
      fixEwSeatOrder(env)
      expect(ewOf(env)).toEqual(players)
      // The restamp still happens — the envelope was processed.
      expect(env.schema_version).toBe('1.3')
    }
  })

  it('corrects every result across every board, event and session', () => {
    const env = {
      schema_version: '1.1',
      source: 'acbl-live-club',
      tournaments: [{ events: [{ sessions: [
        { boards: [
          { results: [{ ew_pair: { players: ['e1', 'w1'] } }, { ew_pair: { players: ['e2', 'w2'] } }] },
          { results: [{ ew_pair: { players: ['e3', 'w3'] } }] },
        ] },
        { boards: [{ results: [{ ew_pair: { players: ['e4', 'w4'] } }] }] },
      ] }] }],
    }
    fixEwSeatOrder(env)
    const sessions = env.tournaments[0].events[0].sessions
    const all = sessions.flatMap((s) => s.boards.flatMap((b) => b.results.map((r) => r.ew_pair.players)))
    expect(all).toEqual([['w1', 'e1'], ['w2', 'e2'], ['w3', 'e3'], ['w4', 'e4']])
  })

  it('survives envelopes with missing or malformed structure', () => {
    expect(fixEwSeatOrder(null)).toBe(null)
    expect(needsEwSeatFix(undefined)).toBe(false)
    const bare = { schema_version: '1.1', source: 'acbl-live' }
    expect(fixEwSeatOrder(bare).schema_version).toBe('1.3')
    const noPair = { schema_version: '1.1', source: 'acbl-live',
      tournaments: [{ events: [{ sessions: [{ boards: [{ results: [{}] }] }] }] }] }
    expect(() => fixEwSeatOrder(noPair)).not.toThrow()
  })

  it('treats an unparseable version as pre-fix, but only for acbl-live', () => {
    const acbl = envelope({ schema_version: 'draft', source: 'acbl-live' })
    fixEwSeatOrder(acbl)
    expect(ewOf(acbl)).toEqual(['west-player', 'east-player'])

    const bbo = envelope({ schema_version: 'draft', source: 'bbo' })
    fixEwSeatOrder(bbo)
    expect(ewOf(bbo)).toEqual(['east-player', 'west-player'])
  })
})

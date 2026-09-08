import { describe, it, expect } from 'vitest'
import { needsEwSeatFix, fixEwSeatOrder } from '@/utils/seatOrder.js'

// The two seats of a real board, so the table cases read as bridge rather than
// as arithmetic: board 4 of the extension's `sample-club-game.html`, whose deal
// gives East nine tricks in hearts and West ten. Anything that puts H:10 on
// East has the row on the wrong seat.
const EAST_ROW = { C: 11, D: 6, H: 9, S: 11, NT: 6 }
const WEST_ROW = { C: 11, D: 6, H: 10, S: 11, NT: 6 }

/** An envelope with one result, whose pairs are named for the seats the
 *  CONTRACT says each slot holds once corrected: ns = [N, S], ew = [W, E].
 *
 *  `dd` is the board's table AS IT ARRIVES. Pass the transposed one to model a
 *  pre-1.4 capture; omit it for the player-only cases. */
function envelope({ schema_version, source, ew = ['east-player', 'west-player'], dd }) {
  const board = {
    number: 1,
    results: [{
      ns_pair: { players: ['north-player', 'south-player'] },
      ew_pair: { players: [...ew] },
    }],
  }
  if (dd !== undefined) board.double_dummy = dd
  const env = {
    source,
    tournaments: [{ events: [{ sessions: [{ boards: [board] }] }] }],
  }
  if (schema_version !== undefined) env.schema_version = schema_version
  return env
}

/** A table with East and West the wrong way round, as pre-1.4 builds emit it. */
const transposedTable = () => ({ N: null, S: null, E: { ...WEST_ROW }, W: { ...EAST_ROW } })

const ewOf = (env) => env.tournaments[0].events[0].sessions[0].boards[0].results[0].ew_pair.players
const nsOf = (env) => env.tournaments[0].events[0].sessions[0].boards[0].results[0].ns_pair.players
const ddOf = (env) => env.tournaments[0].events[0].sessions[0].boards[0].double_dummy

describe('fixEwSeatOrder', () => {
  it('swaps and restamps a 1.1 acbl-live-club envelope', () => {
    const env = envelope({ schema_version: '1.1', source: 'acbl-live-club' })
    expect(needsEwSeatFix(env)).toBe(true)
    fixEwSeatOrder(env)
    // West first, East second — the contract's order.
    expect(ewOf(env)).toEqual(['west-player', 'east-player'])
    expect(env.schema_version).toBe('1.4')
  })

  it('swaps a 1.2 acbl-live envelope too', () => {
    const env = envelope({ schema_version: '1.2', source: 'acbl-live' })
    fixEwSeatOrder(env)
    expect(ewOf(env)).toEqual(['west-player', 'east-player'])
    expect(env.schema_version).toBe('1.4')
  })

  it('leaves a 1.4 envelope untouched', () => {
    const env = envelope({ schema_version: '1.4', source: 'acbl-live-club', dd: transposedTable() })
    expect(needsEwSeatFix(env)).toBe(false)
    fixEwSeatOrder(env)
    expect(ewOf(env)).toEqual(['east-player', 'west-player'])
    expect(ddOf(env).E).toEqual(WEST_ROW) // exactly as it arrived
    expect(env.schema_version).toBe('1.4')
  })

  it('leaves a later version untouched', () => {
    for (const version of ['1.5', '1.10', '2.0']) {
      const env = envelope({ schema_version: version, source: 'acbl-live' })
      fixEwSeatOrder(env)
      expect(ewOf(env)).toEqual(['east-player', 'west-player'])
      expect(env.schema_version).toBe(version)
    }
  })

  it('never touches bbo, at any version', () => {
    for (const version of ['1.0', '1.1', '1.2', '1.3', '1.4', '2.0']) {
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
    const once = envelope({ schema_version: '1.1', source: 'acbl-live-club', dd: transposedTable() })
    const twice = envelope({ schema_version: '1.1', source: 'acbl-live-club', dd: transposedTable() })
    fixEwSeatOrder(once)
    fixEwSeatOrder(twice)
    fixEwSeatOrder(twice)
    expect(twice).toEqual(once)
    expect(ewOf(twice)).toEqual(['west-player', 'east-player'])
    expect(ddOf(twice).E).toEqual(EAST_ROW)
  })

  it('leaves a players array with no defined seats alone', () => {
    // Length 0 is a legal phantom/unindexed pair; length 1 is not legal and has
    // no defined seat. Neither may be reversed or inferred from.
    for (const players of [[], ['only-one']]) {
      const env = envelope({ schema_version: '1.1', source: 'acbl-live', ew: players })
      fixEwSeatOrder(env)
      expect(ewOf(env)).toEqual(players)
      // The restamp still happens — the envelope was processed.
      expect(env.schema_version).toBe('1.4')
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
    expect(fixEwSeatOrder(bare).schema_version).toBe('1.4')
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

describe('fixEwSeatOrder — the double-dummy table', () => {
  it('puts the East and West rows back on their own seats', () => {
    const env = envelope({ schema_version: '1.1', source: 'acbl-live-club', dd: transposedTable() })
    fixEwSeatOrder(env)
    expect(ddOf(env).E).toEqual(EAST_ROW)
    expect(ddOf(env).W).toEqual(WEST_ROW)
  })

  it('fixes the table at exactly 1.3, without re-swapping the players', () => {
    // 1.3 is what this function's previous version stamped on an envelope whose
    // players it had corrected and whose table it had not — and the ingest page
    // stored what it stamped, so the archive is full of them. They are the
    // whole reason the table has a boundary of its own.
    const env = envelope({
      schema_version: '1.3',
      source: 'acbl-live-club',
      ew: ['west-player', 'east-player'], // already corrected by the old pass
      dd: transposedTable(),
    })
    expect(needsEwSeatFix(env)).toBe(true)
    fixEwSeatOrder(env)
    expect(ewOf(env)).toEqual(['west-player', 'east-player']) // left alone
    expect(ddOf(env).E).toEqual(EAST_ROW)
    expect(ddOf(env).W).toEqual(WEST_ROW)
    expect(env.schema_version).toBe('1.4')
  })

  it('never touches the North and South rows', () => {
    const ns = { C: 1, D: 7, H: 3, S: 1, NT: 3 }
    const env = envelope({
      schema_version: '1.1',
      source: 'acbl-live-club',
      dd: { N: { ...ns }, S: { ...ns }, E: { ...WEST_ROW }, W: { ...EAST_ROW } },
    })
    fixEwSeatOrder(env)
    expect(ddOf(env).N).toEqual(ns)
    expect(ddOf(env).S).toEqual(ns)
  })

  it('leaves a table with no E or W entry exactly as it arrived', () => {
    // Half a table has no defined seats to swap, the same way a one-name pair
    // has none. Guessing here would invent a row.
    for (const dd of [null, {}, { E: { ...EAST_ROW } }, { W: { ...WEST_ROW } }]) {
      const env = envelope({ schema_version: '1.1', source: 'acbl-live', dd })
      const before = JSON.stringify(dd)
      fixEwSeatOrder(env)
      expect(JSON.stringify(ddOf(env))).toBe(before)
    }
  })

  it('corrects the table on every board, not just the first', () => {
    const env = {
      schema_version: '1.1',
      source: 'acbl-live-club',
      tournaments: [{ events: [{ sessions: [
        { boards: [
          { number: 1, double_dummy: transposedTable() },
          { number: 2, double_dummy: transposedTable() },
        ] },
        { boards: [{ number: 3, double_dummy: transposedTable() }] },
      ] }] }],
    }
    fixEwSeatOrder(env)
    const boards = env.tournaments[0].events[0].sessions.flatMap((s) => s.boards)
    expect(boards.map((b) => b.double_dummy.E.H)).toEqual([9, 9, 9])
    expect(boards.map((b) => b.double_dummy.W.H)).toEqual([10, 10, 10])
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'

// The archive read path applies the same E-W seat-order correction the ingest
// page applies at the door (seat-order-contract.md § Consumer rule), because
// captures stored by older extension builds are sitting on the server with
// their E-W players and their double-dummy tables East-first. The stored 1.3
// rows matter most: the ingest page wrote them itself, players already fixed
// and table not. Only the network arm is mocked.

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }))
vi.mock('@/utils/apiFetch.js', () => ({ apiFetch: apiFetchMock }))
vi.mock('@/utils/apiUrl.js', () => ({ API_URL: 'https://api.test/api' }))

import { useClubGames } from '../useClubGames.js'

// Board 4 of the extension's sample-club-game.html: East makes nine hearts,
// West ten. A stored row carries them the wrong way round.
const EAST_ROW = { C: 11, D: 6, H: 9, S: 11, NT: 6 }
const WEST_ROW = { C: 11, D: 6, H: 10, S: 11, NT: 6 }

function payload({ schema_version, source, ew = ['east-player', 'west-player'] }) {
  const env = {
    source,
    tournaments: [{ events: [{ sessions: [{ boards: [{
      number: 1,
      double_dummy: { N: null, S: null, E: { ...WEST_ROW }, W: { ...EAST_ROW } },
      results: [{
        ns_pair: { players: ['north-player', 'south-player'] },
        ew_pair: { players: [...ew] },
      }],
    }] }] }] }],
  }
  if (schema_version !== undefined) env.schema_version = schema_version
  return JSON.stringify(env)
}

function respondWith(game) {
  apiFetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, game }),
  })
}

const seatsOf = (game) => {
  const env = JSON.parse(game.payload)
  const board = env.tournaments[0].events[0].sessions[0].boards[0]
  const result = board.results[0]
  return {
    ew: result.ew_pair.players,
    ns: result.ns_pair.players,
    east: board.double_dummy.E,
    version: env.schema_version,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useClubGames().reset()
})

describe('useClubGames().fetchGame — seat order on read', () => {
  it('corrects a stored 1.1 acbl capture and restamps it', async () => {
    respondWith({ id: 7, payload: payload({ schema_version: '1.1', source: 'acbl-live-club' }) })
    const game = await useClubGames().fetchGame(7)
    expect(seatsOf(game)).toEqual({
      ew: ['west-player', 'east-player'],
      ns: ['north-player', 'south-player'],
      east: EAST_ROW,
      version: '1.4',
    })
  })

  it('corrects the table on a stored 1.3 row, leaving its players alone', async () => {
    // What the ingest page archived between the two fixes: players already
    // reversed, table still transposed. The commonest row in the archive.
    respondWith({ id: 8, payload: payload({
      schema_version: '1.3',
      source: 'acbl-live-club',
      ew: ['west-player', 'east-player'],
    }) })
    const game = await useClubGames().fetchGame(8)
    expect(seatsOf(game)).toEqual({
      ew: ['west-player', 'east-player'],
      ns: ['north-player', 'south-player'],
      east: EAST_ROW,
      version: '1.4',
    })
  })

  it('passes a row written after both fixes straight through', async () => {
    const stored = payload({ schema_version: '1.4', source: 'acbl-live-club' })
    respondWith({ id: 12, payload: stored })
    const game = await useClubGames().fetchGame(12)
    expect(game.payload).toBe(stored) // untouched, not even re-serialized
  })

  it('never touches a bbo capture', async () => {
    const stored = payload({ schema_version: '1.1', source: 'bbo' })
    respondWith({ id: 9, payload: stored })
    expect((await useClubGames().fetchGame(9)).payload).toBe(stored)
  })

  it('leaves a payload it cannot parse for the caller to report', async () => {
    respondWith({ id: 10, payload: 'not json' })
    expect((await useClubGames().fetchGame(10)).payload).toBe('not json')
  })

  it('tolerates a game row with no payload', async () => {
    respondWith({ id: 11 })
    expect(await useClubGames().fetchGame(11)).toEqual({ id: 11 })
  })
})

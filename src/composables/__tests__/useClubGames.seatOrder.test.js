import { describe, it, expect, beforeEach, vi } from 'vitest'

// The archive read path applies the same E-W seat-order correction the ingest
// page applies at the door (seat-order-contract.md § Consumer rule), because
// captures stored by extension builds below 1.3 are sitting on the server
// East-first. Only the network arm is mocked.

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }))
vi.mock('@/utils/apiFetch.js', () => ({ apiFetch: apiFetchMock }))
vi.mock('@/utils/apiUrl.js', () => ({ API_URL: 'https://api.test/api' }))

import { useClubGames } from '../useClubGames.js'

function payload({ schema_version, source }) {
  const env = {
    source,
    tournaments: [{ events: [{ sessions: [{ boards: [{
      number: 1,
      results: [{
        ns_pair: { players: ['north-player', 'south-player'] },
        ew_pair: { players: ['east-player', 'west-player'] },
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
  const result = env.tournaments[0].events[0].sessions[0].boards[0].results[0]
  return { ew: result.ew_pair.players, ns: result.ns_pair.players, version: env.schema_version }
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
      version: '1.3',
    })
  })

  it('passes a row written after the ingest fix straight through', async () => {
    const stored = payload({ schema_version: '1.3', source: 'acbl-live-club' })
    respondWith({ id: 8, payload: stored })
    const game = await useClubGames().fetchGame(8)
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

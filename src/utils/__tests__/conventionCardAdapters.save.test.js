import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'

const calls = []
let reply = { status: 200, body: { success: true, version: 4 } }
vi.mock('@/utils/apiFetch.js', () => ({
  apiFetch: vi.fn(async (url, opts = {}) => {
    calls.push({ url, opts })
    return { ok: reply.status < 400, status: reply.status, json: async () => reply.body, text: async () => JSON.stringify(reply.body) }
  }),
}))
vi.mock('../../composables/useUserStore.js', () => ({
  useUserStore: () => ({ currentUser: ref({ id: 'u1' }) }),
}))
vi.mock('../../composables/useBoardStatus.js', () => ({ useBoardStatus: () => ({}) }))

const { bridgeClassroomStorage } = await import('../conventionCardAdapters.js')

describe('bridgeClassroomStorage.save', () => {
  beforeEach(() => { calls.length = 0; reply = { status: 200, body: { success: true, version: 4 } } })

  it('sends the version the card was loaded at', async () => {
    await bridgeClassroomStorage.save({ id: 'c1', version: 3 }, { a: 1 })
    expect(JSON.parse(calls[0].opts.body)).toEqual({ acting_user_id: 'u1', card_data: { a: 1 }, base_version: 3 })
  })

  it('says someone else saved it when the API refuses a stale save', async () => {
    reply = { status: 409, body: { error: 'version_conflict', current: { version: 5 } } }
    await expect(bridgeClassroomStorage.save({ id: 'c1', version: 3 }, {})).rejects.toThrow(/Someone else saved this card/)
  })

  it('overwrite replaces without a version check', async () => {
    await bridgeClassroomStorage.overwrite('c1', { name: 'X', cardData: {} })
    expect(JSON.parse(calls[0].opts.body)).not.toHaveProperty('base_version')
  })
})

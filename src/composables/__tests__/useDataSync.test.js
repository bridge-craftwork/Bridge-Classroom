import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { computed, ref } from 'vue'

// #35: the four sync paths fixed in eb249ea. useDataSync keeps its guards in
// module state, so every test loads a fresh copy.

const shadow = { id: 'viewed-student', dataConsent: true, serverRegistered: false }
const realUser = ref(null)
const currentUser = ref(null)
const updateUser = vi.fn()
const syncRole = vi.fn()

let queue = []
const observationStore = {
  encryptPendingObservations: vi.fn(async () => 0),
  getPendingObservations: vi.fn(() => [...queue]),
  removeSyncedObservations: vi.fn((ids) => {
    queue = queue.filter((o) => !ids.includes(o.metadata.observation_id))
  }),
  pendingCount: computed(() => queue.length),
}

vi.mock('../useUserStore.js', () => ({
  useUserStore: () => ({ realUser, currentUser, updateUser, syncRole }),
}))
vi.mock('../useObservationStore.js', () => ({
  useObservationStore: () => observationStore,
}))
vi.mock('../useAccomplishments.js', () => ({
  useAccomplishments: () => ({ loadAccomplishments: vi.fn(async () => {}) }),
}))
vi.mock('../useBoardStatus.js', () => ({
  useBoardStatus: () => ({ invalidateCache: vi.fn() }),
}))
vi.mock('../useAssignmentStatus.js', () => ({
  useAssignmentStatus: () => ({ invalidateCache: vi.fn() }),
}))
vi.mock('../../utils/diagnostics.js', () => ({ logDiagnostic: vi.fn() }))

const row = (id, encrypted = true) => ({
  encrypted,
  encrypted_data: `data-${id}`,
  iv: `iv-${id}`,
  metadata: { observation_id: id },
})
const json = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
})

const posts = (path) => fetch.mock.calls.filter(([url, o]) => String(url).endsWith(path) && o?.method === 'POST')
const postedIds = (call) => JSON.parse(call[1].body).observations.map((o) => o.metadata.observation_id)
const queuedIds = () => queue.map((o) => o.metadata.observation_id)

// A server that stores every row it is sent, unless a test overrides it.
const storeAll = async (url, options) => {
  if (String(url).endsWith('/users')) return json({ success: true, user_id: JSON.parse(options.body).user_id })
  return json({ stored: JSON.parse(options.body).observations.length, errors: [] })
}

async function load() {
  vi.resetModules()
  const { useDataSync } = await import('../useDataSync.js')
  return useDataSync()
}

function setOnline(online) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online)
}

describe('useDataSync', () => {
  const me = { id: 'me', dataConsent: true, serverRegistered: true, secretKey: 'my-key' }

  beforeEach(() => {
    realUser.value = { ...me }
    currentUser.value = realUser.value
    queue = []
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn(storeAll))
    setOnline(true)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('sync triggers install once (§C1)', () => {
    it('adds one set of listeners and one interval, however often it initializes', async () => {
      const onWindow = vi.spyOn(window, 'addEventListener')
      const onDocument = vi.spyOn(document, 'addEventListener')
      const interval = vi.spyOn(globalThis, 'setInterval')

      const sync = await load()
      await sync.initialize()
      await sync.initialize()
      await sync.initialize()

      const count = (spy, name) => spy.mock.calls.filter(([event]) => event === name).length
      expect(count(onWindow, 'online')).toBe(1)
      expect(count(onWindow, 'offline')).toBe(1)
      expect(count(onWindow, 'beforeunload')).toBe(1)
      expect(count(onDocument, 'visibilitychange')).toBe(1)
      expect(interval).toHaveBeenCalledTimes(1)
    })
  })

  describe('flush before Switch User (§C2)', () => {
    it('MainLayout flushes the queue before it wipes it', () => {
      const source = readFileSync('src/views/MainLayout.vue', 'utf8')
      const start = source.indexOf('async function handleSwitchUser()')
      expect(start).toBeGreaterThan(-1)
      const body = source.slice(start, source.indexOf('\n}\n', start))
      const flush = body.indexOf('await dataSync.forceSync()')
      const wipe = body.indexOf('useObservationStore().reset()')
      expect(flush).toBeGreaterThan(-1)
      expect(wipe).toBeGreaterThan(flush)
    })

    it('forceSync sends a queue still waiting on the debounce, once', async () => {
      vi.useFakeTimers()
      queue = [row('a')]
      const sync = await load()
      sync.triggerSync()
      await sync.forceSync()
      expect(posts('/observations')).toHaveLength(1)
      expect(queue).toEqual([])

      await vi.advanceTimersByTimeAsync(10000) // the debounce was cancelled
      expect(posts('/observations')).toHaveLength(1)
    })

    it('forceSync resolves offline without sending, so the switch can go on', async () => {
      setOnline(false)
      queue = [row('a')]
      const sync = await load()
      await expect(sync.forceSync()).resolves.toMatchObject({ offline: true })
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  describe('sync as the real user during View as (§C5)', () => {
    beforeEach(() => {
      currentUser.value = shadow
    })

    it('registers the real user, with their key, never the viewed student', async () => {
      realUser.value = { ...me, serverRegistered: false }
      const sync = await load()
      await sync.performSync()

      expect(posts('/users')).toHaveLength(1)
      const body = JSON.parse(posts('/users')[0][1].body)
      expect(body.user_id).toBe('me')
      expect(body.secret_key).toBe('my-key')
      expect(updateUser).toHaveBeenCalledWith('me', { serverRegistered: true })
    })

    it("follows the real user's consent, not the viewed student's", async () => {
      realUser.value = { ...me, dataConsent: false }
      queue = [row('a')]
      const sync = await load()
      await sync.performSync()
      expect(posts('/observations')).toHaveLength(0)
    })

    it("sends the real user's queue", async () => {
      queue = [row('a')]
      const sync = await load()
      await sync.performSync()
      expect(postedIds(posts('/observations')[0])).toEqual(['a'])
    })

    it("the page-unload beacon follows the real user's consent", async () => {
      const beacon = vi.fn()
      Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true })
      const onWindow = vi.spyOn(window, 'addEventListener')
      const sync = await load()
      await sync.initialize()
      const unload = onWindow.mock.calls.find(([event]) => event === 'beforeunload')[1]

      queue = [row('a')]
      realUser.value = { ...me, dataConsent: false }
      unload()
      expect(beacon).not.toHaveBeenCalled()

      realUser.value = { ...me }
      unload()
      expect(beacon).toHaveBeenCalledTimes(1)
    })
  })

  describe('removing rows from the queue (§C6)', () => {
    it('removes everything sent after a clean sync', async () => {
      queue = [row('a'), row('b')]
      const sync = await load()
      const result = await sync.performSync()
      expect(queue).toEqual([])
      expect(result.observationsSynced).toBe(2)
      expect(sync.syncState.value).toBe('idle')
    })

    it('keeps rows that are not encrypted yet, and so were not sent', async () => {
      queue = [row('waiting', false), row('a')]
      const sync = await load()
      await sync.performSync()
      expect(postedIds(posts('/observations')[0])).toEqual(['a'])
      expect(queuedIds()).toEqual(['waiting'])
    })

    it('keeps a row recorded while the request was in flight', async () => {
      queue = [row('a')]
      fetch.mockImplementationOnce(async (url, options) => {
        queue.push(row('late'))
        return storeAll(url, options)
      })
      const sync = await load()
      await sync.performSync()
      expect(queuedIds()).toEqual(['late'])
    })

    it('keeps the whole queue when any row fails, so a failed row is never dropped', async () => {
      queue = [row('fails'), row('b'), row('c')]
      fetch.mockImplementationOnce(async () => json({ stored: 2, errors: ['Failed to store fails'] }))
      const sync = await load()
      const result = await sync.performSync()
      expect(queuedIds()).toEqual(['fails', 'b', 'c'])
      expect(observationStore.removeSyncedObservations).not.toHaveBeenCalled()
      expect(result.observationsSynced).toBe(0)
    })

    it('keeps the queue and reports an error on an HTTP failure', async () => {
      queue = [row('a')]
      fetch.mockImplementationOnce(async () => json({ nope: true }, 500))
      const sync = await load()
      await sync.performSync()
      expect(queuedIds()).toEqual(['a'])
      expect(sync.syncState.value).toBe('error')
      expect(sync.lastError.value).toContain('500')
    })

    it('keeps the queue and reports an error when the request throws', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      queue = [row('a')]
      fetch.mockImplementationOnce(async () => { throw new Error('network down') })
      const sync = await load()
      await sync.performSync()
      expect(queuedIds()).toEqual(['a'])
      expect(sync.lastError.value).toBe('network down')
    })

    it('runs one sync at a time, and allows the next once it finishes', async () => {
      queue = [row('a')]
      let release
      fetch.mockImplementationOnce((url, options) => new Promise((resolve) => {
        release = () => resolve(storeAll(url, options))
      }))
      const sync = await load()

      const first = sync.performSync()
      await vi.waitFor(() => expect(release).toBeDefined())
      await expect(sync.performSync()).resolves.toMatchObject({ skipped: true })
      expect(posts('/observations')).toHaveLength(1)

      release()
      await first
      queue = [row('b')]
      await sync.performSync()
      expect(posts('/observations')).toHaveLength(2)
    })
  })

  // These pin behaviour that is known to be wrong, so a fix shows up as a failing
  // test here. Update them when the issue is fixed.
  describe('known issues', () => {
    it('#112: one permanently failing row re-sends the whole queue on every sync, unreported', async () => {
      queue = [row('rejected'), row('b'), row('c')]
      fetch.mockImplementation(async () => json({ stored: 2, errors: ['Failed to store rejected'] }))
      const sync = await load()

      await sync.performSync()
      await sync.performSync()
      await sync.performSync()

      expect(posts('/observations').map(postedIds)).toEqual([
        ['rejected', 'b', 'c'],
        ['rejected', 'b', 'c'],
        ['rejected', 'b', 'c'],
      ])
      expect(queuedIds()).toEqual(['rejected', 'b', 'c'])
      // Nothing tells the user: the state reads as a healthy, finished sync.
      expect(sync.syncState.value).toBe('idle')
      expect(sync.lastError.value).toBeNull()
      expect(sync.lastSyncAt.value).not.toBeNull()
    })
  })
})

// The encryption step lives in the store, so this one runs the real store.
describe('encrypting during View as (#35 §C5, known gap)', () => {
  it('reads the viewed student, who has no key, so nothing encrypts until View as ends', async () => {
    const { useObservationStore: useRealStore } = await vi.importActual('../useObservationStore.js')
    const { generateSecretKey } = await import('../../utils/crypto.js')
    const store = useRealStore()
    localStorage.setItem('bridgePractice', JSON.stringify({
      pendingObservations: [{ encrypted: false, observation: { x: 1 }, metadata: { observation_id: 'a' } }],
    }))
    store.loadFromStorage()

    realUser.value = { id: 'me', secretKey: await generateSecretKey() }
    currentUser.value = shadow
    expect(await store.encryptPendingObservations()).toBe(0)
    expect(store.getPendingObservations()[0].encrypted).toBe(false)

    currentUser.value = realUser.value
    expect(await store.encryptPendingObservations()).toBe(1)
    expect(store.getPendingObservations()[0].encrypted).toBe(true)

    store.reset()
  })
})

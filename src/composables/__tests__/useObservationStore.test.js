import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useObservationStore } from '../useObservationStore.js'
import { useUserStore } from '../useUserStore.js'

// Mock localStorage
const localStorageMock = {
  store: {},
  getItem: vi.fn((key) => localStorageMock.store[key] || null),
  setItem: vi.fn((key, value) => {
    localStorageMock.store[key] = value
  }),
  removeItem: vi.fn((key) => {
    delete localStorageMock.store[key]
  }),
  clear: vi.fn(() => {
    localStorageMock.store = {}
  })
}

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
  writable: true
})

// Mock crypto.randomUUID
let uuidCounter = 0
vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
  uuidCounter++
  return `test-uuid-${uuidCounter}`
})

describe('useObservationStore', () => {
  beforeEach(() => {
    localStorageMock.clear()
    localStorageMock.store = {}
    uuidCounter = 0

    // Reset store state
    const store = useObservationStore()
    store.reset()

    // Reset user store
    const userStore = useUserStore()
    userStore.clearUsers()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('initialization', () => {
    it('should initialize with empty state', () => {
      const store = useObservationStore()
      store.initialize()

      expect(store.pendingCount.value).toBe(0)
      expect(store.hasPendingObservations.value).toBe(false)
      expect(store.currentSessionId.value).toBeTruthy()
    })

    it('should load pending observations from localStorage', () => {
      const store = useObservationStore()
      store.reset() // Reset first to clear singleton state

      // Now set test data in localStorage
      localStorageMock.store['bridgePractice'] = JSON.stringify({
        pendingObservations: [
          { metadata: { observation_id: 'obs-1' } },
          { metadata: { observation_id: 'obs-2' } }
        ]
      })

      store.loadFromStorage()

      expect(store.pendingCount.value).toBe(2)
    })

    it('should start a new session with stats', () => {
      const store = useObservationStore()
      store.initialize()

      const stats = store.getSessionStats()
      expect(stats.totalObservations).toBe(0)
      expect(stats.correctCount).toBe(0)
      expect(stats.wrongCount).toBe(0)
      expect(stats.startedAt).toBeTruthy()
    })
  })

  describe('recordObservation', () => {
    const mockDeal = {
      subfolder: 'Stayman',
      filename: 'deal005.pbn',
      boardNumber: 5,
      dealer: 'N',
      vulnerable: 'None',
      studentSeat: 'S',
      skillPath: 'bidding_conventions/stayman', // Embedded by lesson builder
      hands: {
        N: 'SAQ5 H74 DQ962 CAJT8',
        E: 'SKT HQJT982 D83 C652',
        S: 'S872 HK6 DAKJ4 CKQ74',
        W: 'SJ9643 HA53 DT75 C93'
      },
      auction: ['1NT', 'Pass', '2C', 'Pass'],
      prompts: [{ bid: '2C' }]
    }

    it('should fail without authenticated user', async () => {
      const store = useObservationStore()
      store.initialize()

      const result = await store.recordObservation({
        deal: mockDeal,
        promptIndex: 0,
        auctionSoFar: ['1NT', 'Pass'],
        expectedBid: '2C',
        studentBid: '2C',
        correct: true,
        attemptNumber: 1,
        timeTakenMs: 1000
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('No authenticated user')
    })

    it('should record observation for authenticated user', async () => {
      // Create a user first (without encryption for simpler test)
      const userStore = useUserStore()
      userStore.initialize()

      // Create user without keys for this test
      const userData = {
        id: 'user-123',
        firstName: 'Test',
        lastName: 'User',
        classrooms: ['tuesday-am'],
        dataConsent: false, // No consent = no encryption attempt
        publicKey: null,
        privateKey: null,
        createdAt: new Date().toISOString()
      }
      userStore.users.value['user-123'] = userData
      userStore.currentUserId.value = 'user-123'

      const store = useObservationStore()
      store.initialize()

      const result = await store.recordObservation({
        deal: mockDeal,
        promptIndex: 0,
        auctionSoFar: ['1NT', 'Pass'],
        expectedBid: '2C',
        studentBid: '2C',
        correct: true,
        attemptNumber: 1,
        timeTakenMs: 1500
      })

      expect(result.success).toBe(true)
      expect(result.observation).toBeDefined()
      expect(result.observation.skill_path).toBe('bidding_conventions/stayman')

      // Check session stats updated
      const stats = store.getSessionStats()
      expect(stats.totalObservations).toBe(1)
      expect(stats.correctCount).toBe(1)
      expect(stats.wrongCount).toBe(0)
    })

    it('should update stats for wrong bids', async () => {
      const userStore = useUserStore()
      userStore.initialize()
      userStore.users.value['user-123'] = {
        id: 'user-123',
        firstName: 'Test',
        lastName: 'User',
        classrooms: [],
        dataConsent: false,
        createdAt: new Date().toISOString()
      }
      userStore.currentUserId.value = 'user-123'

      const store = useObservationStore()
      store.initialize()

      await store.recordObservation({
        deal: mockDeal,
        promptIndex: 0,
        auctionSoFar: ['1NT', 'Pass'],
        expectedBid: '2C',
        studentBid: '2NT', // Wrong bid
        correct: false,
        attemptNumber: 1,
        timeTakenMs: 2000
      })

      const stats = store.getSessionStats()
      expect(stats.totalObservations).toBe(1)
      expect(stats.correctCount).toBe(0)
      expect(stats.wrongCount).toBe(1)
    })

    it('should queue unencrypted observations when user has no keys', async () => {
      const userStore = useUserStore()
      userStore.initialize()
      userStore.users.value['user-123'] = {
        id: 'user-123',
        firstName: 'Test',
        lastName: 'User',
        classrooms: ['tuesday-am'],
        dataConsent: true, // Has consent but no keys
        publicKey: null,
        createdAt: new Date().toISOString()
      }
      userStore.currentUserId.value = 'user-123'

      const store = useObservationStore()
      store.initialize()

      await store.recordObservation({
        deal: mockDeal,
        promptIndex: 0,
        auctionSoFar: ['1NT', 'Pass'],
        expectedBid: '2C',
        studentBid: '2C',
        correct: true,
        attemptNumber: 1,
        timeTakenMs: 1000
      })

      expect(store.pendingCount.value).toBe(1)

      const pending = store.getPendingObservations()
      expect(pending[0].encrypted).toBe(false)
      expect(pending[0].metadata.classroom).toBe('tuesday-am')
    })
  })

  describe('pending observation management', () => {
    beforeEach(() => {
      const store = useObservationStore()
      store.reset()
    })

    it('should get pending count', () => {
      localStorageMock.store['bridgePractice'] = JSON.stringify({
        pendingObservations: [
          { metadata: { observation_id: 'obs-1' } },
          { metadata: { observation_id: 'obs-2' } },
          { metadata: { observation_id: 'obs-3' } }
        ]
      })

      const store = useObservationStore()
      store.loadFromStorage()

      expect(store.getPendingCount()).toBe(3)
    })

    it('should remove synced observations', () => {
      localStorageMock.store['bridgePractice'] = JSON.stringify({
        pendingObservations: [
          { metadata: { observation_id: 'obs-1' } },
          { metadata: { observation_id: 'obs-2' } },
          { metadata: { observation_id: 'obs-3' } }
        ]
      })

      const store = useObservationStore()
      store.loadFromStorage()

      store.removeSyncedObservations(['obs-1', 'obs-3'])

      expect(store.pendingCount.value).toBe(1)
      const remaining = store.getPendingObservations()
      expect(remaining[0].metadata.observation_id).toBe('obs-2')
    })

    it('should clear all pending observations', () => {
      localStorageMock.store['bridgePractice'] = JSON.stringify({
        pendingObservations: [
          { metadata: { observation_id: 'obs-1' } },
          { metadata: { observation_id: 'obs-2' } }
        ]
      })

      const store = useObservationStore()
      store.loadFromStorage()
      store.clearPendingObservations()

      expect(store.pendingCount.value).toBe(0)
    })
  })

  describe('session management', () => {
    it('should start a new session', () => {
      const store = useObservationStore()
      store.initialize()

      const firstSessionId = store.currentSessionId.value
      store.startNewSession()
      const secondSessionId = store.currentSessionId.value

      expect(firstSessionId).not.toBe(secondSessionId)
    })

    it('should reset stats on new session', () => {
      const store = useObservationStore()
      store.initialize()

      // Manually modify stats
      store.sessionStats.value.totalObservations = 10
      store.sessionStats.value.correctCount = 8
      store.sessionStats.value.wrongCount = 2

      store.startNewSession()

      const stats = store.getSessionStats()
      expect(stats.totalObservations).toBe(0)
      expect(stats.correctCount).toBe(0)
      expect(stats.wrongCount).toBe(0)
    })
  })

  describe('computed properties', () => {
    it('should compute hasPendingObservations correctly', () => {
      const store = useObservationStore()
      store.reset()

      expect(store.hasPendingObservations.value).toBe(false)

      store.pendingObservations.value.push({ metadata: { observation_id: 'test' } })

      expect(store.hasPendingObservations.value).toBe(true)
    })

    it('should compute hasUnencryptedObservations correctly', () => {
      const store = useObservationStore()
      store.reset()

      expect(store.hasUnencryptedObservations.value).toBe(false)

      // An encrypted entry does not flag as unencrypted
      store.pendingObservations.value.push({
        metadata: { observation_id: 'enc' },
        encrypted: true
      })
      expect(store.hasUnencryptedObservations.value).toBe(false)

      // A pending entry without encryption does
      store.pendingObservations.value.push({
        metadata: { observation_id: 'plain' },
        encrypted: false
      })
      expect(store.hasUnencryptedObservations.value).toBe(true)
    })
  })

  describe('reset', () => {
    it('should reset all state', () => {
      const store = useObservationStore()
      store.initialize()

      store.pendingObservations.value.push({ metadata: { observation_id: 'test' } })
      store.sessionStats.value.totalObservations = 5

      store.reset()

      expect(store.pendingCount.value).toBe(0)
      expect(store.sessionId.value).toBeNull()
      expect(store.initialized.value).toBe(false)
    })
  })
})

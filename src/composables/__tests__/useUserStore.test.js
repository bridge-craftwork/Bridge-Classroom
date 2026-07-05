import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useUserStore } from '../useUserStore.js'

describe('useUserStore', () => {
  beforeEach(() => {
    localStorage.clear()
    const store = useUserStore()
    store.clearUsers()
  })

  describe('createUser', () => {
    it('creates a new user with required fields', async () => {
      const store = useUserStore()

      const user = await store.createUser({
        firstName: 'Margaret',
        lastName: 'Thompson',
        email: 'margaret@example.com',
        classrooms: ['tuesday-am'],
        dataConsent: true
      })

      expect(user.id).toBeDefined()
      expect(user.firstName).toBe('Margaret')
      expect(user.lastName).toBe('Thompson')
      expect(user.classrooms).toEqual(['tuesday-am'])
      expect(user.dataConsent).toBe(true)
      expect(user.createdAt).toBeDefined()
    })

    it('generates a cryptographic secret key', async () => {
      const store = useUserStore()

      const user = await store.createUser({
        firstName: 'Margaret',
        lastName: 'Thompson',
        email: 'margaret@example.com'
      })

      expect(user.secretKey).toBeDefined()
      expect(typeof user.secretKey).toBe('string')
      expect(user.secretKey.length).toBeGreaterThan(0)
    })

    it('trims whitespace from names', async () => {
      const store = useUserStore()

      const user = await store.createUser({
        firstName: '  Margaret  ',
        lastName: '  Thompson  ',
        email: 'margaret@example.com',
        classrooms: []
      })

      expect(user.firstName).toBe('Margaret')
      expect(user.lastName).toBe('Thompson')
    })

    it('sets created user as current user', async () => {
      const store = useUserStore()

      const user = await store.createUser({
        firstName: 'Margaret',
        lastName: 'Thompson',
        email: 'margaret@example.com'
      })

      expect(store.currentUserId.value).toBe(user.id)
      expect(store.currentUser.value).toEqual(user)
    })

    it('defaults dataConsent to true', async () => {
      const store = useUserStore()

      const user = await store.createUser({
        firstName: 'Test',
        lastName: 'User',
        email: 'test@example.com'
      })

      expect(user.dataConsent).toBe(true)
    })

    it('defaults classrooms to empty array', async () => {
      const store = useUserStore()

      const user = await store.createUser({
        firstName: 'Test',
        lastName: 'User',
        email: 'test@example.com'
      })

      expect(user.classrooms).toEqual([])
    })
  })

  describe('updateUser', () => {
    it('updates user fields', async () => {
      const store = useUserStore()
      const user = await store.createUser({
        firstName: 'Margaret',
        lastName: 'Thompson',
        email: 'margaret@example.com'
      })

      store.updateUser(user.id, {
        firstName: 'Maggie',
        dataConsent: false
      })

      expect(store.currentUser.value.firstName).toBe('Maggie')
      expect(store.currentUser.value.lastName).toBe('Thompson')
      expect(store.currentUser.value.dataConsent).toBe(false)
    })

    it('updates updatedAt timestamp', async () => {
      const store = useUserStore()
      const user = await store.createUser({
        firstName: 'Test',
        lastName: 'User',
        email: 'test@example.com'
      })
      const originalUpdatedAt = user.updatedAt

      // Advance the clock so the new ISO timestamp is guaranteed to differ
      // (createUser and updateUser can otherwise land in the same millisecond).
      vi.useFakeTimers()
      vi.setSystemTime(new Date(Date.parse(originalUpdatedAt) + 1000))
      try {
        store.updateUser(user.id, { firstName: 'Updated' })
      } finally {
        vi.useRealTimers()
      }

      expect(store.currentUser.value.updatedAt).not.toBe(originalUpdatedAt)
    })

    it('returns null for non-existent user', () => {
      const store = useUserStore()

      const result = store.updateUser('non-existent', { firstName: 'Test' })

      expect(result).toBeNull()
    })
  })

  describe('deleteUser', () => {
    it('deletes user by id', async () => {
      const store = useUserStore()
      const user = await store.createUser({
        firstName: 'Test',
        lastName: 'User',
        email: 'test@example.com'
      })

      const result = store.deleteUser(user.id)

      expect(result).toBe(true)
      expect(store.hasUsers.value).toBe(false)
    })

    it('switches to another user when current is deleted', async () => {
      const store = useUserStore()
      const user1 = await store.createUser({
        firstName: 'User',
        lastName: 'One',
        email: 'one@example.com'
      })
      const user2 = await store.createUser({
        firstName: 'User',
        lastName: 'Two',
        email: 'two@example.com'
      })

      // Current user is user2
      expect(store.currentUserId.value).toBe(user2.id)

      store.deleteUser(user2.id)

      // Should switch to user1
      expect(store.currentUserId.value).toBe(user1.id)
    })

    it('returns false for non-existent user', () => {
      const store = useUserStore()

      const result = store.deleteUser('non-existent')

      expect(result).toBe(false)
    })
  })

  describe('switchUser', () => {
    it('switches to specified user', async () => {
      const store = useUserStore()
      const user1 = await store.createUser({
        firstName: 'User',
        lastName: 'One',
        email: 'one@example.com'
      })
      const user2 = await store.createUser({
        firstName: 'User',
        lastName: 'Two',
        email: 'two@example.com'
      })

      store.switchUser(user1.id)

      expect(store.currentUserId.value).toBe(user1.id)
      expect(store.currentUser.value.firstName).toBe('User')
    })

    it('returns false for non-existent user', () => {
      const store = useUserStore()

      const result = store.switchUser('non-existent')

      expect(result).toBe(false)
    })
  })

  describe('findUserByName', () => {
    it('finds user by name (case insensitive)', async () => {
      const store = useUserStore()
      const user = await store.createUser({
        firstName: 'Margaret',
        lastName: 'Thompson',
        email: 'margaret@example.com'
      })

      const found = store.findUserByName('margaret', 'THOMPSON')

      expect(found).toEqual(user)
    })

    it('returns null when not found', async () => {
      const store = useUserStore()
      await store.createUser({
        firstName: 'Margaret',
        lastName: 'Thompson',
        email: 'margaret@example.com'
      })

      const found = store.findUserByName('Robert', 'Thompson')

      expect(found).toBeNull()
    })
  })

  describe('computed properties', () => {
    it('allUsers returns array of all users', async () => {
      const store = useUserStore()
      await store.createUser({ firstName: 'User', lastName: 'One', email: 'one@example.com' })
      await store.createUser({ firstName: 'User', lastName: 'Two', email: 'two@example.com' })

      expect(store.allUsers.value).toHaveLength(2)
    })

    it('hasUsers is true when users exist', async () => {
      const store = useUserStore()

      expect(store.hasUsers.value).toBe(false)

      await store.createUser({ firstName: 'Test', lastName: 'User', email: 'test@example.com' })

      expect(store.hasUsers.value).toBe(true)
    })

    it('userCount returns number of users', async () => {
      const store = useUserStore()

      expect(store.userCount.value).toBe(0)

      await store.createUser({ firstName: 'User', lastName: 'One', email: 'one@example.com' })
      await store.createUser({ firstName: 'User', lastName: 'Two', email: 'two@example.com' })

      expect(store.userCount.value).toBe(2)
    })

    it('isAuthenticated is true when current user exists', async () => {
      const store = useUserStore()

      expect(store.isAuthenticated.value).toBe(false)

      await store.createUser({ firstName: 'Test', lastName: 'User', email: 'test@example.com' })

      expect(store.isAuthenticated.value).toBe(true)
    })
  })

  describe('persistence', () => {
    it('persists users to localStorage', async () => {
      const store1 = useUserStore()
      await store1.createUser({
        firstName: 'Margaret',
        lastName: 'Thompson',
        email: 'margaret@example.com',
        classrooms: ['tuesday-am']
      })

      // Simulate page reload
      const store2 = useUserStore()
      store2.loadFromStorage()

      expect(store2.hasUsers.value).toBe(true)
      expect(store2.currentUser.value.firstName).toBe('Margaret')
    })
  })
})

import { describe, it, expect } from 'vitest'
import {
  generateSecretKey,
  importSecretKey,
  encryptObservation,
  decryptObservation,
  generateViewerKeyPair,
  createSharingGrant,
  decryptSharingGrant,
  createKeyBackup,
  validateKeyBackup,
  validateSecretKey,
  arrayBufferToBase64,
  base64ToArrayBuffer
} from '../crypto.js'

describe('crypto utilities', () => {
  describe('arrayBufferToBase64 / base64ToArrayBuffer', () => {
    it('round-trips correctly', () => {
      const original = new Uint8Array([1, 2, 3, 4, 5, 255, 0, 128])
      const base64 = arrayBufferToBase64(original.buffer)
      const restored = new Uint8Array(base64ToArrayBuffer(base64))

      expect(restored).toEqual(original)
    })

    it('handles empty buffer', () => {
      const original = new Uint8Array([])
      const base64 = arrayBufferToBase64(original.buffer)
      const restored = new Uint8Array(base64ToArrayBuffer(base64))

      expect(restored).toEqual(original)
    })
  })

  describe('generateSecretKey / importSecretKey', () => {
    it('generates a base64-encoded 256-bit AES key', async () => {
      const secretKey = await generateSecretKey()

      expect(typeof secretKey).toBe('string')
      // 32 raw bytes (256 bits) → base64 length 44 (incl. padding)
      const raw = new Uint8Array(base64ToArrayBuffer(secretKey))
      expect(raw.length).toBe(32)
    })

    it('imports the generated key as an AES-GCM CryptoKey', async () => {
      const secretKey = await generateSecretKey()
      const key = await importSecretKey(secretKey)

      expect(key.type).toBe('secret')
      expect(key.algorithm.name).toBe('AES-GCM')
    })

    it('produces distinct keys on each call', async () => {
      const a = await generateSecretKey()
      const b = await generateSecretKey()

      expect(a).not.toBe(b)
    })
  })

  describe('observation encryption', () => {
    it('encrypts and decrypts an observation object round-trip', async () => {
      const secretKey = await generateSecretKey()
      const observation = {
        user_id: 'student-123',
        skill_path: 'bidding_conventions/stayman',
        correct: false,
        nested: { arr: [1, 2, 3], flag: true }
      }

      const { encrypted_data, iv } = await encryptObservation(observation, secretKey)

      expect(typeof encrypted_data).toBe('string')
      expect(typeof iv).toBe('string')

      const decrypted = await decryptObservation(encrypted_data, iv, secretKey)
      expect(decrypted).toEqual(observation)
    })

    it('produces a random IV and different ciphertext each time', async () => {
      const secretKey = await generateSecretKey()
      const observation = { same: 'message' }

      const first = await encryptObservation(observation, secretKey)
      const second = await encryptObservation(observation, secretKey)

      expect(first.iv).not.toBe(second.iv)
      expect(first.encrypted_data).not.toBe(second.encrypted_data)
    })

    it('fails to decrypt with the wrong key', async () => {
      const secretKey = await generateSecretKey()
      const wrongKey = await generateSecretKey()
      const { encrypted_data, iv } = await encryptObservation({ x: 1 }, secretKey)

      await expect(
        decryptObservation(encrypted_data, iv, wrongKey)
      ).rejects.toThrow()
    })
  })

  describe('sharing grants (viewer keypair round-trip)', () => {
    it('generates a base64 viewer keypair', async () => {
      const { publicKey, privateKey } = await generateViewerKeyPair()

      expect(typeof publicKey).toBe('string')
      expect(typeof privateKey).toBe('string')
      expect(publicKey.length).toBeGreaterThan(100)
      expect(privateKey.length).toBeGreaterThan(100)
    })

    it('creates and decrypts a sharing grant to recover the secret key', async () => {
      const secretKey = await generateSecretKey()
      const { publicKey, privateKey } = await generateViewerKeyPair()

      const grant = await createSharingGrant(secretKey, publicKey)
      expect(typeof grant).toBe('string')

      const recovered = await decryptSharingGrant(grant, privateKey)
      expect(recovered).toBe(secretKey)
    })

    it('a viewer with the recovered key can decrypt an observation', async () => {
      const secretKey = await generateSecretKey()
      const { publicKey, privateKey } = await generateViewerKeyPair()
      const observation = { user_id: 'student-456', correct: true }

      const { encrypted_data, iv } = await encryptObservation(observation, secretKey)
      const grant = await createSharingGrant(secretKey, publicKey)
      const recoveredKey = await decryptSharingGrant(grant, privateKey)

      const decrypted = await decryptObservation(encrypted_data, iv, recoveredKey)
      expect(decrypted).toEqual(observation)
    })
  })

  describe('createKeyBackup', () => {
    it('creates a valid v2.0 backup object', () => {
      const user = {
        id: 'user-123',
        firstName: 'Margaret',
        lastName: 'Thompson',
        email: 'margaret@example.com',
        secretKey: 'base64-secret-key'
      }

      const backup = createKeyBackup(user)

      expect(backup.bridge_practice_backup).toBe(true)
      expect(backup.version).toBe('2.0')
      expect(backup.user_id).toBe('user-123')
      expect(backup.name).toBe('Margaret Thompson')
      expect(backup.email).toBe('margaret@example.com')
      expect(backup.secret_key).toBe('base64-secret-key')
      expect(backup.note).toContain('Keep this file safe')
    })

    it('round-trips: a real backup validates', async () => {
      const secretKey = await generateSecretKey()
      const backup = createKeyBackup({
        id: 'user-xyz',
        firstName: 'Real',
        lastName: 'User',
        email: 'real@example.com',
        secretKey
      })

      expect(validateKeyBackup(backup).valid).toBe(true)
    })
  })

  describe('validateKeyBackup', () => {
    it('validates a correct v2.0 backup', () => {
      const backup = {
        bridge_practice_backup: true,
        version: '2.0',
        user_id: 'user-123',
        secret_key: 'key-data'
      }

      expect(validateKeyBackup(backup)).toEqual({ valid: true })
    })

    it('rejects a non-backup object', () => {
      const result = validateKeyBackup({ some: 'data' })

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Not a Bridge Practice backup')
    })

    it('rejects a v2.0 backup missing the secret key', () => {
      const backup = {
        bridge_practice_backup: true,
        version: '2.0',
        user_id: 'user-123'
      }

      const result = validateKeyBackup(backup)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('missing secret key')
    })

    it('rejects a v2.0 backup missing user_id', () => {
      const backup = {
        bridge_practice_backup: true,
        version: '2.0',
        secret_key: 'key-data'
      }

      const result = validateKeyBackup(backup)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('missing user ID')
    })

    it('rejects legacy v1.0 backups', () => {
      const backup = {
        bridge_practice_backup: true,
        version: '1.0',
        user_id: 'user-123',
        public_key: 'k',
        private_key: 'k'
      }

      const result = validateKeyBackup(backup)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Legacy backup format')
    })

    it('rejects null/undefined', () => {
      expect(validateKeyBackup(null).valid).toBe(false)
      expect(validateKeyBackup(undefined).valid).toBe(false)
    })
  })

  describe('validateSecretKey', () => {
    it('validates a working secret key', async () => {
      const secretKey = await generateSecretKey()

      const isValid = await validateSecretKey(secretKey)

      expect(isValid).toBe(true)
    })

    it('rejects a garbage key', async () => {
      const isValid = await validateSecretKey('not-a-real-key')

      expect(isValid).toBe(false)
    })
  })
})

/**
 * Cryptography utilities using Web Crypto API
 *
 * New simplified encryption scheme:
 * - Each student has a single AES-256-GCM secret key
 * - All observations encrypted with that one key
 * - Sharing grants: student's secret key RSA-encrypted for viewers
 *
 * No more per-observation key wrapping!
 */

const AES_ALGORITHM = {
  name: 'AES-GCM',
  length: 256
}

const RSA_ALGORITHM = {
  name: 'RSA-OAEP',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]), // 65537
  hash: 'SHA-256'
}

// ============ AES Secret Key Functions ============

/**
 * Generate a new AES-256-GCM secret key for a user
 * This is the user's single encryption key for all their observations
 * @returns {Promise<string>} Base64-encoded raw AES key
 */
export async function generateSecretKey() {
  const key = await crypto.subtle.generateKey(
    AES_ALGORITHM,
    true, // extractable
    ['encrypt', 'decrypt']
  )
  const rawKey = await crypto.subtle.exportKey('raw', key)
  return arrayBufferToBase64(rawKey)
}

/**
 * Import a secret key from base64 string
 * @param {string} secretKeyBase64 - Base64-encoded raw AES key
 * @returns {Promise<CryptoKey>}
 */
export async function importSecretKey(secretKeyBase64) {
  const rawKey = base64ToArrayBuffer(secretKeyBase64)
  return crypto.subtle.importKey(
    'raw',
    rawKey,
    AES_ALGORITHM,
    true,
    ['encrypt', 'decrypt']
  )
}

// ============ Observation Encryption ============

/**
 * Encrypt an observation with the user's secret key
 * Simple AES-256-GCM encryption - no dual-key complexity
 *
 * @param {Object} observation - The observation data to encrypt
 * @param {string} secretKeyBase64 - Base64-encoded AES secret key
 * @returns {Promise<{encrypted_data: string, iv: string}>}
 */
export async function encryptObservation(observation, secretKeyBase64) {
  const secretKey = await importSecretKey(secretKeyBase64)
  const iv = crypto.getRandomValues(new Uint8Array(12)) // 96-bit IV for GCM

  const encoder = new TextEncoder()
  const data = encoder.encode(JSON.stringify(observation))

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    secretKey,
    data
  )

  return {
    encrypted_data: arrayBufferToBase64(ciphertext),
    iv: arrayBufferToBase64(iv)
  }
}

/**
 * Decrypt an observation with the user's secret key
 *
 * @param {string} encryptedData - Base64-encoded ciphertext
 * @param {string} iv - Base64-encoded IV
 * @param {string} secretKeyBase64 - Base64-encoded AES secret key
 * @returns {Promise<Object>} Decrypted observation
 */
export async function decryptObservation(encryptedData, iv, secretKeyBase64) {
  const secretKey = await importSecretKey(secretKeyBase64)
  const ciphertextBuffer = base64ToArrayBuffer(encryptedData)
  const ivBuffer = base64ToArrayBuffer(iv)

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBuffer },
    secretKey,
    ciphertextBuffer
  )

  const decoder = new TextDecoder()
  return JSON.parse(decoder.decode(decrypted))
}

// ============ Sharing Grants (RSA Key Exchange) ============

/**
 * Import an RSA public key from base64 (SPKI format)
 * Used for importing viewer public keys
 * @param {string} publicKeyBase64 - Base64-encoded SPKI public key
 * @returns {Promise<CryptoKey>}
 */
export async function importPublicKey(publicKeyBase64) {
  const keyBuffer = base64ToArrayBuffer(publicKeyBase64)
  return crypto.subtle.importKey(
    'spki',
    keyBuffer,
    RSA_ALGORITHM,
    true,
    ['encrypt']
  )
}

/**
 * Import an RSA private key from base64 (PKCS8 format)
 * Used by viewers to decrypt sharing grants
 * @param {string} privateKeyBase64 - Base64-encoded PKCS8 private key
 * @returns {Promise<CryptoKey>}
 */
export async function importPrivateKey(privateKeyBase64) {
  const keyBuffer = base64ToArrayBuffer(privateKeyBase64)
  return crypto.subtle.importKey(
    'pkcs8',
    keyBuffer,
    RSA_ALGORITHM,
    true,
    ['decrypt']
  )
}

// ============ Request signing (ADR-0003) ============
//
// The viewer keypair is RSA-OAEP (encrypt/decrypt only). To SIGN privileged
// requests we re-import the same PKCS8 private-key bytes under a signing
// algorithm — WebCrypto won't let one CryptoKey both encrypt and sign, but the
// raw key material is fine for either. The matching SPKI public key already in
// `viewers.public_key` verifies these signatures server-side unchanged.

const RSA_SIGNING_ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }

/**
 * Re-import the stored PKCS8 private key for signing (not decryption).
 * @param {string} privateKeyBase64 - Base64-encoded PKCS8 private key
 * @returns {Promise<CryptoKey>}
 */
export async function importSigningKey(privateKeyBase64) {
  const keyBuffer = base64ToArrayBuffer(privateKeyBase64)
  return crypto.subtle.importKey('pkcs8', keyBuffer, RSA_SIGNING_ALGORITHM, false, ['sign'])
}

/**
 * RSASSA-PKCS1-v1_5 / SHA-256 signature over `message` (a string), base64.
 * @param {CryptoKey} signingKey
 * @param {string} message
 * @returns {Promise<string>} base64 signature
 */
export async function signMessage(signingKey, message) {
  const sig = await crypto.subtle.sign(
    RSA_SIGNING_ALGORITHM,
    signingKey,
    new TextEncoder().encode(message)
  )
  return arrayBufferToBase64(sig)
}

/** Lowercase hex SHA-256 of the given bytes (Uint8Array). */
export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Generate an RSA keypair for a viewer (teacher, partner, admin)
 * @returns {Promise<{publicKey: string, privateKey: string}>} Base64-encoded keys
 */
export async function generateViewerKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    RSA_ALGORITHM,
    true,
    ['encrypt', 'decrypt']
  )

  const publicKey = await crypto.subtle.exportKey('spki', keyPair.publicKey)
  const privateKey = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)

  return {
    publicKey: arrayBufferToBase64(publicKey),
    privateKey: arrayBufferToBase64(privateKey)
  }
}

/**
 * Create a sharing grant - encrypts user's secret key for a viewer
 *
 * @param {string} secretKeyBase64 - User's AES secret key
 * @param {string} viewerPublicKeyBase64 - Viewer's RSA public key
 * @returns {Promise<string>} Base64-encoded encrypted payload
 */
export async function createSharingGrant(secretKeyBase64, viewerPublicKeyBase64) {
  const viewerPublicKey = await importPublicKey(viewerPublicKeyBase64)

  // The payload is just the raw AES key bytes
  const secretKeyBuffer = base64ToArrayBuffer(secretKeyBase64)

  // RSA-OAEP encrypt the secret key
  const encrypted = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    viewerPublicKey,
    secretKeyBuffer
  )

  return arrayBufferToBase64(encrypted)
}

/**
 * Decrypt a sharing grant - viewer recovers student's secret key
 *
 * @param {string} encryptedPayload - Base64-encoded encrypted payload
 * @param {string} viewerPrivateKeyBase64 - Viewer's RSA private key
 * @returns {Promise<string>} Base64-encoded AES secret key
 */
export async function decryptSharingGrant(encryptedPayload, viewerPrivateKeyBase64) {
  const viewerPrivateKey = await importPrivateKey(viewerPrivateKeyBase64)
  const encryptedBuffer = base64ToArrayBuffer(encryptedPayload)

  // RSA-OAEP decrypt to recover the secret key
  const secretKeyBuffer = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    viewerPrivateKey,
    encryptedBuffer
  )

  return arrayBufferToBase64(secretKeyBuffer)
}

// ============ Key Backup/Restore ============

/**
 * Create a backup file object for a user's secret key
 * @param {Object} user - User object with id, firstName, lastName, email, secretKey
 * @returns {Object} Backup file data
 */
export function createKeyBackup(user) {
  return {
    bridge_practice_backup: true,
    version: '2.0',
    user_id: user.id,
    name: `${user.firstName} ${user.lastName}`,
    email: user.email,
    secret_key: user.secretKey,
    created: new Date().toISOString().split('T')[0],
    note: 'Keep this file safe. Import it to restore your practice history on a new device.'
  }
}

/**
 * Validate a backup file
 * @param {Object} backup - Parsed backup file data
 * @returns {{valid: boolean, error?: string}}
 */
export function validateKeyBackup(backup) {
  if (!backup || typeof backup !== 'object') {
    return { valid: false, error: 'Invalid backup file format' }
  }

  if (!backup.bridge_practice_backup) {
    return { valid: false, error: 'Not a Bridge Practice backup file' }
  }

  // Support both v1.0 (RSA keys) and v2.0 (AES secret key)
  if (backup.version === '2.0') {
    if (!backup.secret_key) {
      return { valid: false, error: 'Backup file is missing secret key' }
    }
  } else if (backup.version === '1.0' || !backup.version) {
    // Legacy RSA backup - cannot migrate
    return { valid: false, error: 'Legacy backup format (v1.0) is no longer supported. Please re-register.' }
  }

  if (!backup.user_id) {
    return { valid: false, error: 'Backup file is missing user ID' }
  }

  return { valid: true }
}

/**
 * Test if a secret key can encrypt/decrypt correctly
 * @param {string} secretKeyBase64 - Base64-encoded AES key
 * @returns {Promise<boolean>}
 */
export async function validateSecretKey(secretKeyBase64) {
  try {
    const testData = { test: 'validation', timestamp: Date.now() }
    const { encrypted_data, iv } = await encryptObservation(testData, secretKeyBase64)
    const decrypted = await decryptObservation(encrypted_data, iv, secretKeyBase64)
    return decrypted.test === 'validation'
  } catch (err) {
    console.error('Key validation failed:', err)
    return false
  }
}

// ============ Utility Functions ============

/**
 * Convert ArrayBuffer to base64 string
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/**
 * Convert base64 string to ArrayBuffer
 * @param {string} base64
 * @returns {ArrayBuffer}
 */
export function base64ToArrayBuffer(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

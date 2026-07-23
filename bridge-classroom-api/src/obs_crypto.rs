//! AES-256-GCM helpers that match the frontend's observation format exactly
//! (`src/utils/crypto.js`): a **raw** 32-byte key (base64), a 12-byte IV stored
//! as a **separate** field, and the GCM tag **appended** to the ciphertext.
//!
//! This is deliberately distinct from `recovery::encrypt_for_recovery`, which
//! derives its key from a secret (SHA-256) and **prepends** the nonce. Used by
//! the account-merge flow to re-encrypt one user's observations under another
//! user's key, server-side, so the keeper's browser can still decrypt them.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use ring::aead::{self, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN};
use ring::rand::{SecureRandom, SystemRandom};

fn key_from_b64(raw_key_b64: &str) -> Result<LessSafeKey, String> {
    let key_bytes = BASE64
        .decode(raw_key_b64)
        .map_err(|e| format!("Failed to decode key: {}", e))?;
    let unbound = UnboundKey::new(&AES_256_GCM, &key_bytes)
        .map_err(|_| "Invalid AES key (must be 32 bytes)".to_string())?;
    Ok(LessSafeKey::new(unbound))
}

/// Encrypt `plaintext` with a raw base64 AES-256 key, producing the frontend's
/// format: `(encrypted_data = base64(ciphertext||tag), iv = base64(nonce))`.
pub fn encrypt_observation(
    plaintext: &[u8],
    raw_key_b64: &str,
) -> Result<(String, String), String> {
    let key = key_from_b64(raw_key_b64)?;

    let rng = SystemRandom::new();
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rng.fill(&mut nonce_bytes)
        .map_err(|_| "Failed to generate nonce")?;
    let nonce = Nonce::assume_unique_for_key(nonce_bytes);

    let mut in_out = plaintext.to_vec();
    key.seal_in_place_append_tag(nonce, aead::Aad::empty(), &mut in_out)
        .map_err(|e| format!("Encryption failed: {:?}", e))?;

    Ok((BASE64.encode(&in_out), BASE64.encode(nonce_bytes)))
}

/// Decrypt the frontend's observation format back to plaintext bytes.
pub fn decrypt_observation(
    encrypted_data_b64: &str,
    iv_b64: &str,
    raw_key_b64: &str,
) -> Result<Vec<u8>, String> {
    let key = key_from_b64(raw_key_b64)?;

    let nonce_bytes = BASE64
        .decode(iv_b64)
        .map_err(|e| format!("Failed to decode iv: {}", e))?;
    let nonce_array: [u8; NONCE_LEN] = nonce_bytes
        .as_slice()
        .try_into()
        .map_err(|_| "Invalid IV length (expected 12 bytes)".to_string())?;
    let nonce = Nonce::assume_unique_for_key(nonce_array);

    let mut in_out = BASE64
        .decode(encrypted_data_b64)
        .map_err(|e| format!("Failed to decode ciphertext: {}", e))?;
    let plaintext = key
        .open_in_place(nonce, aead::Aad::empty(), &mut in_out)
        .map_err(|e| format!("Decryption failed: {:?}", e))?;

    Ok(plaintext.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    // A freshly generated 32-byte key, base64 (matches generateSecretKey()).
    fn fresh_key() -> String {
        let rng = SystemRandom::new();
        let mut k = [0u8; 32];
        rng.fill(&mut k).unwrap();
        BASE64.encode(k)
    }

    #[test]
    fn round_trips() {
        let key = fresh_key();
        let plaintext = br#"{"deal_subfolder":"Michaels","deal_number":3,"correct":true}"#;
        let (enc, iv) = encrypt_observation(plaintext, &key).unwrap();
        let out = decrypt_observation(&enc, &iv, &key).unwrap();
        assert_eq!(&out, plaintext);
    }

    #[test]
    fn wrong_key_fails() {
        let (enc, iv) = encrypt_observation(b"secret", &fresh_key()).unwrap();
        assert!(decrypt_observation(&enc, &iv, &fresh_key()).is_err());
    }

    #[test]
    fn re_encode_under_new_key() {
        // The merge core: decrypt under K_away, re-encrypt under K_keeper.
        let k_away = fresh_key();
        let k_keeper = fresh_key();
        let plaintext = br#"{"x":1,"y":"two"}"#;
        let (enc, iv) = encrypt_observation(plaintext, &k_away).unwrap();
        let mid = decrypt_observation(&enc, &iv, &k_away).unwrap();
        let (enc2, iv2) = encrypt_observation(&mid, &k_keeper).unwrap();
        let out = decrypt_observation(&enc2, &iv2, &k_keeper).unwrap();
        assert_eq!(&out, plaintext);
    }
}

//! Signed-request authentication for privileged (teacher/admin) endpoints.
//! See ADR-0003. The caller signs a canonical string binding the request
//! (method + path + body hash + timestamp + nonce) with their RSA private key;
//! we verify against their registered `viewers.public_key` (base64 SPKI),
//! enforce freshness, and reject reused nonces. Authorization (role) is looked
//! up on the *verified* identity, never trusted from the request body.

use axum::http::{HeaderMap, StatusCode};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rsa::pkcs1v15::{Signature, VerifyingKey};
use rsa::pkcs8::DecodePublicKey;
use rsa::signature::Verifier;
use rsa::RsaPublicKey;
use sha2::{Digest, Sha256};

use crate::AppState;

/// Accept requests within ±2 minutes of server time (clock skew tolerance).
const FRESHNESS_WINDOW_MS: i64 = 120_000;
/// Canonical-string scheme/version tag, so the format can evolve.
const SCHEME_TAG: &str = "BC1";

/// A caller whose signature verified against their registered public key.
pub struct VerifiedCaller {
    pub user_id: String,
    pub viewer_id: String,
    pub user_role: String,
    pub viewer_role: String,
}

impl VerifiedCaller {
    pub fn is_admin(&self) -> bool {
        self.user_role == "admin" || self.viewer_role == "admin"
    }
}

fn header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|v| v.to_str().ok())
}

fn unauthorized(msg: &str) -> (StatusCode, String) {
    (StatusCode::UNAUTHORIZED, msg.to_string())
}

/// Build the exact string the client signs. Kept in one place so client and
/// server can't drift. `body` is the raw request bytes (empty for no body).
pub fn canonical_string(
    method: &str,
    path: &str,
    body: &[u8],
    timestamp_ms: i64,
    nonce: &str,
) -> String {
    let body_hash = hex::encode(Sha256::digest(body));
    format!("{SCHEME_TAG}\n{method}\n{path}\n{body_hash}\n{timestamp_ms}\n{nonce}")
}

/// Verify a signed request. On success the caller provably controls the private
/// key for their registered `viewers.public_key`, the signature is bound to this
/// exact request, it is fresh, and its nonce has not been used before.
pub async fn verify_signed_request(
    state: &AppState,
    headers: &HeaderMap,
    method: &str,
    path: &str,
    body: &[u8],
) -> Result<VerifiedCaller, (StatusCode, String)> {
    let user_id = header(headers, "x-bc-user").ok_or_else(|| unauthorized("missing x-bc-user"))?;
    let ts_str =
        header(headers, "x-bc-timestamp").ok_or_else(|| unauthorized("missing x-bc-timestamp"))?;
    let nonce = header(headers, "x-bc-nonce").ok_or_else(|| unauthorized("missing x-bc-nonce"))?;
    let sig_b64 =
        header(headers, "x-bc-signature").ok_or_else(|| unauthorized("missing x-bc-signature"))?;

    if nonce.len() < 16 || nonce.len() > 128 {
        return Err(unauthorized("bad nonce"));
    }

    // Freshness window.
    let ts: i64 = ts_str.parse().map_err(|_| unauthorized("bad timestamp"))?;
    let now = chrono::Utc::now().timestamp_millis();
    if (now - ts).abs() > FRESHNESS_WINDOW_MS {
        return Err(unauthorized("request timestamp outside allowed window"));
    }

    // Resolve the caller to a viewer (public key + roles). Users link to viewers
    // by email; a caller with no viewer row has no registered signing key.
    let row: Option<(String, String, String, String)> = sqlx::query_as(
        r#"
        SELECT v.id, v.public_key, v.role AS viewer_role, u.role AS user_role
        FROM viewers v
        JOIN users u ON lower(u.email) = lower(v.email)
        WHERE u.id = ?
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let (viewer_id, public_key_b64, viewer_role, user_role) =
        row.ok_or_else(|| unauthorized("no registered signing key for caller"))?;

    // Verify RSASSA-PKCS1-v1_5 / SHA-256 over the canonical string.
    let canonical = canonical_string(method, path, body, ts, nonce);
    let der = B64
        .decode(public_key_b64.as_bytes())
        .map_err(|_| unauthorized("stored public key not base64"))?;
    let public_key = RsaPublicKey::from_public_key_der(&der)
        .map_err(|_| unauthorized("unparseable stored public key"))?;
    let sig_bytes = B64
        .decode(sig_b64.as_bytes())
        .map_err(|_| unauthorized("signature not base64"))?;
    let signature = Signature::try_from(sig_bytes.as_slice())
        .map_err(|_| unauthorized("malformed signature"))?;
    VerifyingKey::<Sha256>::new(public_key)
        .verify(canonical.as_bytes(), &signature)
        .map_err(|_| unauthorized("signature verification failed"))?;

    // One-time nonce — checked only after the signature is valid, so bogus
    // requests can't pollute the table. Prune expired rows, then insert; a
    // primary-key collision is a replay.
    let expires_at = now + FRESHNESS_WINDOW_MS;
    sqlx::query("DELETE FROM used_nonces WHERE expires_at < ?")
        .bind(now)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let inserted =
        sqlx::query("INSERT OR IGNORE INTO used_nonces (nonce, expires_at) VALUES (?, ?)")
            .bind(nonce)
            .bind(expires_at)
            .execute(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if inserted.rows_affected() == 0 {
        return Err(unauthorized("nonce already used (replay)"));
    }

    Ok(VerifiedCaller {
        user_id: user_id.to_string(),
        viewer_id,
        user_role,
        viewer_role,
    })
}

/// Require a valid signed request whose signer is an admin.
pub async fn require_admin_signed(
    state: &AppState,
    headers: &HeaderMap,
    method: &str,
    path: &str,
    body: &[u8],
) -> Result<VerifiedCaller, (StatusCode, String)> {
    let caller = verify_signed_request(state, headers, method, path, body).await?;
    if !caller.is_admin() {
        return Err((StatusCode::FORBIDDEN, "admin role required".to_string()));
    }
    Ok(caller)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_is_stable_and_binds_fields() {
        let a = canonical_string(
            "POST",
            "/api/admin/x",
            b"",
            1_700_000_000_000,
            "nonce123456789012",
        );
        // Same inputs → same string.
        assert_eq!(
            a,
            canonical_string(
                "POST",
                "/api/admin/x",
                b"",
                1_700_000_000_000,
                "nonce123456789012"
            )
        );
        // Empty-body hash is the well-known SHA-256("").
        assert!(a.contains("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"));
        // Different method/path/body/nonce → different string.
        assert_ne!(
            a,
            canonical_string(
                "GET",
                "/api/admin/x",
                b"",
                1_700_000_000_000,
                "nonce123456789012"
            )
        );
        assert_ne!(
            a,
            canonical_string(
                "POST",
                "/api/admin/y",
                b"",
                1_700_000_000_000,
                "nonce123456789012"
            )
        );
        assert_ne!(
            a,
            canonical_string(
                "POST",
                "/api/admin/x",
                b"{}",
                1_700_000_000_000,
                "nonce123456789012"
            )
        );
    }

    /// Cross-stack proof: a signature produced by WebCrypto (RSA-OAEP key
    /// material re-imported under RSASSA-PKCS1-v1_5) verifies through the same
    /// `rsa` path the server uses. Fixture generated by scratchpad
    /// `gen_sig_fixture.mjs`; point `BC_SIG_FIXTURE` at its JSON to run.
    #[test]
    fn webcrypto_signature_verifies() {
        let Ok(path) = std::env::var("BC_SIG_FIXTURE") else {
            eprintln!("skipping: set BC_SIG_FIXTURE to the fixture json");
            return;
        };
        let raw = std::fs::read_to_string(path).expect("read fixture");
        let f: serde_json::Value = serde_json::from_str(&raw).expect("parse fixture");
        let spki = B64.decode(f["spki"].as_str().unwrap()).unwrap();
        let sig = B64.decode(f["sig"].as_str().unwrap()).unwrap();
        let canonical = canonical_string(
            f["method"].as_str().unwrap(),
            f["path"].as_str().unwrap(),
            b"",
            f["ts"].as_i64().unwrap(),
            f["nonce"].as_str().unwrap(),
        );
        let pk = RsaPublicKey::from_public_key_der(&spki).expect("parse SPKI");
        let signature = Signature::try_from(sig.as_slice()).expect("parse sig");
        VerifyingKey::<Sha256>::new(pk)
            .verify(canonical.as_bytes(), &signature)
            .expect("WebCrypto signature must verify");

        // A tampered canonical (different path) must NOT verify.
        let bad = canonical_string(
            f["method"].as_str().unwrap(),
            "/api/admin/evil",
            b"",
            f["ts"].as_i64().unwrap(),
            f["nonce"].as_str().unwrap(),
        );
        let pk2 = RsaPublicKey::from_public_key_der(&spki).unwrap();
        assert!(VerifyingKey::<Sha256>::new(pk2)
            .verify(bad.as_bytes(), &signature)
            .is_err());
    }
}

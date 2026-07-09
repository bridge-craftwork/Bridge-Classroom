# ADR-0003: Signed-request authentication for privileged (teacher/admin) endpoints

**Status:** Accepted (2026-07-09)
**Date:** 2026-07-08 (accepted 2026-07-09)
**Deciders:** Rick (Bridge Classroom)

**Decisions locked at acceptance:** (1) signature scheme is **`RSASSA-PKCS1-v1_5` / SHA-256**. (2) The interim `ADMIN_SECRET` **code gate is removed** once signing works, but its **secret value is retained** (left provisioned in the plist, dormant) so the gate can be re-enabled without re-provisioning if we ever need to fall back.

**Scope note:** This ADR defines a **general** request-signing layer intended for *all* teacher-scoped endpoints. The **first rollout** wires it only to the three privileged admin ops (`decrypt-observations`, `backfill-active-time`, `merge-accounts`); the remaining teacher endpoints migrate later. It supersedes the interim `ADMIN_SECRET` shared-header gate for those three (see [Reconciliation](#reconciliation-with-admin_secret)).

## Context

Every server endpoint today is authenticated only by the shared `VITE_API_KEY`, which is **baked into the frontend bundle and is not secret** (it only filters casual misuse — see CLAUDE.md "API Security Notes"). This is inadequate for two growing needs:

1. **Privileged admin operations.** `decrypt-observations` and `backfill-active-time` mass-decrypt every E2E-encrypted observation using `RECOVERY_SECRET`; `merge-accounts` irreversibly merges user data. Behind only the public key, anyone who reads the bundle can trigger them. We shipped an interim `ADMIN_SECRET` header (ADR-less, 2026-07-08) that fails closed, but a shared secret is coarse: not per-user, not auditable, not revocable, and it forced us to **remove the in-app "Decrypt" button** (a browser can't hold a server secret) and would have forced an awkward secret-entry field onto the merge dialog.

2. **Per-teacher authorization generally.** `GET /api/users` returns all users to any caller with the API key; teacher/viewer endpoints scope data by grants but authenticate weakly. CLAUDE.md already records the intended direction: *"Replace shared API key auth with RSA-signed requests for teacher/viewer endpoints. Teachers sign requests with their existing RSA private key; backend verifies against stored public key."* This ADR makes that concrete.

Teachers **already have an asymmetric keypair** used for the E2E sharing/grants system, and we can reuse its **key material** — adding **no new key to store or register and no new secret over the wire**. The existing facts (verified against the code):

- The keypair is **`RSA-OAEP`, 2048-bit, SHA-256**, generated in [`crypto.js` `generateViewerKeyPair`](../../src/utils/crypto.js) with usages `['encrypt','decrypt']` — it is used **only** to wrap/unwrap the student AES key for sharing grants. **Nothing signs anything today** (no `crypto.subtle.sign`/`verify` on the client; no RSA verify on the server). Signing is therefore a **genuinely new capability**, not an extension of an existing call.
- WebCrypto forbids using one `CryptoKey` for both OAEP-encrypt and PKCS1/PSS-sign. But the keys are stored as **raw exported bytes** (private = base64 **PKCS8**; public = base64 **SPKI**), so we can **re-import the same bytes under a signing algorithm** (`RSASSA-PKCS1-v1_5`/SHA-256) with `['sign']` / `['verify']`. An RSA SPKI public key carries the generic `rsaEncryption` identifier, so the **already-stored public key verifies signatures unchanged** — no re-registration, no second keypair.
- Per-teacher public keys already live server-side in the **`viewers` table** (`public_key`, base64 SPKI; `role` in `viewers.role`), keyed by viewer id and linked to a user by `email`. (The `teacher_public_key` in server config is **vestigial** — loaded but read by nothing.) So "verify against the caller's registered public key" needs **no new storage**.
- The private key is on the device as base64 PKCS8 in localStorage (`viewerPrivateKey`) and an 8-hour `sessionStorage` (`bridgeTeacherSession`); [`useTeacherRole.getTeacherPrivateKey()`](../../src/composables/useTeacherRole.js) already returns it. Today it only decrypts grants.
- The backend has **no RSA-verify capability** — crypto deps are `ring` (AEAD/HMAC/constant_time), `sha2`, `base64`, `hex`. Adding verification means adding the **`rsa` + `spki`/`pkcs8` crates** (ergonomic for the base64-SPKI we store; `ring`'s RSA verify wants raw modulus/exponent and is a worse fit).
- Precedent to mirror: [`table_tickets.rs`](../../bridge-classroom-api/src/routes/table_tickets.rs) already does `base64url(payload_json).base64url(sig)` with an `exp` and **role taken from the DB, not the request body** — the same conventions apply here (it's HMAC/symmetric and verified off-box; ours is RSA/asymmetric and verified in-box).

## Decision

**Authenticate privileged requests with a per-request digital signature over a canonical challenge, verified against the caller's registered public key; authorize separately by the caller's stored `role`.**

### 1. Sign the request, not just a timestamp

The client signs a **canonical string that binds the signature to the specific request**:

```
BC1\n
<HTTP-METHOD>\n
<request-path>\n
<sha256(body) as lowercase hex, or empty-string hash for no body>\n
<unix-millis timestamp>\n
<nonce (base64url, >=16 random bytes)>
```

- `BC1` is a scheme/version tag so the format can evolve.
- Binding **method + path + body-hash** prevents a signature captured for a harmless request (e.g. a `GET`) from being replayed against a destructive one (`backfill-active-time`). This is the property a bare signed timestamp lacks.

The signature and its metadata travel in headers (not the body), e.g.:

```
x-bc-user:      <user_id>
x-bc-timestamp: <unix-millis>
x-bc-nonce:     <base64url nonce>
x-bc-signature: <base64 signature>
```

It is a **digital signature** (private-key `sign`, public-key `verify`) — *not* "encryption with the private key". Because the existing keypair is OAEP-only, the client **re-imports the stored PKCS8 private-key bytes** under `{name:'RSASSA-PKCS1-v1_5', hash:'SHA-256'}` with `['sign']`, then `crypto.subtle.sign(...)` over the canonical bytes. The server verifies with the caller's **already-stored SPKI public key** re-parsed under the same scheme. (`RSASSA-PKCS1-v1_5` chosen for cross-stack simplicity — deterministic, no salt, first-class in both WebCrypto and the `rsa` crate; `RSA-PSS`/SHA-256 is an acceptable alternative if we prefer PSS, at the cost of salt handling on both ends.)

### 2. Server verification (authN) — `verify_signed_request`

A reusable extractor/guard that, in order:

1. Resolves the caller to a **viewer** (by `x-bc-user` → the linked `viewers` row, via id or `users.email → viewers.email`) and loads `viewers.public_key` (base64 SPKI); rejects if there is no registered public key.
2. Reconstructs the canonical string from the actual request (method, path, `sha256(body)`), the header timestamp, and nonce.
3. **Verifies the signature** against the public key. Reject on failure.
4. **Freshness:** rejects if `|now - timestamp|` exceeds a small skew window (**±120 s**).
5. **One-time use:** rejects if the nonce has been seen; otherwise records `(nonce, expiry)` in a `used_nonces` table and prunes expired rows. This closes the replay window that freshness alone leaves open.

Returns a `VerifiedCaller { user_id, role }` on success.

### 3. Authorization (authZ) is separate

Endpoints declare the role they need. `require_admin_signed` = `verify_signed_request` **then** assert the **verified signer's** role is `admin` (from `viewers.role` / `users.role`, keyed on the cryptographically-established identity — never a role field in the request body). Teacher endpoints will assert `role in ('teacher','admin')` and further scope by grants as today. This is the exact gap in today's code, where role is `SELECT`ed on a **caller-supplied, unproven** `user_id`.

### 4. Reusable on both ends

- **Backend:** one verifier module (`auth_sig`) exposing `verify_signed_request(...)` and thin `require_admin_signed` / `require_teacher_signed` wrappers, usable by any handler.
- **Frontend:** one `signedFetch(method, path, body?)` helper that builds the canonical string, signs with the current user's private key, sets the headers, and calls `fetch`. Any teacher/admin call becomes a one-line swap from `fetch`.

Because signing happens **client-side at click-time with a key already on the device**, privileged actions can live in the UI again with **nothing secret in the bundle** — restoring the removed Decrypt button and keeping Merge in-app.

### 5. First rollout: the three admin ops

`decrypt-observations`, `backfill-active-time`, `merge-accounts` switch from `ADMIN_SECRET` / public-key to `require_admin_signed`. Their UI buttons use `signedFetch`. All other endpoints keep the API key for now and migrate incrementally.

## Alternatives considered and rejected

- **Keep the shared `ADMIN_SECRET` header.** Simple and already shipped, but not per-user, not auditable, not revocable; the secret transits on every call; and it can't live in the browser, so privileged UI has to be removed or bolted with a manual secret field. Kept only as an optional break-glass (below).
- **Bearer token / JWT session after a login.** Workable, but introduces a token-issuance/refresh/expiry/revocation surface and a signing secret to manage. The keypair already exists and needs none of that; signing per request is stateless apart from the small nonce table.
- **Sign only a timestamp.** The naive version of this scheme. Replayable within the freshness window and — worse — a signature is reusable across *different* requests. Rejected in favor of binding method+path+body and a one-time nonce.
- **Generate a second, dedicated signing keypair** (instead of re-importing the OAEP key material under a signing algorithm). Cleaner key hygiene (separate keys for separate purposes), but it means new key generation, a new public-key column/registration, and a migration for existing teachers. Rejected for the first rollout in favor of re-importing the existing PKCS8/SPKI material — zero new storage or registration. Worth revisiting if we ever want to rotate signing keys independently of encryption keys.
- **mTLS / client certificates.** Strong, but heavyweight to provision to non-technical teachers in a browser and redundant with the existing keypair.
- **Session cookies + server-side sessions.** Adds server session state and CSRF surface; doesn't leverage the existing keys.

## Consequences

**Positive**
- Per-user, auditable (we know *which* admin acted), revocable (drop the role or the public key).
- No shared secret in the bundle or on the wire; private key never leaves the device.
- Reuses existing key material; no new secret to distribute or rotate.
- Privileged UI can return to the app.
- A single layer that the whole teacher surface can adopt, closing the `GET /api/users`-style gaps over time.

**Negative / costs**
- New moving parts: a client `signedFetch`, a server verifier, and a `used_nonces` table with pruning.
- **Backend gains an RSA dependency** (`rsa` + `spki`/`pkcs8`) — the first asymmetric-verify in this service (today it's `ring` AEAD/HMAC only).
- **Client must re-import** the stored PKCS8 bytes under a signing algorithm (the existing `CryptoKey` is OAEP-only and can't sign); a small helper in `crypto.js`.
- Clock-skew sensitivity (mitigated by the ±120 s window; clients should use server-time hints if skew proves a problem).
- Body signing requires the exact request bytes on both ends (stable JSON serialization / hash of the raw body).
- Depends on the teacher having completed viewer registration (so `viewers.public_key` exists) — students-only accounts can't be admins anyway, so this is not a new constraint for the admin rollout.

**Security invariants**
- Always over TLS (Cloudflare edge terminates; origin is the tunnel).
- Fail **closed**: unknown user, bad signature, stale timestamp, or reused nonce → 401; missing public-key infrastructure → 503.
- Signature scheme and hash must match the teacher keypair exactly (open item (a)).

## Reconciliation with `ADMIN_SECRET`

The `ADMIN_SECRET` gate (interim, 2026-07-08) is **replaced** by `require_admin_signed` on the three ops endpoints once this lands. **Decision:** the `require_admin` / `ADMIN_SECRET` **code path is removed** when signing works, but the **secret value stays provisioned** in the plist (dormant, unreferenced by code). Rationale: keep the material so the gate can be reinstated without re-minting a secret if we ever need to reimplement or fall back. The `config.admin_secret` field may remain loaded (harmless) to keep the value first-class; nothing reads it once the gate is gone.

## Rollout

1. Public-key registration already exists (`viewers.public_key`) — no prerequisite work.
2. Add the client signing helper (`crypto.js`: re-import PKCS8 under `RSASSA-PKCS1-v1_5`, `signCanonical`) and `signedFetch`.
3. Add the backend `rsa`/`spki` dep, the `auth_sig` verifier, `require_admin_signed`, and the `used_nonces` table + pruning.
4. Convert the three admin ops to `require_admin_signed`; restore their UI buttons via `signedFetch`.
5. Migrate remaining teacher endpoints endpoint-by-endpoint; tighten `GET /api/users` etc.
6. Retire or break-glass-gate `ADMIN_SECRET`.

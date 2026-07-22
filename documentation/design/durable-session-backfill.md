# Durable-session backfill for already-logged-in devices (ADR-0004 Phase 3b)

**Status:** spec / not implemented
**Depends on:** ADR-0004 (durable device-session cookie), Phase 3a (silent restore +
`/api/session/key` key rehydration), ADR-0003 (signed requests — reused conceptually).

## Problem

The `__Host-bc_session` cookie is minted **only at a fresh recovery-claim**
(`/api/recovery/claim` / `claim-code` → `mint_cookie_header` →
`join_or_create_session`). Ordinary use — a user already logged in from
localStorage, syncing practice — **never** mints a cookie (by design:
`create_user` and per-sync are deliberately *not* mint points, see
`durable-sessions-plan.md` §Phase 1).

Consequence: every user who logged in **before** the feature (or on any
device/browser that hasn't re-claimed since 2026-07-11) has **no durable-session
cookie**. They ride on localStorage alone. When Safari's ITP wipes localStorage
after ~7 idle days, there's nothing to silently restore from → they're bounced
back to the magic-link email — the exact pain ADR-0004 exists to remove.

Real-world exposure: Chrome has no ITP purge, so Chrome users are unaffected. But
**Safari-on-iPad students** (a real segment) are exposed: an already-logged-in
teaching/student iPad that sits idle over a break loses the session with no
cookie fallback. (Confirmed 2026-07-21: a teaching iPad logged in as a student
via legacy localStorage had **zero** session rows — syncing never minted one.)

## Goal

On a device that is **already authenticated via localStorage** but has **no valid
session cookie**, silently mint (or join) a durable device-session — **with no
magic-link email and no user-visible prompt** — proving identity from the key
material the browser already holds.

**Non-goals:** new-device onboarding (email recovery stays the fallback); users
with no recovery escrow (see edge cases); changing the recovery-claim mint path.

## Security model — why this is safe

Minting a cookie for user X is as powerful as recovery: the cookie lets the
holder pull X's escrowed key via `/api/session/key`. So the backfill's proof must
be **as strong as recovery**.

The key insight that makes it safe *and* frictionless: **we only mint for a
client that proves it already possesses X's key material.** A client holding X's
`secretKey` is *already* fully authorized — it can already decrypt all of X's
data. Persisting that access as a durable cookie therefore grants **no new
capability**; it just makes the already-proven access survive an ITP purge. So a
possession proof over the existing key is both sufficient and non-escalating.

The shared `x-api-key` (baked into the bundle, **not secret**) is *not* sufficient
on its own — the possession proof is what gates minting. An attacker who knows a
`user_id` + the API key but lacks the key cannot pass the challenge.

## Proof mechanism — two paths by key material

The client already holds everything needed to prove identity; the proof differs
by what the logged-in user has in localStorage (single `bridgePractice` blob):

- **Teacher / viewer → `viewerPrivateKey` (RSA):** Path A, an ADR-0003 signed
  request. Cleanest — one round-trip, no escrow decrypt, reuses the built-and-
  audited `verify_signed_request` (which already returns `user_id`).
- **Student → `secretKey` only (AES):** Path B, an AES challenge–response.

The frontend picks: if the local user record has a `viewerPrivateKey`, use Path A;
else Path B. (Teachers have a `secretKey` too, so Path B would also work for them,
but Path A is strictly simpler and avoids decrypting their escrow server-side.)

### Path A — teacher/viewer, ADR-0003 signed request (single POST)

`POST /api/session/attach` signed per ADR-0003: the client signs the canonical
`(method,path,body-hash,timestamp,nonce)` with `viewerPrivateKey` and sends
`x-bc-timestamp` / `x-bc-nonce` / `x-bc-signature`. The server calls
`verify_signed_request` → on success it **provably controls the registered
`viewers.public_key`**, and `VerifiedCaller.user_id` is the user to mint for →
`join_or_create_session(user_id)` → `Set-Cookie`. No challenge step, no escrow
touch, freshness + nonce-replay already enforced by ADR-0003.

### Path B — student, AES `secretKey` challenge–response

Every user holds an AES-256 `secretKey`; **136/140** have a server-side escrow
(`users.recovery_encrypted_key`, decryptable with `RECOVERY_SECRET` via
`decrypt_for_recovery`). No new client crypto: the challenge is decrypted with the
existing `crypto.js::decryptObservation` path.

#### Flow

```
Client (localStorage: user_id + secretKey, but GET /api/session → {authenticated:false})
  │
  │ 1. POST /api/session/attach/challenge  { user_id }        [x-api-key]
  ▼
Server
  • load users.recovery_encrypted_key; if absent → 409 not_attachable
  • secretKey = decrypt_for_recovery(escrow, RECOVERY_SECRET)   (transient, never stored)
  • nonce = 32 random bytes; challenge_id = random
  • {encrypted_data, iv} = AES-256-GCM(nonce, secretKey)        (crypto.js-compatible)
  • stash challenge_id → {user_id, nonce, Instant} (in-mem, ~120s TTL, single-use)
  • → { challenge_id, encrypted_data, iv }
  │
  │ 2. nonce' = decryptObservation(encrypted_data, iv, secretKey)   (client-side)
  │    (can only succeed if the browser truly holds X's key)
  │
  │ 3. POST /api/session/attach/claim  { challenge_id, nonce: base64(nonce') }   [x-api-key]
  ▼
Server
  • look up challenge_id; reject if missing/expired/used; consume it
  • constant-time compare nonce' == stored nonce  → proven possession
  • token = join_or_create_session(user_id)   (create device session, OR join
    existing roster if a cookie is already present — same multi-user path as claim)
  • Set-Cookie: __Host-bc_session=…  (via mint_cookie_header)
  • audit-log attach{user_id, ip, ua}
  • → 200 { attached: true }   (204 if already had a session)
```

Server transiently decrypts the escrow to build the challenge — the same
capability recovery and `/api/session/key` already use (`RECOVERY_SECRET`); the
plaintext key is never persisted or returned.

## Endpoints

- **Path A** — `POST /api/session/attach` — ADR-0003 **signed** request (no body
  needed beyond the signed envelope). `verify_signed_request` → mint for
  `VerifiedCaller.user_id` → `Set-Cookie`; `200 { attached: true }`. `401` if the
  signature/freshness/nonce checks fail.
- **Path B** — `POST /api/session/attach/challenge` — body `{ user_id }`; returns
  `{ challenge_id, encrypted_data, iv }` or `409 { error: "not_attachable" }` when
  the user has no escrow. Then `POST /api/session/attach/claim` — body
  `{ challenge_id, nonce }` → mint + `Set-Cookie`; `200 { attached: true }`; `401`
  on bad/expired/used challenge or nonce mismatch. `x-api-key` only (casual filter).

Path B's challenge store + both paths' rate limits reuse the existing in-memory
limiter pattern (`LazyLock<Mutex<HashMap<_, (Instant, u32)>>>`, cf.
`allow_key_redelivery`).

## Frontend flow (slots into the Phase 3 load sequence)

In the load path (`apiFetch('/session')` before the localStorage/recovery
fallback), after the existing silent-restore check:

```
const s = await getSession()                 // GET /api/session
if (s.authenticated) return restore(s)        // Phase 3a — already have a cookie
if (hasLocalLogin()) {                         // localStorage has a logged-in user
  for (const u of localRosterNewestActiveFirst()) {   // active user first
    if (u.viewerPrivateKey) {                          // Path A — teacher/viewer
      await signedAttach(u)                            // ADR-0003 signed POST /attach → Set-Cookie
    } else if (u.secretKey) {                          // Path B — student
      const ch = await attachChallenge(u.user_id)      // POST …/attach/challenge
      if (!ch) continue                                 // no escrow → skip (email fallback later)
      const nonce = await decryptObservation(ch.encrypted_data, ch.iv, u.secretKey)
      await attachClaim(ch.challenge_id, nonce)         // POST …/attach/claim → Set-Cookie
    }
  }
}
// else: brand-new device → existing email-recovery onboarding
```

- **Idempotent / self-limiting:** once the first attach sets the cookie, the next
  load's `GET /api/session` returns `authenticated:true` and this branch is
  skipped forever on that device.
- **Multi-user devices (Switch User):** attach the **active** user first (creates
  the session), then loop the remaining localStorage users — each `attach/claim`
  **joins the same device-session roster** (`join_or_create_session` adds to the
  existing session when a cookie is present). Result: the whole on-device roster
  is backfilled into one device session, matching the claim-time model.
- **Best-effort:** any failure (no escrow, decrypt fails, network) is silent — the
  user stays on legacy localStorage auth; email recovery remains the ultimate
  fallback if/when localStorage is later lost. Never blocks app start.

## Security considerations

- **Non-escalation:** mints only on proof of current key possession → no new
  capability granted (see model above).
- **No key transmission:** challenge–response; `secretKey` never leaves the
  client; server uses the escrow transiently, same as recovery.
- **Replay / brute force:** single-use `challenge_id`, ~120s TTL, constant-time
  nonce compare, 256-bit nonce, per-`user_id` + per-IP rate limit. Guessing the
  nonce without the key is infeasible; a stolen challenge ciphertext is useless
  without the key.
- **API key not load-bearing:** possession proof is the gate; the bundle-baked
  `x-api-key` only filters casual traffic.
- **Audit:** log every successful attach (user_id, ip, ua), mirroring recovery.
- **CSRF:** same posture as the rest of ADR-0004 — `SameSite=Lax` + CORS-pinned
  origins; the attach POSTs are state-changing, so confirm the ADR-0004 CSRF
  open-item decision applies here too.

## Edge cases

- **No escrow (4/140 users):** `challenge` → 409; client skips silently. These
  predate recovery; they fall back to email recovery on localStorage loss.
  Acceptable — document, don't special-case.
- **Stale/wrong localStorage key:** challenge decrypt fails → no mint. Safe.
- **Chrome / non-ITP users:** they get backfilled too (harmless, mildly
  beneficial — durable cookie survives a manual storage clear).
- **Key rotation:** if a user's `secretKey` ever rotates, the escrow must be
  current for the challenge to match; out of scope (no rotation today).

## Testing / acceptance

- Unit: challenge encrypt (server) ↔ `decryptObservation` (client) round-trip;
  nonce mismatch → 401; expired/used challenge → 401; no-escrow → 409.
- Integration: from a state with localStorage login but **no** cookie, one load
  cycle results in a valid `__Host-bc_session` and `GET /api/session` →
  `authenticated:true` with the full on-device roster; no email sent.
- **Path A functional test — the teaching iPad (Chrome, teacher login):** it's
  logged in via legacy localStorage with a `viewerPrivateKey` and no cookie, on a
  non-ITP browser — so it's a stable, repeatable Path A subject (Chrome won't drop
  the state between runs). Open the app once → a signed `POST /api/session/attach`
  mints the cookie → `GET /api/session` returns `authenticated:true` for the
  teacher; no email. (Keep this device un-claimed until the backfill ships so it
  stays a clean test case.)
- Path B / real-Safari ITP survival is covered separately by the newer Safari
  iPad once it's signed in. See [[project_durable_session_safari_test]].

## Rollout

Backend-first (add the two endpoints; inert with no caller), soak, then ship the
frontend load hook — same safe ordering as Phases 2→3. No migration/backfill job
needed: the mint happens lazily on each device's next visit.

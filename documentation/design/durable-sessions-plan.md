# Durable sessions — implementation plan (#85 + the #33 overlap)

Companion to [ADR-0004](../adr/0004-durable-session-cookie.md). The ADR records the
*decision*; this is the *phased build plan* and the current-state audit it rests on.

## Verified current state (2026-07-10, `lane2` off `main`)

The private review `SECURITY-AND-CODE-REVIEW.md` is a 2026-07-01 snapshot; the actual
tree has moved. Confirmed by reading the code:

**Already shipped from #33 / the review:**
- **§S1** — `create_user` requires the API key **and** refuses to change an existing
  account's email ([users.rs](../../bridge-classroom-api/src/routes/users.rs) — the
  takeover primitive is dead).
- **§S3** — `create_viewer` / `create_grant` / `revoke_grant` require the API key.
- **§S4** — recovery no longer logs code/token/URL (only a break-glass `println!` on
  email-send failure); token claim is atomic; per-email + per-IP rate limiting is
  live. De-enumeration was **deliberately not done** (dual-purpose with registration
  messaging — product decision).
- **ADR-0003** signed-request auth exists ([signedRequest.js](../../src/utils/signedRequest.js),
  [auth_sig.rs](../../bridge-classroom-api/src/auth_sig.rs)) and guards the privileged
  admin ops (decrypt-observations / backfill / merge).

**Still open (relevant to this plan):**
- **§S5** — [`get_user`](../../bridge-classroom-api/src/routes/users.rs) still returns
  the **decrypted teacher `viewer_private_key`** to any api-key holder. Not fixed.
- **§S8** — [`build_cors_layer`](../../bridge-classroom-api/src/main.rs) still falls
  open to `allow_origin(Any)` when `ALLOWED_ORIGINS` is empty/`*`.
- **§S6/§S7** — `GET /api/users` still lists everyone; id-keyed routes still trust
  client-supplied ids (no ownership checks). The review's "big one."
- **Frontend fetch is not centralized** — ~25 composables hand-roll `fetch` +
  `x-api-key`; no `apiFetch()` wrapper.
- **apiUrl.js** already does the `.org`/`.com` same-site API routing the cookie
  depends on. ✅

## Phases

Ordered so the two no-regret prerequisites can start immediately and independently,
and the one lockstep coupling (CORS ↔ credentials) is isolated to a single phase.

### Phase 0 — No-regret prerequisites (independent, start anytime)

**0a. Fix §S5** — stop [`get_user`](../../bridge-classroom-api/src/routes/users.rs)
returning `viewer_private_key`. The device that owns the key already has it locally;
a read endpoint must never emit private-key material. Standalone, cheap, and it clears
the way for the identity-only restore decision (ADR-0004 §3) — the cookie deliberately
does **not** become a new key-delivery channel, so this pattern must not exist.

**0b. Central `apiFetch()` wrapper** — one helper in `src/utils/` owning base URL,
`x-api-key`, error handling, and (from Phase 3) `credentials:'include'`. Migrate the
~25 composables to it. Prerequisite for Phase 3 *and* pays down review §A1's copy-paste
fetch problem. No behavior change on landing.

### Phase 1 — Backend session layer

- `sessions` table: `id` (cookie value), `user_id`, `created_at`, `expires_at`,
  `revoked_at`, device/platform columns; created in `db.rs` migrations.
- Set `__Host-bc_session` (`HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=<long>`,
  host-only) on successful `auth` and recovery-claim.
- `GET /api/session` — active user + full identity roster for this browser.
- `DELETE /api/session` — revoke / sign-out.
- A `require_session` extractor returning a verified `user_id` (mirrors ADR-0003's
  `verify_signed_request` shape, but keyed on the opaque cookie, not a signature).

### Phase 2 — CORS + credentials flip (the one lockstep deploy)

- [`build_cors_layer`](../../bridge-classroom-api/src/main.rs): pin the two real
  origins + `allow_credentials(true)`; drop the `Any` fallback in prod. **Closes §S8.**
- Frontend: `apiFetch` sends `credentials:'include'`.
- **Must ship together** — a half-deploy breaks same-origin dev and both prod domains.
  This is the highest-coordination step; treat it as one atomic release.

### Phase 3 — Frontend session adoption

- On load, `apiFetch('/session')` **before** the localStorage/recovery fallback; an
  emailed `.org` link now recognizes the user automatically in Safari.
- Reconcile with `Switch User`: cookie tracks the *active* user; `/session` returns the
  roster (ADR-0004 caveat 1).
- CSRF: rely on `SameSite=Lax` + CORS-pinned state-changing calls; confirm before
  shipping whether an explicit token is warranted (ADR-0004 open item).
- **Identity only** — do **not** attempt to rehydrate E2E keys here; past-data
  decryption stays the recovery flow's job (ADR-0004 §3).

### Phase 4 — Cash in proven identity for §S7 (the #33 payoff)

With a server-verified `user_id` on every request, add ownership checks to the
id-keyed routes the review lists: `remove_member`, `delete_assignment`,
`leave_classroom`, `clear_dashboard_panel`, and the read rosters (`get_assignment`,
`get_classroom`, dashboards, board/assignment status). Scope `GET /api/users` (§S6) to
the caller's grants. This is the review's "big one," now tractable because identity is
proven rather than asserted. Sequence the routes worst-first (destructive writes before
reads).

### Deferred (tracked, not in this plan)

- **Native iOS app** (ADR-0004 Option B) — WKWebView wrapper + associated-domains for
  Universal Links; longer-term mobile upgrade. Cookie work is not wasted if it ships.
- **Guest IndexedDB history** — local-only, cookie-free, capped quota (only the cap
  number is open). Stays a separate track by design (register = durability carrot).

## Dependency sketch

```
0a §S5 fix ─────────────────────────┐ (independent; unblocks identity-only stance)
0b apiFetch wrapper ────────┐        │
                            ▼        │
Phase 1 backend session ──► Phase 2 CORS+credentials (LOCKSTEP) ──► Phase 3 frontend
                                                                         │
                                                                         ▼
                                                              Phase 4 §S7 ownership
```

## Isolation note

`main` is doing GUI layout work; this is backend + fetch-layer + session work with no
template overlap, so it lives cleanly on a separate lane. The only shared-file risk is
`apiUrl.js`/composables during Phase 0b — coordinate that migration as one commit.

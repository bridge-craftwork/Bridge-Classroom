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
and the CORS change ships backend-first (backward-compatible), with the frontend's
`credentials:'include'` following safely in a later phase — no coordinated deploy.

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

### Phase 1 — Backend session layer ✅ DONE (`feat/phase1-backend-sessions`)

- `sessions` table: `id` = **sha256(token)** (raw token only in the cookie),
  `user_id`, `created_at`, `expires_at`, `revoked_at`, device columns; in `db.rs`.
- Sets `__Host-bc_session` (`HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=180d`,
  host-only) on **recovery-claim** success. `create_user` is deliberately not a
  mint point (per-sync upsert); new-registration minting moves to Phase 3.
- `GET /api/session` — active user, **identity only** (no key material). The
  Switch-User roster is reconciled client-side (ADR-0004 caveat 1), not server-
  enumerated.
- `DELETE /api/session` — revoke + clear cookie.
- `require_session(state, headers) -> Result<user_id>` helper (plain fn, matching
  the codebase's `validate_api_key` style) — the proven id Phase 4 authorizes on.
- `cookie_secure` config (`COOKIE_SECURE`, default true) for plain-http dev.
- **Inert until Phase 3** (cookie is set, but doesn't round-trip cross-origin until
  Phase 2's CORS `allow_credentials` **and** Phase 3's frontend `credentials:'include'`
  both land). Verified e2e on an isolated instance + unit tests.

### Phase 2 — CORS hardening (backend-first, backward-compatible)

- [`build_cors_layer`](../../bridge-classroom-api/src/main.rs): pin the real origins +
  `allow_credentials(true)`; drop the `Any` fallback in prod. **Closes §S8.**
- **Not a lockstep deploy.** `allow_credentials(true)` is invisible to the current
  non-credentialed frontend (a request that sends no credentials only needs its Origin
  reflected, which pinning does). So this ships **backend-first and soaks** on its own;
  the frontend's `credentials:'include'` comes later, in Phase 3. The only unsafe order
  is frontend-first (a credentialed request forbids `Access-Control-Allow-Origin: *`).
- **Real risk = pin-list completeness, not timing.** The pins must cover *every* real
  origin — both prod domains **and** dev `:5173` + lane2's `:5174` — since leaving `Any`
  breaks any un-pinned origin immediately, even without credentials.

### Phase 3 — Frontend session adoption (incl. `credentials:'include'` + key redelivery)

- `apiFetch` sends `credentials:'include'` — safe now that Phase 2's backend already
  accepts credentialed requests from the pinned origins.
- On load, `apiFetch('/session')` **before** the localStorage/recovery fallback; an
  emailed `.org` link now recognizes the user automatically in Safari.
- **Silent key rehydration (ADR-0004 §3, reversed 2026-07-11).** After `/session`
  succeeds, if local key material is missing, call **`GET /api/session/key`** and
  repopulate localStorage (`secretKey`, and teacher `viewerPrivateKey`) — **no
  user-visible recovery prompt** in this path. The backend endpoint is **already built
  and verified** (owner-only, rate-limited, audit-logged; shares `decrypt_for_recovery`
  with the email flow); Phase 3 is just the frontend call + repopulate.
- Email-link recovery remains the **fallback** for users with no valid session (new
  device, cleared cookies).
- Reconcile with `Switch User`: cookie tracks the *active* user; `/session` names it,
  and `/session/key` serves the **active user only** — switches should be logged.
- New-registration session minting (deferred from Phase 1) lands here.
- CSRF: rely on `SameSite=Lax` + CORS-pinned state-changing calls; confirm before
  shipping whether an explicit token is warranted (ADR-0004 open item).

**Acceptance test (whole feature):** in Safari, authenticate → wait past (or simulate)
an ITP localStorage purge → tap an emailed `.org` homework link → confirm **silent key
restoration with no recovery email**, assignment opens. Also verify the cookie itself
survives >7 days in Safari (the Tunnel/orange-cloud topology should dodge the
CNAME-cloaking cap — verify empirically).

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
Phase 1 backend session ──► Phase 2 CORS pin+creds (backend-first, back-compat)
                                          │
                                          ▼
                            Phase 3 frontend (credentials:'include' + session-on-load)
                                          │
                                          ▼
                            Phase 4 §S7 ownership checks
```

## Isolation note

`main` is doing GUI layout work; this is backend + fetch-layer + session work with no
template overlap, so it lives cleanly on a separate lane. The only shared-file risk is
`apiUrl.js`/composables during Phase 0b — coordinate that migration as one commit.

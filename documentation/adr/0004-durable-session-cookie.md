# ADR-0004: Durable per-user session via a first-party server-set cookie

**Status:** Proposed (2026-07-10)
**Date:** 2026-07-10
**Deciders:** Rick (Bridge Classroom)
**Related:** GitHub #85 (durable iPad/Safari sessions), #83 (PWA stopgap), #33 (auth
hardening), review §S5/§S6/§S7/§S8, [ADR-0003](0003-signed-request-auth-for-privileged-endpoints.md)
(signed-request auth for privileged endpoints).

**Decisions locked at proposal:** (1) Near-term durability is a **first-party,
host-only, server-set session cookie** on the `api.*` host — **not** the PWA (#83)
and **not** (yet) a native app. (2) Session restore is **identity-only**: the cookie
re-establishes *who you are*; it does **not** re-deliver E2E decryption key material
— that stays behind the existing recovery flow. This lets us **fix** review §S5
rather than build on it. (3) The cookie is the **middle trust tier**, complementary
to ADR-0003 signing (which stays for privileged mass-decrypt/merge ops), not a
replacement for it. (4) Guests remain a **local-only, cookie-free** track (decided
2026-07-10, #85).

## Context

Infrequent iPad students must redo magic-link recovery on **every** visit. Safari
**ITP** purges all script-writable storage (localStorage / IndexedDB) and JS-set
cookies after ~7 idle days, wiping the credential `useUserStore.js` keeps in
localStorage (memory `project_ios_localstorage_purge`, #83). The same purge hits all
Safari (macOS included) and aggressive privacy setups elsewhere — so this is a
platform-wide session gap, not only an iPad bug.

Two independent facts make a server-set cookie the cheap, correct near-term fix:

1. **The same-site precondition is already met.** [`apiUrl.js`](../../src/utils/apiUrl.js)
   already routes `.org` pages → `api.bridge-classroom.org` and `.com` pages →
   `api.bridge-classroom.com` (both → the same Cloudflare Tunnel; originally a
   Norton-reputation workaround). ITP exempts **server-set, first-party** cookies
   (`Set-Cookie`, same registrable domain as the page) from the 7-day cap. So the
   durable cookie needs **no new DNS/Cloudflare work** — the topology that makes it
   first-party already exists.
2. **It dissolves the emailed-link problem** that every #83 PWA workaround exists to
   cope with. If the durable session lives in a cookie **in Safari itself**, the user
   never leaves Safari, and homework / join / recovery links just work — for the
   whole user base, not only iPad.

### Why this is also the missing piece for the §33 auth work

Today authorization is decided from **client-supplied, unproven** request fields
(`user_id`, `teacher_id`, `acting_user_id`). That is the structural root of the
review's IDOR family (§S7) and is why those ownership checks were never landable:
there is no server-verified identity to check *against*. Two auth tiers exist today:

| Tier | Mechanism | State | Covers |
|---|---|---|---|
| Casual filter | shared `x-api-key` | live, **not secret** | blanket misuse filter |
| Privileged proof | ADR-0003 signed request | live (admin ops only) | mass-decrypt / merge |

The gap between them is a **durable, cheap, per-*ordinary-user* identity**. Signing
every student read (ADR-0003) is overkill for the high-volume id-keyed reads (board
status, mastery, assignments); a session cookie gives a server-verified `user_id` on
every request for free. **The cookie is that missing middle tier.** It complements
ADR-0003: signing stays for the truly dangerous privileged ops; the cookie carries
ordinary per-user identity and finally makes §S7 ownership checks tractable.

## Decision

**Issue a first-party, host-only, `HttpOnly` session cookie from the API on
successful auth/recovery-claim, restore identity from it on load, and — once every
request carries a server-verified `user_id` — use it as the authorization identity
for ordinary user-scoped endpoints.**

### 1. The cookie

```
Set-Cookie: __Host-bc_session=<opaque-random-id>;
            HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=<long>
```

- **Host-only** (no `Domain` attribute) on whichever `api.*` host served the
  request, so it never crosses the `.com`/`.org` boundary. The `__Host-` prefix
  enforces Secure + host-only + `Path=/` at the browser.
- **Opaque random id**, not a JWT — the server holds session state (below), so the
  cookie carries no claims and nothing to forge.
- `SameSite=Lax` is sent on the SPA's same-site `fetch` to the API (page and API
  share the registrable domain), and survives top-level navigation from an emailed
  link.
- **Registered users only.** Guests get no cookie and no server session (they stay a
  local-only IndexedDB track — #85, decided 2026-07-10). Keeps the cookie
  architecture single-purpose.

### 2. Server session state

A new `sessions` table: `id` (the cookie value), `user_id`, `created_at`,
`expires_at`, `revoked_at`, plus device/platform columns stamped at creation. New
surface:

- **`GET /api/session`** — "who am I": returns the active user **and the full roster**
  of identities known in this browser (see caveat 1). Called on load before the
  localStorage/recovery fallback.
- **`DELETE /api/session`** — explicit sign-out / revoke (a capability the stateless
  model can't offer today).
- Cookie is set on successful `auth`/recovery-claim; rotated on a policy TBD.

### 3. Identity-only restore (keys stay recovery-gated)

The cookie restores **identity**, not **decryption capability**. The E2E AES
`secretKey` and RSA `viewerPrivateKey` live in localStorage and are **also** purged by
ITP; the cookie does **not** re-deliver them. A restored session can browse and record
new work; decrypting *past* observations still requires the existing recovery step.

This is a deliberate rejection of the tempting "have `/session` also hand back the
escrowed key material." That convenience would re-institutionalize exactly the
pattern review **§S5** flags — the server dispensing decrypted private-key material
over the wire. Instead, §S5 gets **fixed** ([`get_user`](../../bridge-classroom-api/src/routes/users.rs)
stops returning `viewer_private_key`), and key rehydration stays the recovery flow's
job.

### 4. CORS: backend-first, not lockstep (closes §S8)

[`build_cors_layer`](../../bridge-classroom-api/src/main.rs) switches from
`allow_origin(Any)` to the pinned-origins branch **plus `allow_credentials(true)`**.
This is **backward-compatible with the current non-credentialed frontend**, so it does
**not** require a coordinated deploy — the earlier "lockstep" framing was wrong:

- A request that sends **no** credentials only needs `Access-Control-Allow-Origin` to be
  `*` **or** to match its Origin. tower-http reflects the caller's Origin when it's in
  the pin list, so those requests keep passing; the extra
  `Access-Control-Allow-Credentials: true` header is simply ignored by a non-credentialed
  request. `allow_credentials(true)` breaks nothing that doesn't opt in.
- The **only** genuinely breaking order is **frontend-first**: a *credentialed* request
  forbids `Access-Control-Allow-Origin: *`, so `credentials:'include'` against today's
  `Any` config fails. Hence the safe sequence is **backend-first → soak → frontend
  `credentials:'include'`** (folded into Phase 3, not a separate atomic release).

The real requirement is therefore **pin-list completeness**, not deploy timing: the pins
must cover *every* real origin — both prod domains **and** the dev origin(s) (`:5173`
and lane2's `:5174`) — because moving off `Any` means any un-pinned origin breaks
immediately, even without credentials. Pinning also closes review §S8 (CORS-falls-open).

### 5. Frontend adopts a central fetch wrapper first

Fetch is currently hand-rolled in ~25 composables. Before threading
`credentials:'include'` through all of them, introduce one `apiFetch()` that owns base
URL + `x-api-key` + `credentials:'include'` + error handling, and migrate the call
sites to it. This is a prerequisite for #85 and independently pays down review §A1
(fetch logic copy-pasted across 5+ sites).

## Alternatives considered and rejected

- **PWA (#83).** Survives ITP, but as a *separate storage container* from Safari it
  needs code-not-link recovery and in-app join-code entry — pure coping mechanisms
  for the container split. The cookie keeps the user in Safari, so those workarounds
  vanish, and it fixes the whole user base, not just installers. Keep only the
  zero-cost "Add to Home Screen" tip; don't invest further in PWA-specific
  workarounds. PWA can never do iOS Universal Links regardless.
- **Native iOS app (Option B).** The gold standard — ITP-immune storage + Universal
  Links (the Zoom/Discord email handoff). Mostly migration for us (Apple license,
  iPad layouts, app repos in hand), but carries App Store review/update latency and
  dual web+app maintenance. **Deferred, not rejected** — longer-term product upgrade
  for the mobile segment; the cookie work is not wasted if the app ships after.
- **Session also re-delivers escrowed keys.** Convenient but re-treads §S5 (server
  hands out decrypted key material). Rejected — see §3.
- **JWT / bearer token instead of an opaque server-session cookie.** Adds a signing
  secret and a stateless-revocation problem; loses the `sessions` table's
  device-metrics and revoke capability that #85 explicitly wants. An opaque
  server-side session is simpler here and revocable by construction.
- **Reuse ADR-0003 signing for ordinary reads.** Per-request RSA signing is right for
  privileged ops but too heavy for high-volume student reads, and students may not
  have a viewer keypair at all. The cookie is the right tier for ordinary identity.
- **Do nothing / keep magic-link re-recovery.** Status quo: forced re-registration
  every ~7 idle days, higher recovery-email volume (a deliverability area we actively
  manage), and more duplicate accounts.

## Consequences

**Positive**
- Durable sessions across ITP for the whole Safari population, not just iPad.
- Emailed homework/join/recovery links work natively in Safari (dissolves #83
  workarounds platform-wide).
- A server-verified per-user identity — the substrate that finally makes review §S7
  ownership checks landable, and a natural stepping stone alongside ADR-0003.
- A `sessions` table unlocks **real** distinct-user/device metrics (server logs can't
  separate iPad-desktop-mode from Mac) and **session revocation**.
- Fewer forced re-recoveries → lower magic-link volume → less email-deliverability
  exposure; fewer "lost my login, made a new account" duplicates.
- Closes review §S8 (CORS pinned) as a side effect.

**Negative / costs**
- New backend surface to own: `sessions` table, set/restore/revoke, expiry/rotation
  policy.
- **CSRF** — cookies auto-send, a surface header-auth avoids. Mitigated by
  `SameSite=Lax` + CORS-pinned state-changing calls; must be handled deliberately.
- **Multi-user-per-browser** — the app's `Switch User` supports several identities in
  one browser; one cookie is one active identity. Reconciled by the cookie tracking
  the *active* user while `GET /api/session` returns the roster.
- CORS hardening deploys **backend-first** (backward-compatible), then the frontend adds
  `credentials:'include'`; no coordinated deploy — the only unsafe order is frontend-first.
  Requires the pin list to cover every real origin (both prod domains + dev `:5173`/`:5174`).
- Key rehydration is still a recovery step (by design) — restored identity ≠ restored
  decryption of past data.

**Security invariants**
- Cookie is `Secure; HttpOnly; SameSite=Lax`, host-only, `__Host-` prefixed, TLS-only
  (Cloudflare edge terminates).
- Never shared across the `.com`/`.org` boundary — strictly first-party, so it can't
  land on tracker blocklists and, as a strictly-necessary auth cookie, is
  consent-banner-exempt. Net reputation impact: neutral (no new hostnames/topology;
  one extra header on existing same-site calls).
- Fail **closed**: unknown/expired/revoked session → unauthenticated (fall back to
  recovery), never a silent elevation.

## Open items

- [ ] `Max-Age` target + rotation/expiry/revocation policy.
- [ ] Guest IndexedDB quota cap (the only remaining #85 guest detail).
- [ ] CSRF approach confirmation (SameSite=Lax + CORS-pin vs. adding a token).
- [ ] Sequencing of §S7 ownership checks once identity is proven (which id-keyed
      routes first).

## Rollout

See the companion plan: [durable-sessions-plan.md](../design/durable-sessions-plan.md).

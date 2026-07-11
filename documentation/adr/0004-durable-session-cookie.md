# ADR-0004: Durable per-user session via a first-party server-set cookie

**Status:** Accepted (2026-07-10) · Phases 0–2 deployed 2026-07-11 · key-redelivery
revision 2026-07-11
**Date:** 2026-07-10, revised 2026-07-11
**Deciders:** Rick (Bridge Classroom)
**Related:** GitHub #85 (durable iPad/Safari sessions), #83 (PWA stopgap), #33 (auth
hardening), review §S5/§S6/§S7/§S8, [ADR-0003](0003-signed-request-auth-for-privileged-endpoints.md)
(signed-request auth for privileged endpoints).

**Decisions locked:** (1) Near-term durability is a **first-party, host-only,
server-set session cookie** on the `api.*` host — **not** the PWA (#83) and **not**
(yet) a native app. (2) **[Revised 2026-07-11 — see §3.]** The session cookie
**also gates redelivery of the user's escrowed AES key** (and, for teachers, their
viewer private key): a valid session restores identity *and* silently rehydrates
decryption capability, eliminating the email-recovery round-trip for lapsed-but-
cookied users. *(This reverses the original 2026-07-10 "identity-only, keys stay
recovery-gated" decision — the arc and reasoning are recorded in §3.)* (3) The cookie
is the **middle trust tier**, complementary to ADR-0003 signing (which stays for
privileged mass-decrypt/merge ops), not a replacement for it. (4) Guests remain a
**local-only, cookie-free** track (decided 2026-07-10, #85). (5) **[2026-07-11]** The
cookie is a **device session with a server-side roster** (`session_users`), not a
per-user cookie: every user *proven on a device* (via registration or email recovery)
is restorable after a purge; restore returns the roster + all members' keys in one
batch + an active-user hint. See §3a.

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

- **`GET /api/session`** — restore identity: returns the **roster** (member `user_id`,
  name, email) and `active_user_id`, **no key material**. Called on load before the
  localStorage/recovery fallback. (See §3a for the device-session/roster model.)
- **`GET /api/session/key`** — **batch** key redelivery (§3/§3a): unwraps the escrowed
  AES key (+ teacher viewer private key) for **every roster member**, server-determined,
  **no user_id accepted**. Separate from `/session` so it gets its own rate limit + one
  audit line per restore.
- **`POST /api/session/active-user`** — fire-and-forget bookmark of the active member
  (`{ user_id }`, must be a roster member). Never an authorization input.
- **`DELETE /api/session`** — revoke the **whole device session** (all memberships).
- Cookie is set / the roster is joined on successful **recovery-claim or registration**
  (the two proven-identity admission gates — §3a). Rotation policy TBD.

### 3. Session-gated key redelivery (supersedes the 2026-07-10 identity-only decision)

**Decision arc.** The original proposal (**2026-07-10**) chose **identity-only**
restore: the cookie would re-establish *who you are*, but the E2E AES `secretKey`
(and teacher RSA `viewerPrivateKey`) would **not** be re-delivered by the session — a
lapsed user would still complete an email-recovery step to decrypt past work, to avoid
re-institutionalizing the §S5 "server hands out key material" pattern. On review
(**2026-07-11**) that decision was **reversed**: the session cookie now **also gates
redelivery of the user's escrowed AES key** (and, for teachers, their viewer private
key), eliminating the email step for lapsed-but-cookied users entirely.

**Why the recommendation flipped** (stated honestly):

1. **Data classification.** The encrypted payload is per-prompt bid attempts and
   correct answers — *not* credentials or financial data. The per-row pass/fail flags
   are **already plaintext** in the DB, so the "performance profile" (a student's
   ability and trajectory) is **not actually protected** by the encryption today; only
   the specific wrong-bid detail is. We would be guarding low-sensitivity data harder
   than its class warrants (see [Data classification](#data-classification)).
2. **The system is server-trusted, not E2E.** The escrow (admin) key held server-side
   can **already** unwrap every user's AES key — that is exactly how the existing
   email-link recovery flow works. Cookie-gated redelivery **reuses that same
   machinery** with a different authorization gate; **nothing new becomes decryptable
   server-side.**
3. **The security delta is precisely one thing:** what a user presents to get their key
   back changes from *short-lived proof of email control* to *a durable session
   cookie*. **Cookie theft is explicitly out of this application's threat model** (see
   [Threat model](#threat-model)).
4. **QoL driver.** Homework is assigned weekly; ITP purges script-writable storage
   after ~7 idle days. Under identity-only, an infrequent Safari user hits an email
   round-trip **nearly every week**. Under redelivery, a week-old emailed `.org`
   homework link *just works*: the cookie authenticates, the key arrives silently over
   the authenticated TLS channel, and the assignment opens.

**The endpoint** (`GET /api/session/key`, separate from `/session`):

- On a **valid session**, the server unwraps the **session's own** user's AES key (and
  the teacher viewer private key, if the user is a teacher/admin) with the escrow key —
  the *same* `decrypt_for_recovery` path the email-recovery flow uses — and returns it
  **over the authenticated TLS channel**.
- **Owner-only, load-bearing.** The handler decrypts **only** the key belonging to the
  session's `user_id`, and **takes no `user_id` parameter**. This is the first concrete
  application of the §S7 ownership principle: the identity is the *proven* session,
  never a client-supplied id.
- **Rate-limited** (reusing the §S4 in-memory limiter pattern) and **audit-logged**
  (`user_id`, session id, timestamp) so anomalous redelivery is visible after the fact.
- Kept **separate** from `GET /api/session` deliberately: `/session` stays a cheap
  identity check; key delivery gets its own rate limit and log line.

**§S5, restated.** The §S5 fix is no longer "never return key material." It is: **key
material flows only to the owning authenticated session.** [`get_user`](../../bridge-classroom-api/src/routes/users.rs)
still must not return keys — it is `x-api-key`-gated, not session-owner-gated — so that
removal stands; `GET /api/session/key` is the sanctioned owner-gated channel. The
**same rule binds the teacher key path**: a teacher's viewer private key is delivered
only to that teacher's own session, never by user_id to any key holder.

### 3a. Device-session model — a server-side roster (revised 2026-07-11)

The cookie represents a **device session, not a user.** Multiple users are **members**
of that session, tracked server-side. This makes *every proven user on a device*
auto-restorable after an ITP purge — email recovery is needed only on a genuinely new
browser/device, **once per user per device** — instead of stranding every identity but
the last one in a near-weekly email round-trip.

**Schema** (additive to the deployed single-user sessions work):

- `sessions`: add **`active_user_id`** (nullable FK to `users`) — the resume-as hint.
  Everything already deployed stays.
- **`session_users`** (new): `(session_id, user_id, added_at, last_active)` — the
  membership / authorization set.
- `users`: add **`last_visit`** — bumped on authenticated activity (independent
  analytics metric, wanted regardless).

**The one hard security boundary.** A user is admitted to a session's roster **only** by
completing **registration** or **email-link recovery** in that browser. This admission
gate is the single security boundary of the whole design — **never add a proof-free path
onto the roster.** (Escape hatch, if ever needed and *not built now*: a `requires_reproof`
flag on a membership row, e.g. teacher accounts on shared devices.)

**Semantics:**

- **One cookie per device.** No per-user cookies, no re-minting on switch. Multiplicity
  lives in `session_users`, not the cookie jar.
- **Restoration packet.** On restore the server returns: the **roster** (`user_id`,
  name, email per member), the **AES keys for all roster members in one batch**, and
  `active_user_id` as the resume hint. The client repopulates localStorage to reproduce
  the exact pre-purge multi-user state. *Restore reconstructs the device's local state;
  it does not change how the app behaves after restore.*
- **Batch keys, deliberately.** Per-switch key delivery adds no security — a cookie
  holder could switch-and-fetch in a loop and harvest the roster anyway, and roster
  admission already required email proof on this device. `GET /api/session/key` accepts
  **no user identifiers**; it returns keys for exactly the session's roster members,
  determined server-side. Rate-limited (§S4); one audit line per restore listing
  `session_id` and the `user_id`s delivered.
- **Switch User stays local and instant** (as released). It additionally fires
  `POST /api/session/active-user` as a **background, fire-and-forget** ping (no await, no
  spinner, failures tolerated). The server pointer is a **bookmark, not an authority** —
  **no authorization may ever key off `active_user_id`.** (Tightening key delivery to the
  active user only would reintroduce a per-switch server dependency for *zero* security.)
- **Resume-as.** On restore: use `active_user_id` if it's a current roster member; else
  the member with the newest `last_active`; else show the user picker. `active_user_id`
  is written on **explicit events only** — login, recovery, restore, switch.
  `last_active` is diagnostic, bumped on the switch ping and authenticated activity.
- **`DELETE /api/session`** revokes the **whole device session** — all memberships at
  once ("log everyone out of this device").

**Why not the simpler options:** a *single active session* strands every roster member
but the last one in email recovery after each purge — the exact toll we're removing. A
*full swap on every switch* re-mints the cookie, so still only one user is restorable
post-purge (just a different one), and it couples switching to a round-trip. A
`session_id` column *on `users`* can't model user↔session **many-to-many** (a user with
two devices needs two membership rows) — a column would silently evict a user's older
device on next login elsewhere, causing surprise email re-proof weeks later.

**Security statement.** Anyone holding the device can act as any roster member **without
re-proving**. This is intended for shared-device households and the classroom-iPad case,
and is consistent with the threat model (cookie/device theft out of scope).

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

## Data classification

What the observation encryption covers, and what it actually protects:

- **Encrypted (per-observation ciphertext):** the specific bid attempts a student made
  and the correct answers for a prompt.
- **Already plaintext in the DB:** the per-row **pass/fail flags**. A student's
  **performance profile** — their ability and trajectory — is therefore *derivable from
  plaintext today*; the encryption does **not** protect it. Only the granular wrong-bid
  detail is encrypted.
- **Sensitivity class:** none of this is credentials, financial data, or PII beyond the
  name/email already stored in plaintext. Treating the AES key as a high-value secret
  would be miscalibrated to the data it guards — which is the premise behind the §3
  reversal.

## Threat model

- **In scope — partial / backup DB exposure.** The nightly Google Drive backup is a
  **database-only snapshot** (`sqlite3 .backup` → a `.db`, then copied to Drive)
  containing ciphertext and *wrapped* keys. The **escrow key lives in the launchd
  plist / env, not in the DB**, so it does **not** travel with the backup (verified
  2026-07-11). Encryption-at-rest keeps a leaked backup from yielding the wrong-bid
  detail.
- **Out of scope — cookie theft.** `__Host-` / `Secure` / `HttpOnly` are the cookie's
  protections; a *stolen valid cookie* is not defended against (browsers expose no
  stable hardware identifier, so there is no meaningful device binding to add).
- **Out of scope — home-server compromise.** The API + escrow key run on a Mac Mini
  behind a Cloudflare Tunnel with **no inbound ports**. A full host compromise is not
  defended by this design — it would expose the escrow key regardless of how sessions
  work.

## Key inventory

The **escrow (admin) key** (`RECOVERY_SECRET`) that unwraps every user's stored AES key:

- **Operational copy:** the launchd **plist** `EnvironmentVariables` on the server host
  (currently Rick's Mac Mini). **At droplet migration:** an env var or a mode-`600`
  properties file, **excluded from all backups**, never committed to any repo or baked
  into any container image.
- **Recovery copy:** 1Password.
- **Zero copies** in: the database, the SQL/`.db` backup, any repo, any image.
- **Standing backup invariant.** The DB backup must remain a **database-only** artifact
  whose only key material is the *wrapped* per-user keys. If backup scope ever broadens
  (folder sync, a volume snapshot that could sweep the plist/env) so the **escrow key
  could land in the same artifact as the ciphertext it unwraps**, the
  encryption-at-rest protection claim is **void**.

## Migration note (droplet)

At the droplet move (context `project_mac_api_moving_to_droplet`), the escrow-key
placement above becomes a **deployment checklist item**: key in an env var / mode-`600`
properties file, excluded from backups, kept out of the image — the same invariant,
enforced at the new host.

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
- **Identity-only restore (keys stay recovery-gated).** The **original 2026-07-10
  decision**, since **superseded** (§3). It kept the email-recovery step for decryption
  to avoid re-treading §S5, but on review that traded a weekly email round-trip for
  Safari users against a security margin that — given the data class and the already-
  server-trusted escrow model — wasn't actually buying much. Reversed 2026-07-11 in
  favor of session-gated redelivery.
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
- **Silent key restoration** for lapsed-but-cookied Safari users: a week-old `.org`
  homework link authenticates via the cookie and rehydrates the AES key with **no
  recovery email** — the QoL payoff of the §3 reversal, and it collapses the weekly
  email round-trip that identity-only would have imposed.
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
- **Key redelivery widens what a valid cookie yields** — from identity to the AES key.
  This is a deliberate, bounded trade (see §3 / Threat model): the escrow key already
  makes every key server-recoverable, and cookie theft is out of scope. The `/session/key`
  endpoint is owner-only, rate-limited, and audit-logged to keep the surface visible.

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
- [ ] Sequencing of the remaining §S7 ownership checks (`/session/key` is the first;
      which id-keyed routes follow, and in what order).
- [ ] Redelivery rate-limit thresholds (per-user/window) — start conservative, tune to
      the observed silent-restore cadence.

## Rollout

See the companion plan: [durable-sessions-plan.md](../design/durable-sessions-plan.md).

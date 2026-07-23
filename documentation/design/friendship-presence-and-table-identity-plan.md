# Implementation Plan — Friendship, Presence, and Table Identity

**Status:** Phase 0 complete · Phase 2 backend complete (both 2026-07-23) ·
Phases 1, 3–5 not started
**Date:** 2026-07-23
**Companion to:** [ADR-0005](../adr/0005-friendship-model-and-guest-members.md),
[ADR-0006](../adr/0006-table-identity-and-access.md) — both now numbered and Accepted.
**Depends on:** [ADR-0004 durable session cookie](../adr/0004-durable-session-cookie.md) (deployed),
existing table-ticket seam ([table_tickets.rs](../../bridge-classroom-api/src/routes/table_tickets.rs)),
[bridge-table-service](https://github.com/bridge-craftwork/bridge-table-service).

---

## 1. What already exists (environment survey)

The two ADRs read as greenfield, but a surprising amount of the substrate is already built.
This section is the delta baseline.

### Identity — mostly there

| Capability | State |
|---|---|
| Server-verified identity | **Shipped.** ADR-0004 device-session cookie; `require_session()` in [session.rs:310](../../bridge-classroom-api/src/routes/session.rs#L310) resolves the cookie to a **device-session id**. |
| Multi-user per device | **Shipped.** `sessions` + `session_users` roster ([db.rs:324](../../bridge-classroom-api/src/db.rs#L324), [db.rs:351](../../bridge-classroom-api/src/db.rs#L351)). |
| Guest identities | **Shipped, further than the ADR assumes.** [table_tickets.rs](../../bridge-classroom-api/src/routes/table_tickets.rs) mints `guest-<uuid>` subjects with role `guest` and persists a `guest_users` row (`display_name`, `session_id`, `linked_user_id`) — [db.rs:1092](../../bridge-classroom-api/src/db.rs#L1092). |
| Guest → member linking | **Hook exists, unused.** `guest_users.linked_user_id` + `merge.rs`. |

**Consequence for the plan:** friendship endpoints must authorize against **roster
membership of the device session**, not "the session's user" — ADR-0004 is explicit that
`active_user_id` is a bookmark and must never be an authorization input. Every friendship
route therefore takes an explicit `acting_user_id` and checks `session_users`. This is a
new helper (`require_roster_member`) that does not exist yet; it is the single most
reused new primitive in this work.

### Tables — a different object model than the ADR assumes

The ADR describes today's state as "the URL *is* the table." That is no longer accurate:

- **`table_sessions`** ([db.rs:1056](../../bridge-classroom-api/src/db.rs#L1056)) is already a
  server-side entity with `id`, `owner_user_id`, `kind`, `status`, `seat_policy`,
  `table_count`, `classroom_id`, `exercise_id`.
- Join URLs already go through **indirection**: `/play/:host_code` and `/table/:invite_code`
  resolve *per-user permanent codes* (`users.host_code` / `users.invite_code`) to the
  owner's currently-open session ([table_sessions.rs:529](../../bridge-classroom-api/src/routes/table_sessions.rs#L529)).
- The frontend already has a "remembered tables" picker keyed by those codes
  ([useRememberedTables.js](../../src/composables/useRememberedTables.js), [TableLobbyView.vue](../../src/views/TableLobbyView.vue)) —
  i.e. the "hosts must bookmark URLs" pain the ADR cites is already partly solved.
- Multi-table is already modeled: one session contains `table_count` rooms
  ([rooms.rs](https://github.com/bridge-craftwork/bridge-table-service/blob/main/src/rooms.rs)).

So Table-Identity work is **not** "introduce an entity" — it is four concrete additions to
an existing entity: `display_name`, `access_mode`, a **rotatable per-table token**, and
persistence across close/reopen.

**Three real divergences to settle before coding** (see §6):

1. **Per-user permanent codes vs. per-table rotatable tokens.** Today's codes are
   deliberately evergreen ("so bookmarks stay valid" — teachers read them aloud in class).
   The ADR wants rotation. These are in direct tension.
2. **"One open session per owner"** ([table_sessions.rs:316](../../bridge-classroom-api/src/routes/table_sessions.rs#L316))
   contradicts the ADR's "a teacher owns N persistent tables" — though N rooms inside one
   session may already satisfy the actual need.
3. **Guests already get a DB row**, contradicting the ADR's "no account row is created."
   The row is an internal identity record, not an account; the ADR text should be amended
   rather than the code.

### Seats — machinery exists, reservations do not

`bridge-table-service` already implements place / move / vacate / boot / park-to-kibitz,
roster and `seat_update` broadcasts, and even a `?seat=N` invite link under Manual policy
([rooms.rs](https://github.com/bridge-craftwork/bridge-table-service/blob/main/src/rooms.rs),
[ws.rs](https://github.com/bridge-craftwork/bridge-table-service/blob/main/src/routes/ws.rs)).
A seat is **occupied or free** — there is no `reserved` state, no pending occupant, no
expiry timer. That is the one new concept invitations need.

### Presence and friendship — nothing exists

- **Zero** friend/presence code in any of the three repos (the only hits are the word
  "friend" in UI copy and a per-seat connected/disconnected dot).
- Critically: **the app holds no live connection outside a table.** `useTableSocket.js`
  connects only on table join, with an HMAC ticket **scoped to a `session_id`**
  ([auth.rs](https://github.com/bridge-craftwork/bridge-table-service/blob/main/src/auth.rs) —
  `Ticket { sub, name, session_id, role, exp }`). Presence needs a connection that exists
  *in the lobby*, which no ticket shape currently expresses.
- The table service has **no user database and no friend graph** — it verifies tickets
  offline and keeps state in memory (only an `events` table on disk). Fan-out to "all
  online friends" therefore requires the friend graph to reach the hub somehow (§4.3).
- No in-app notification surface exists (`AnnouncementBanner` / `AssignmentBanner` are
  static lobby banners, not an event channel).

---

## 2. Recommended sequencing

Table identity first (unblocks invitations, useful standalone), then the friend graph
(useful standalone, no new infrastructure), then presence (the expensive new
infrastructure), then invitations (needs all three), then the guest/enrollment polish.

```
Phase 0  ADR reconciliation + numbering          (docs only, ~half a day)
Phase 1  Table identity: name, access_mode, token rotation, My Tables
Phase 2  Friend graph + requests + Friends UI    (no presence — list shows "offline")
Phase 3  Presence transport + hub                (the big one)
Phase 4  Seat reservations + invitations         (needs 1 + 3)
Phase 5  Guest normalization + enrollment prompts + pending-request-through-signup
```

**Correction (2026-07-23): Phase 2 runs BEFORE Phase 1, not in parallel.** The original
claim that they're independent was wrong in one direction. Once §6.4 collapsed the access
modes to `link` | `friends`, ADR-0006 §3's `friends` mode is enforced by asking *"is the
requester the owner or one of the owner's friends?"* — which needs the friend graph. Build
Phase 1 first and its headline mode can only be half-enforced (owner-only), which then has
to be revisited. Phase 2 has no such dependency on Phase 1.

Phase 2 also ships genuinely useful on its own (friends list, requests, bootstrap-at-table)
with no droplet work at all — a good de-risking point before committing to Phase 3.

---

## 3. Phase 0 — ADR reconciliation ✅ **DONE 2026-07-23**

All six items below are applied; both ADRs are numbered, Accepted, and cross-linked, and
`require_roster_member` has landed in [session.rs](../../bridge-classroom-api/src/routes/session.rs)
with tests. The list is kept as the record of what was changed and why.

1. **Number them** `0005-friendship-model-and-guest-members.md` and
   `0006-table-identity-and-access.md`, rename files, fix the `Related:` cross-links, move
   `Status:` to Accepted with a date (matching the ADR-0001…0004 convention).
2. **Amend ADR-0005 §3** — guests *do* get a `guest_users` row today; the invariant that
   matters is "no account, no email, no credential, no persistence of play history,"
   not "no row." The row is what makes §4's pending-friend-request-through-enrollment
   implementable at all.
3. **Amend ADR-0006 §1/§6** to describe promoting the existing `table_sessions`
   entity rather than introducing a `tables` entity, and to reconcile with the existing
   per-user code scheme (§6 Q1 below).
4. **Add the missing decision: how do you address someone to friend them?** Neither ADR
   says. Recommendation to record explicitly: **v1 has no user search / no friend-by-email**
   (that would reintroduce the global directory the ADR rejects). The only bootstrap is
   *"friend someone who is at this table with me right now,"* driven off the table roster.
   This is a deliberate, tight scope and it should be written down, because it dictates the
   entire Phase 2 UI.
5. **Apply the six §6 decisions to the ADR text.** Specifically: amend ADR-0005 §5 to
   **name only** (drop email from the disclosure), rewrite ADR-0005 §6's presence-host
   sentence to **SSE from the API** and note that it reverses the droplet assumption,
   close ADR-0005 §105 with **`practicing` is automatic**, replace ADR-0006 §3's
   three modes with **`link` | `friends`** plus the "seat policy is admission" rule
   (and simplify its §6 migration to the resulting no-op), and record the hybrid link
   scheme (evergreen `host_code`, rotatable `invite_code`/token) in ADR-0006 §2.

---

## 4. Implementation phases

### Phase 1 — Table identity and access

**Backend (Mac API — `bridge-classroom-api`)**

`db.rs` migrations (additive `ALTER TABLE`, matching the existing idempotent style):

```sql
ALTER TABLE table_sessions ADD COLUMN display_name TEXT;
ALTER TABLE table_sessions ADD COLUMN access_mode  TEXT NOT NULL DEFAULT 'link'
     CHECK (access_mode IN ('link','friends'));   -- see "Seat policy IS admission" below
ALTER TABLE table_sessions ADD COLUMN join_token   TEXT;      -- nullable, rotatable
ALTER TABLE table_sessions ADD COLUMN last_used_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_table_sessions_join_token
    ON table_sessions(join_token) WHERE join_token IS NOT NULL;
```

#### Seat policy *is* the admission decision (decided 2026-07-23, Rick)

Dropping `open` (§6.4) initially implied that every arrival needs a host click. **That is
wrong for the classroom**, which is the primary case: students dribble in over several
minutes, and a teacher who chose "seat students as N/S" has *already stated* what should
happen to each arrival. Making them re-confirm it one student at a time is pure friction.

**Rule: `access_mode` governs who may reach the table; `seat_policy` governs what happens
to them on arrival. There is no third gate.**

| Existing setting | Arrival behavior |
|---|---|
| `{"mode":"auto", …}` — `first_free`, `one_per_seat` (the console's "seat students as S" / "as N+S"), `pairs` | **Auto-approved.** Seated by policy immediately, tables auto-created as needed. No host interaction, ever. |
| `{"mode":"manual"}` | Arrivals park in the lobby as waiting kibitzers until `assign_seat` / bulk `seat_students`. **This already *is* the approval interaction** — it needs no new gate, only a host-facing "N waiting" affordance. |
| `wait_to_seat: true` (orthogonal toggle) | The explicit Zoom-style waiting room. Holds arrivals even under an auto policy, until the teacher releases them with `seat_students`. This is the teacher's deliberate "hold the door" control, and it is already built. |

All three behaviors exist today in `rooms.rs` / `sessions.rs`. The work is therefore
**presentational** — surface waiting-arrival counts to the host — not a new admission
subsystem.

**This collapses `approval` as a distinct access mode.** Once seat policy owns admission
timing, `approval` and the retired `open` differ only in what the seat policy already says,
so `access_mode` reduces to two genuinely distinct answers to *"who may reach this table
at all?"*:

```sql
access_mode TEXT NOT NULL DEFAULT 'link' CHECK (access_mode IN ('link','friends'))
```

- **`link`** — anyone holding a valid (rotatable) token reaches the table; the seat policy
  decides whether they sit immediately or wait. Covers every classroom session.
- **`friends`** — the token is inert or absent; only the host's friends are seated, via
  invitation (ADR-0006 §3's strongest mode, unchanged).

Recommend adopting the two-mode schema above and amending ADR-0006 §3 accordingly —
it is strictly simpler than the three-mode design *and* than the two-mode one in §6.4,
because it deletes a gate rather than relabeling one. **Migration becomes a non-event:**
existing rows map to `link`, which preserves today's behavior exactly, restoring the clean
migration ADR-0006 §6 originally wanted.

**Honest residual:** auto-approval under an auto policy means a leaked class link is
auto-seatable, which is the bot-resistance the ADR wanted `approval` for. At this scale
that is proportionate — sessions are only open during class, and the teacher can flip
`wait_to_seat` on, or park/boot a griefer, both already built. Do **not** trade the
classroom's every-arrival friction for it. If bot seating ever becomes real, the targeted
fix is rotating the affected link (Phase 1) or flipping the session to `friends`.

Routes ([table_sessions.rs](../../bridge-classroom-api/src/routes/table_sessions.rs)):

- `GET    /api/tables` — my tables (roster-authorized). Backs "My Tables".
- `PATCH  /api/tables/:id` — rename, set `access_mode`.
- `POST   /api/tables/:id/token` — rotate (or `DELETE` to disable link-joining).
- `POST   /api/users/:id/invite-code/rotate` — the social code becomes rotatable
  (decision §6.1). `ensure_code` is currently idempotent-forever
  ([table_sessions.rs:590](../../bridge-classroom-api/src/routes/table_sessions.rs#L590)); rotation is a
  second path that overwrites rather than preserves. **`host_code` gets no rotate path** —
  it is deliberately permanent.
- Extend `resolve_code` / add `GET /api/t/:join_token` to resolve a per-table token.
- Retire the `owner_user_id` query-param ownership check in `close_table_session`
  ([table_sessions.rs:484](../../bridge-classroom-api/src/routes/table_sessions.rs#L484)) in favor of
  `require_roster_member` — this is one of the ADR-0004 §S7 ownership checks and it is
  currently a self-declared identity.

**Table service:** with only two modes, enforcement shrinks to one question at ticket-mint
time — *may this person reach this table at all?* `link` mode: a valid token suffices.
`friends` mode: the Mac API refuses to mint unless the requester is the owner or one of
the owner's friends. Doing this **at mint, in the Mac API**, keeps the droplet dumb,
preserves the deliberately thin Mac↔droplet seam, and needs **no droplet deploy in Phase 1**
— the friend graph never has to leave the API. Since tickets are 6-hour-lived
([table_tickets.rs](../../bridge-classroom-api/src/routes/table_tickets.rs)), flipping a table to
`friends` doesn't retroactively evict someone holding a fresh ticket; the host's remedy is
the existing boot/park. Note that mint-time enforcement is only sound because *admission
timing* is no longer part of `access_mode` — seat policy owns that, inside the hub, where
it already lives.

**Frontend:** a "My Tables" surface (rename, access mode, copy link, reset link) — most
naturally an extension of `TableLobbyView`'s picker plus a host panel in
`TeacherConsoleView`. `useRememberedTables.js` must tolerate a rotated/revoked token
(entry resolves 404 → show "this link was reset," offer removal) rather than silently
showing a dead entry.

**Deliverable:** a host can name a table, see it in a list, and invalidate a leaked link
without destroying the table.

### Phase 2 — Friend graph (no presence) — ✅ **backend DONE 2026-07-23**

Schema and all six routes are live in [friends.rs](../../bridge-classroom-api/src/routes/friends.rs);
the **Friends tab is still to build**. Two things landed slightly differently from the
sketch below, both tightenings:

- **The canonical ordering is enforced by a `CHECK (user_a_id < user_b_id)`**, not just by
  convention in the insert path. A reversed or self edge is rejected by SQLite itself, so a
  half-edge is unrepresentable rather than merely un-written.
- **Crossing proposals auto-accept.** If A requests B while B already has a pending request
  out to A, that is mutual consent by definition — so the second request accepts the first
  instead of leaving two crossing pendings for a human to reconcile.


**Schema** (Mac API — the user DB is the only correct home for the graph):

```sql
CREATE TABLE IF NOT EXISTS friendships (
    user_a_id  TEXT NOT NULL REFERENCES users(id),   -- always the lexically smaller id
    user_b_id  TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_a_id, user_b_id)
);
CREATE TABLE IF NOT EXISTS friend_requests (
    id             TEXT PRIMARY KEY,
    from_user_id   TEXT NOT NULL REFERENCES users(id),
    to_user_id     TEXT REFERENCES users(id),        -- null when addressed to a guest
    to_guest_id    TEXT REFERENCES guest_users(id),  -- the enrollment-pending path
    status         TEXT NOT NULL CHECK (status IN ('pending','accepted','declined','expired')),
    created_at     TEXT NOT NULL,
    responded_at   TEXT
);
```

Storing the edge with a **canonical ordering** (`user_a_id < user_b_id`) makes symmetry a
schema property rather than an application invariant — one row, no possibility of a
half-edge. Removal is a plain `DELETE` (the ADR's silent unilateral removal).

**Routes** (all `require_roster_member`, all rate-limited — reuse the §S4 in-memory
limiter):

| Route | Notes |
|---|---|
| `GET /api/friends` | my friends: `user_id`, display **name only — never email** (decision §6.5), (presence added in Phase 3) |
| `DELETE /api/friends/:user_id` | silent removal, both directions (one row) |
| `GET /api/friends/requests` | inbound + outbound pending |
| `POST /api/friends/requests` | `{ to_user_id \| to_guest_id }` — **no email/name lookup** |
| `POST /api/friends/requests/:id/accept` / `/decline` | accept creates the edge in a transaction |

Abuse controls the ADRs don't mention but that a real-name social graph needs: a per-user
rate limit and a cap on outstanding outbound requests. Cheap now, expensive to retrofit.

**What was rejected here (2026-07-23):** an earlier draft of this plan also proposed
suppressing repeat requests after a decline, as cheap groundwork for "block". That is
**not** built, and blocking is deliberately out of scope at this stage. It optimizes for a
determined pest while breaking the far likelier case — someone declines an unfamiliar
prompt, and is then permanently unfriendable with no way for either party to see why or
undo it. **A decline never bars a later request**; `declined` rows are kept as history
only. See ADR-0005 Open Questions.

**Frontend:** a **Friends** lobby tab (`src/components/lobby/tabs/FriendsTab.vue`,
registered in `LobbyView.vue`'s role→tab map for all three roles), plus the bootstrap
affordance: at a table, each *enrolled* co-player's seat/roster entry gets an "Add friend"
action. Guests get "Invite to join Bridge Classroom" (Phase 5).

**Deliverable:** mutual friendship works end-to-end; the friends list renders with everyone
showing as offline. No droplet work.

### Phase 3 — Presence

**Decided (§6.2): SSE from the Mac API.** This supersedes ADR-0005 §6's droplet
assumption. The constraint stack that drove it:

- Presence must exist **outside** a table, so it cannot ride the existing table WS.
- Fan-out needs the **friend graph**, which lives in the Mac API DB.
- The table service has **no DB and no user model**, and the Mac API is **moving to the
  droplet soon** (`project_mac_api_moving_to_droplet`), which argues against building a
  chatty Mac↔droplet dependency that will be thrown away.

**The approach:**

1. `GET /api/presence/stream` — Server-Sent Events, cookie-authorized, one connection per
   open tab. The server holds an in-process `HashMap<user_id, Vec<Sender>>` (the same
   shape as the existing in-memory rate limiter — this codebase already tolerates
   single-process in-memory state).
2. `POST /api/presence` — `{ state: online|at_table|practicing|invisible }` heartbeat,
   ~30s, with a server-side staleness sweep to `offline`.
3. On any state change, fan out to `friends(user_id)` — a single indexed query against
   `friendships`, then a push to each connected friend's senders.

Why SSE over a droplet WS: the friend graph is already local to the server that would do
the fan-out (no cross-service callback, no graph replication, no new ticket type), it
reuses the deployed cookie auth verbatim, and it survives the droplet migration unchanged
because it moves *with* the API. The cost is that the API process becomes stateful for
presence — acceptable at this scale, and it is already stateful for rate limiting.

The `at_table` state should be derived, not trusted: the table service already knows who
is seated. Simplest v1 that avoids a droplet→Mac callback is for the **client** to report
`at_table` when its table socket is open, and let the server treat a client claim as a
display hint only (it grants no capability, so a lying client harms only itself).
`practicing` is likewise client-reported and **automatic** (decision §6.6): set on entering
the solo-practice view, cleared on leaving. No user-facing toggle — `invisible` remains the
only manual presence control.

**Frontend:** `useFriendPresence.js` (singleton, per the repo's composable pattern) owning
the EventSource lifecycle, reconnect/backoff, and a `presenceByUserId` map the Friends tab
renders. Mount it once in `MainLayout.vue` for authenticated users; tear down on
Switch User.

**Deliverable:** friends' online/at-table/practicing/invisible state, live, visible only
to friends.

### Phase 4 — Seat reservations and invitations

**Table service** (the only phase needing a droplet deploy):

- Add a `Reserved { account_id, name, expires_at }` seat state alongside occupied/free in
  `rooms.rs`, included in the existing `seats_json()` broadcast so every client renders
  the pending style with no protocol addition beyond a new `kind`.
- New WS actions: `reserve_seat` / `cancel_reservation` (host-only, mirroring the existing
  host-only `assign_seat`/`boot` authorization), plus an expiry sweep releasing stale
  reservations.
- Redeeming: a ticket whose `sub` matches a live reservation seats directly into it.

**Mac API:**

- `POST /api/tables/:id/invitations` — `{ friend_user_id, seat? }`; verifies friendship,
  asks the table service to reserve the seat, pushes an `invitation` event down the
  invitee's presence stream. **The join token is never included** (ADR-0006 §2).
- `POST /api/invitations/:id/accept` → mints a ticket for that table and returns the
  route to navigate to. `/decline` → releases the reservation, notifies the host in the
  ADR's softened form.

**Frontend:** an invitation toast/modal mounted in `MainLayout.vue` (new surface — nothing
like it exists), drag-a-friend-onto-a-seat in the host view (`SeatControlTable.vue` /
`ManageableSeatLabel.vue` already carry the seat-management interactions from Slice C),
and the pending-seat rendering.

**Deliverable:** the headline feature — see a friend online, drag them to a seat, they get
a notification and land in the seat.

### Phase 5 — Guests and enrollment conversion

- **Name normalization** to *First + Last Initial* in `table_tickets.rs` (currently a
  free-form 60-char string). Note this changes what appears at existing tables; it should
  apply to the guest path only, and enrolled members' display names should get the same
  treatment for consistency with ADR-0005 §5's disclosure rule.
- **Enrollment offer** in `TableLobbyView.vue`'s guest join path (offer, never require).
- **Pending friend request through enrollment:** a `friend_requests` row with
  `to_guest_id` set; on registration, `guest_users.linked_user_id` is populated (the hook
  already exists) and any pending rows are rewritten to `to_user_id` and surfaced in the
  new member's request inbox. The "Rick wants to add you as a friend — create an account
  to accept" prompt is shown to the guest via their table connection.
- **Guest capability limits** (cannot host, cannot be friended, no presence) enforced
  server-side, not just hidden in UI — the ticket's `role == "guest"` is the check.

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| **In-memory presence dies on every API restart** (`launchctl kickstart` is routine here). | Clients reconnect with backoff and re-heartbeat; presence is soft state by nature. Accept, don't persist. |
| **A leaked class link is auto-seatable** under an auto seat policy — the bot resistance `approval` was meant to provide. | Accepted deliberately (Phase 1): sessions are open only during class, and `wait_to_seat` / park / boot are already built. Targeted fixes if it ever becomes real: rotate the link, or flip the session to `friends`. Never reintroduce a per-arrival click. |
| **Rotating the social `invite_code` breaks anyone holding it.** | That's the point of rotation; the UI must say so at the moment of rotation ("everyone with the old link will need a new one"). Scope is now bounded — decision §6.1 means class links (`host_code`) are never affected. |
| **Friend-request spam on a real-name graph.** | Per-user rate limit + outstanding-request ceiling, in from day one. Deliberately *not* handled by suppressing post-decline re-requests — that breaks the accidental-decline case, which is likelier here than a determined pest. |
| **The bootstrap path is narrow**: you can only friend people who have been at a table with you. A club wanting to seed 40 members has no path. | Acknowledged in ADR-0005 §96 (rosters are the eventual answer). Make sure Phase 2's ACL reads "may this viewer see this person" rather than "are these two friends," so the roster ACL slots in without redesign — this is the ADR's own §79 requirement and it is easy to violate by writing `is_friend()` checks inline. |
| **Seat reservations are droplet-only state** and vanish on service restart. | ADR-0006 §4 wants reservations to survive *host reloads*, which in-memory state does satisfy. Service restarts already drop live tables; no new class of loss. |

---

## 6. Decisions (settled 2026-07-23, Rick)

All six open questions resolved in favor of the recommendations. These are now
constraints on the phases above, not options.

1. **Join links are hybrid.** `host_code` stays **evergreen** — it is the class front
   door, read aloud in rooms of seniors and bookmarked by students; `access_mode` does the
   security work there. The social `invite_code` and the new per-table `join_token` are
   **rotatable**. Rotation therefore never breaks a class link, only a social one.
2. **Presence is SSE from the Mac API**, not a WS hub on the droplet. This **supersedes
   ADR-0005 §6's** "table-service (or an adjacent presence service on the same
   droplet)" — record the reversal in the ADR at Phase 0. Rationale in §4 Phase 3: the
   friend graph is already local to the fan-out, cookie auth is reused verbatim, and it
   migrates with the API.
3. **Multi-table stays N rooms inside one session.** The "one open session per owner"
   invariant is kept; `/play/:hostCode` resolution is unchanged. ADR-0006 §1/§5's
   "a teacher owns N tables" is satisfied by the existing `table_count` rooms, so Phase 1
   remains four columns on `table_sessions`.
4. **`open` is dropped — and so, on further work, is `approval`.** The modes ship as
   **`link` | `friends`**. `approval` dissolved once it became clear that **seat policy
   already is the admission decision**: an auto policy ("seat students as N/S") auto-
   approves arrivals, `manual` parks them for `assign_seat`/`seat_students`, and
   `wait_to_seat` is the explicit waiting room — all three already built. Classroom
   arrivals must never require a per-student host click. See §4 Phase 1, "Seat policy *is*
   the admission decision," which supersedes the three-mode design in ADR-0006 §3
   and restores a no-op migration.
5. **Friendship discloses name only.** Amend ADR-0005 §5, which currently says real name
   *and email*. Email exchange is trivially addable later and irreversible once shipped.
6. **`practicing` is automatic**, driven by the solo-practice view's lifecycle. Client-
   reported and display-only — it grants no capability, so a lying client harms only
   itself. Closes ADR-0005 §105.

---

## 7. Rough shape of the work

| Phase | Backend | Table service | Frontend | Notes |
|---|---|---|---|---|
| 0 | — | — | — | Docs only |
| 1 | Medium | Small (ticket-mint gate) | Medium | No droplet deploy if the mint-side gate is chosen |
| 2 | Medium | — | Medium | Fully shippable alone |
| 3 | Large | — | Medium | The architectural commitment |
| 4 | Medium | Medium | Large | First droplet deploy of this work |
| 5 | Small | — | Medium | Conversion polish |

The natural first PR is Phase 0 + the `require_roster_member` helper, since that helper is
a prerequisite for every authorized route in Phases 1, 2, and 4 — and it independently
pays down the ADR-0004 §S7 ownership backlog.

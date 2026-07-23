# ADR-0005: Friendship Model and Guest Members

**Status:** Accepted (2026-07-23) · open questions closed 2026-07-23
**Date:** 2026-07-22, revised 2026-07-23
**Deciders:** Rick, David
**Related:** [ADR-0006](0006-table-identity-and-access.md) (Table Identity and Access),
[ADR-0004](0004-durable-session-cookie.md) (durable session cookie — supplies the
authenticated identity this ADR's consent model rests on).
**Plan:** [friendship-presence-and-table-identity-plan.md](../design/friendship-presence-and-table-identity-plan.md)

**Revisions (2026-07-23).** All four open questions closed, and two decisions reversed
against the original draft after an implementation survey:

1. **Presence moves off the droplet** to SSE from the Mac API — §6 as originally written
   assumed the table-service. See §6a.
2. **Friendship discloses name only, not email** — §5.
3. `practicing` is **automatically** reported by the client (§6, closing the open question).
4. Guests **do** get an internal `guest_users` row; the draft's "no account row is created"
   overstated it — §3.

## Context

Bridge Classroom began as a single-user application (teacher and classroom views) and now includes a prototype multi-user table backed by a table-service. Players are currently invited to a table by sharing a reusable URL, and joiners supply an ad-hoc display name with no durable identity. This works for bootstrapping but does not scale socially: hosts must repeatedly share or bookmark URLs, and there is no way to see who is available to play or to invite them in-app.

We want a social layer in which a host can see which of their friends are online and invite them to a table directly (including drag-and-drop seating), with the invited player receiving an in-app notification. This resembles BBO's model, with one critical difference: BBO exposes all online users to everyone and uses opaque usernames, whereas Bridge Classroom accounts carry real names and email addresses. A global presence directory is therefore not acceptable; visibility must be consent-based.

Separately, Bridge Classroom already provides identity management (server-side session cookie) for enrolled members, and we have a product interest in encouraging enrollment.

## Decision

### 1. Friendship is symmetric and requires mutual consent

A friendship is a single undirected edge between two accounts, created only when one party proposes and the other accepts. There are no one-way follows. Either party may remove the friendship unilaterally at any time; removal is silent (the other party is not notified, the edge simply disappears from both lists).

Rationale: with real-name, email-backed identities, no one should be able to observe another person's online status without that person's consent. Symmetric friendship makes consent structural rather than a setting, and eliminates most of the need for fine-grained visibility controls.

### 2. Only enrolled members can be friends

Both endpoints of a friendship edge must be enrolled Bridge Classroom accounts. Guests (see below) can play but cannot be friended and cannot friend others.

Rationale: a friendship edge is only meaningful between stable, authenticated identities. A guest display name is session-scoped and unverifiable. This rule is also a deliberate enrollment incentive: the social features are the reward for creating an account.

### 3. Guest members: play without enrollment

A person joining a table via link who is not enrolled may participate as a **guest**:

- Identity is a self-supplied display name, normalized to *First Name + Last Initial* (e.g., "Bob S."), following the convention used by Shark Bridge.
- Guest identity is session-scoped: **no account** is created, no email is collected, no credential is issued, and no play history persists beyond the table session.
  - **[2026-07-23]** Precisely: a `guest_users` row *is* written (display name + session + a `guest-<uuid>` subject), because the identity must outlive the ticket to be seatable and to be linkable to a real account later via `linked_user_id`. That row is an internal identity record, **not an account** — it grants nothing, authenticates nothing, and carries no email. The distinction that matters is *no account*, not *no row*; this row is what makes §4's held-pending friend request implementable at all.
- Guests can play with full table functionality but cannot be friended, cannot see presence, and cannot host tables.
- Test-user generation (e.g., the "create 3 test users" button) produces guests.

### 4. Enrollment prompts occur at moments of social motivation

- When a **guest** joins a table, the join flow offers (but does not require) enrollment.
- When a host attempts to friend a guest, the guest sees a friend request that requires enrollment to accept: "Rick wants to add you as a friend — create an account to accept." The request is held pending through the enrollment flow and completes on success.

Rationale: "someone wants to be your friend" is a far stronger conversion prompt than a registration wall at the door.

### 5. Enrolled members joining via link

When an enrolled member (identified by session cookie) follows a table link, they are seated under their member identity automatically — no display-name prompt.

**Identity disclosure rule:** at the table, all participants (host included) see only display names. Fuller member identity is exchanged only through friendship acceptance. Clicking a shared link is low-stakes; the explicit friendship handshake is where trust and identity exchange live.

**[Revised 2026-07-23] Friendship discloses the member's real name — not their email.** The draft said "real name, email." Email is dropped: every invite path in this design is in-app, so an address buys nothing functionally, and it is the one *irreversible* disclosure in a flow whose accept is a single click. Adding it later is trivial; retracting it after it has been shown to a friend list is impossible. Endpoints returning friend records therefore return `user_id` + display name and **must not** include `email`.

### 6. Presence model

**[Revised 2026-07-23 — see §6a for the transport reversal.]** A presence registry keyed by account ID maintains the following states:

| State | Meaning | Shown to friends as |
|---|---|---|
| `online` | Connected, not at a table | Available |
| `at-table` | Seated at a multi-user table | Busy ("At a table") |
| `practicing` | In single-user/solo practice | Busy ("Practicing") |
| `invisible` | Connected, opted out of visibility | Offline |
| `offline` | Not connected | Offline |

- Presence is visible **only to friends** (and, in the future, to roster-scoped viewers — see Out of Scope). There is no global user directory or lobby.
- `practicing` is a distinct state so that solo practice reads as busy rather than available, reducing unwanted invitations without requiring invisibility.
- `invisible` is a **global toggle**: the user appears offline to all friends. Per-friend visibility is explicitly rejected for v1 (high complexity, low expected use). **It is the only manual presence control** — every other state is derived.
- Invisible users can still initiate everything themselves (join tables, send invites); invisibility governs only how they appear to others.
- **[2026-07-23]** `practicing` is reported **automatically** by the client, from the solo-practice view's lifecycle (set on entry, cleared on exit) — not chosen by the user. An explicit state would go untouched by most users, defeating the whole purpose of distinguishing it from `online`. Likewise `at-table` is set while the table socket is open. Both are **display hints only**: they grant no capability, so a client that misreports them harms only its own owner's invitations. Closes the draft's open question.

### 6a. Presence transport: SSE from the Mac API *(reverses the draft's droplet assumption)*

The draft placed the registry in "the table-service (or an adjacent presence service on the same droplet)." **Decided 2026-07-23: presence is Server-Sent Events from the bridge-classroom API** (`GET /api/presence/stream`), cookie-authorized per ADR-0004, with an in-process sender map and a heartbeat + staleness sweep.

Why the reversal — three facts the draft didn't have:

1. **Fan-out needs the friend graph, and the graph can only live in the API's DB** (it is `users`-referencing by §2). The table-service has no user database at all — it verifies HMAC tickets offline and keeps table state in memory. Putting presence there means either a per-connect callback to the API or replicating the graph onto the droplet; putting it in the API makes fan-out a single indexed query in the same process that does the pushing.
2. **Presence must exist outside a table, and no ticket shape expresses that.** The existing table ticket is scoped to a `session_id`; a droplet-hosted presence hub would need a new, non-session-scoped ticket type and a second auth path. The API already has the cookie, which is exactly a durable per-user identity.
3. **The API is moving to the droplet** (`project_mac_api_moving_to_droplet`). Building a cross-service presence dependency now means building a seam that the migration deletes. SSE-from-the-API is migration-neutral: it moves *with* the API and the code is unchanged afterward.

Accepted costs: the API process becomes stateful for presence (it already is for rate limiting), and that state dies on restart — which is correct for presence, since it is soft state that clients rebuild by reconnecting and re-heartbeating. Nothing about presence is persisted; only the friendship edges are.

### 7. Invitations

- A host may invite any **online** friend to a table (button or drag-and-drop to a seat; see the Table Identity ADR for seat-reservation semantics).
- The invitee sees an in-app notification: "You've been invited to *\<table name\>* by \<host display name\>", with optional context (lesson/deal set, offered seat), and Accept / Decline actions.
- Decline frees the reserved seat and is reported to the host in softened form ("\<name\> can't join right now").
- Invitations expire after a timeout (initially 2–3 minutes), releasing the seat reservation.
- Table joining is **host-pull only** in v1: friends cannot request to join ("knock on") a table they weren't invited to. This avoids a category of social awkwardness and keeps the model simple. Revisit if demand appears.

## Out of Scope (noted for the record)

- **Teacher rosters.** Classroom multi-table sessions should not require teachers to befriend students. The intended model is a *roster* derived from class enrollment, acting as a second ACL over the same presence and seating machinery ("people I may see and seat"), without reciprocal friendship. This will be specified in a future ADR; the presence and invite mechanisms in this ADR must be designed to be agnostic about *why* a viewer is permitted to see a person (friend edge vs. roster membership).
- **Standing/scheduled seat reservations for offline friends** (e.g., a recurring Tuesday foursome). Deferred to a later iteration.
- **Per-friend visibility controls.** Rejected for v1 as noted above.

## Consequences

**Positive**

- Consent-based visibility: no one is observable without a mutual relationship, appropriate for real-name identities.
- Clear, explainable tiering: *guests can play; members can be friended.* Enrollment unlocks the social layer.
- Steady state requires no out-of-band communication: once a friends list is seeded, all inviting happens in-app.
- Friend-request-driven enrollment converts at a moment of genuine motivation.
- The presence/invite machinery generalizes to teacher rosters without redesign.

**Negative / Costs**

- Guests are second-class: no persistence, no sociality. Acceptable and intentional, but must be communicated clearly in the UI.
- Symmetric-only friendship means seeding a friends list always requires one shared-link table session per new friend (the bootstrap path). This is by design but adds friction for, e.g., a club importing an existing membership — the roster mechanism is the eventual answer there.
- A presence registry is new stateful infrastructure on the droplet with fan-out (presence changes must push to all online friends); connection lifecycle (heartbeats, reconnects, stale-state cleanup) must be handled carefully.
- Held-pending friend requests through the enrollment flow add a small piece of cross-flow state.

## Open Questions

- Should friend removal also be offered as "block" (removal + refusal of future requests from that account)? Probably yes eventually; not required for v1. **[2026-07-23]** v1 lays the groundwork by *retaining* `declined` request rows rather than deleting them, so a repeat request can be silently swallowed instead of re-notifying someone who already said no. That is most of the value of blocking, at no extra cost.
- Exact invitation timeout and whether it is host-configurable. *(Still open; start at 2–3 minutes, not configurable.)*
- ~~Whether `practicing` is reported automatically or is an explicit user state.~~ **Closed 2026-07-23: automatic** (§6).

## Closed 2026-07-23

- **Presence transport** — SSE from the Mac API, not the droplet (§6a).
- **Identity disclosure** — name only, never email (§5).
- **Guest persistence** — an internal `guest_users` row exists; "no account" is the invariant, not "no row" (§3).

### How a person is addressed to be friended *(added 2026-07-23 — the draft never said)*

**v1 has no user search and no friend-by-email.** A friend request can only be addressed to someone whose identity you already hold from a shared context — in practice, a co-participant at a table you are both at (by their table `sub`), or a guest at your table (by `guest_users.id`, the enrollment-pending path in §4).

This is not an omission to fill in later; it is the same decision as §1. A lookup-by-email or name-search endpoint would recreate exactly the global directory this ADR rejects in its Context — it would let anyone probe whether a given real person holds an account, which is the BBO property we are deliberately not reproducing. The consequence, accepted, is the bootstrap cost already named in Consequences: seeding a friends list requires one shared-link table session per new friend, and clubs importing an existing membership need the roster mechanism (Out of Scope), not a search box.

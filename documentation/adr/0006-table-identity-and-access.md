# ADR-0006: Table Identity and Access

**Status:** Accepted (2026-07-23) · access modes revised 2026-07-23
**Date:** 2026-07-22, revised 2026-07-23
**Deciders:** Rick, David
**Related:** [ADR-0005](0005-friendship-model-and-guest-members.md) (Friendship Model and Guest Members)
**Plan:** [friendship-presence-and-table-identity-plan.md](../design/friendship-presence-and-table-identity-plan.md)

**Revisions (2026-07-23).** An implementation survey found the draft's premise — "the URL
*is* the table" — already out of date, and one decision reversed outright:

1. **Three access modes collapse to two:** `link` | `friends`. Both `open` and `approval`
   are dropped, because **seat policy already is the admission decision** — see §3.
2. **The entity already exists.** `table_sessions` (bridge-classroom API) already has
   `id`, `owner_user_id`, `seat_policy`, `table_count`, `status`; join URLs already
   indirect through per-user codes. §1 is a promotion of that row, not a new entity.
3. **Join links are hybrid** (§2): the teacher's `host_code` stays evergreen; the social
   `invite_code` and per-table token are rotatable.
4. **Multi-table stays N rooms inside one session** (§5), preserving the one-open-session-
   per-owner invariant that link resolution depends on.

## Context

The prototype multi-user table is identified solely by its join URL: the URL both *names* the table and *grants entry* to it. There is no separate table identity, no table display name, and no host-facing management surface — hosts bookmark the URL to return to their own table.

This conflation blocks several planned capabilities:

- **Link rotation.** A long-lived reusable URL is a capability token, and capability tokens leak (forwarded emails, pasted into groups.io messages). Hosts need a way to invalidate a leaked link — but if the URL *is* the table, revoking it destroys the table.
- **Friend invites.** The planned presence/invite flow (see Friendship ADR) seats invited friends via their authenticated session. Invites must not smuggle the secret URL to invitees, or every invited friend becomes a re-sharer of the capability token.
- **Access control.** "Friends only" tables need the concept of a table that has *no* active link at all.
- **Multi-table teachers.** A teacher running a classroom needs several addressable tables ("Table 3 of Tuesday class") referenced by the classroom UI, not a pile of bookmarked URLs.
- **Bot/abuse resistance.** A static open URL on a host's table is scriptable; anyone who obtains it can seat themselves indefinitely.

## Decision

### 1. Tables are durable entities with internal identity

**[Revised 2026-07-23]** This is a **promotion of the existing `table_sessions` row in the bridge-classroom API**, not a new entity in the table-service. That row already carries `id`, `owner_user_id`, `kind`, `status`, `seat_policy`, `table_count`, `classroom_id`, and `exercise_id`; what it lacks is a name, an access mode, a rotatable token, and lifecycle stamps. The additions below are four columns. Live table state stays in the table-service's memory — the Mac↔droplet seam is unchanged.

The fields, at minimum:

| Field | Notes |
|---|---|
| `table_id` | Stable internal identifier. Never appears in shareable URLs. |
| `owner_id` | Account ID of the host. Hosting requires enrollment (guests cannot own tables). |
| `display_name` | Human name, e.g. "Rick's Table", "Tuesday Practice". Backfilled lazily for migrated tables. |
| `access_mode` | `link` \| `friends` (see §3). |
| `join_token` | Nullable, rotatable random token (see §2). |
| `settings` | Deal source, seat reservations, etc. — grows over time. |
| `created_at`, `last_used_at` | Lifecycle/housekeeping. |

All internal machinery — presence, invitations, seat reservations, the host's own navigation to their table — references `table_id`. A "My Tables" view lists a host's tables by name; the host never needs to retain a URL to reach their own table.

### 2. The join link is a separate, rotatable capability token

- The shareable URL carries `join_token` only: an unguessable random value that the table-service resolves to a `table_id` at link-join time.
- `join_token` is **nullable**: a table may have link-joining disabled entirely (no valid URL exists).
- A host may **rotate** the token at any time ("Reset link"), instantly invalidating the old URL while leaving the table — its name, settings, reservations, and history — intact.
- Tokens are never displayed to, or transmitted to, invited friends; friend invitations reference `table_id` and seat the invitee through their authenticated session.

The link's role shrinks to exactly the bootstrap case: admitting people who are not yet friends (see [ADR-0005](0005-friendship-model-and-guest-members.md) §4). Everyone already known is invited via presence.

#### Which links rotate *(added 2026-07-23)*

Rotation is **not** applied uniformly, because the two existing per-user codes serve opposite purposes:

- **`host_code` (`/play/:hostCode`) stays evergreen — it has no rotate path.** It is the teacher's class front door: read aloud in a room, written on a whiteboard, bookmarked by students who return weekly. A code that can silently die mid-term is a footgun there, and `access_mode` + seat policy already do the security work. Its permanence is a feature, not an oversight.
- **`invite_code` (`/table/:inviteCode`) and the per-table `join_token` rotate.** These are the socially-forwarded, leak-prone links the revocation story in Context is actually about.

So "reset link" always exists for the link you shared with a person, and never silently breaks the link you gave a class.

### 3. Access modes *(revised 2026-07-23 — three modes collapse to two)*

**`access_mode` governs who may *reach* the table. `seat_policy` governs what happens to them on *arrival*. There is no third gate.**

Each table has one of two access modes:

- **`link`** — anyone holding a valid (rotatable) join token reaches the table; the seat policy then decides whether they are seated immediately or wait. Covers every classroom session.
- **`friends`** — the link is inert (or absent); only the host's friends may be seated, via invitation. Strongest mode; the steady-state for established groups.

Enforcement is at **ticket-mint time in the bridge-classroom API**: `link` needs a valid token, `friends` requires the requester to be the owner or one of the owner's friends. The table-service stays dumb, and the friend graph never has to leave the API.

#### Why `approval` was dropped

The draft made `approval` the default: the link admits a visitor to a knock/lobby state and the host explicitly seats or dismisses them. That is wrong for the primary case. **In a classroom, students dribble in over several minutes, and a teacher who has already chosen "seat students as N/S" has stated what should happen to each arrival.** Making them re-confirm it once per student is pure friction, repeated every class.

Admission timing is therefore delegated entirely to the seat policy, where it already lives and is already implemented:

| Seat policy | Arrival behavior |
|---|---|
| `{"mode":"auto", …}` — `first_free`, `one_per_seat` ("seat students as S" / "as N+S"), `pairs` | **Auto-approved.** Seated by policy immediately; tables auto-created as needed. No host interaction, ever. |
| `{"mode":"manual"}` | Arrivals park in the lobby as waiting kibitzers until `assign_seat` or bulk `seat_students`. **This already *is* the approval interaction** — it needs no new mode, only a host-facing "N waiting" count. |
| `wait_to_seat: true` *(orthogonal toggle)* | The explicit Zoom-style waiting room: holds arrivals even under an auto policy until the host releases them. The deliberate "hold the door" control. |

`open` and `approval` differed only in what the seat policy already says, so both dissolve. This is strictly simpler than the draft *and* restores a no-op migration (§6).

**Accepted residual.** Under an auto policy, a leaked link is auto-seatable — the bot resistance `approval` was meant to buy. At this scale that is proportionate: sessions are open only during class, and `wait_to_seat`, park, and boot all already exist. The targeted remedies are rotating the link (§2) or flipping the table to `friends` — **not** reintroducing a per-arrival click.

Anticipated convenience (not required for v1): a host may temporarily enable link-joining on a `friends` table for one session to onboard a newcomer, with the mode reverting automatically when the table closes.

### 4. Seat reservations and invitations

- Dragging a friend onto a seat creates a **seat reservation with a pending invitation**: the seat renders the friend's name in a pending style; acceptance seats them; decline or timeout (initially 2–3 minutes) releases the seat.
- Reservations are keyed by (`table_id`, seat, `account_id`) and live in table state, surviving host page reloads.
- Standing reservations for offline friends (pre-reserving a Tuesday foursome) are deferred; the schema should not preclude them.

### 5. Teacher / multi-table case

**[Revised 2026-07-23]** A teacher's N tables are the **N rooms inside one session** (`table_count`), which the table-service already implements and auto-creates as students fill. They are *not* N `table_sessions` rows. This preserves the existing **one-open-session-per-owner** invariant that `/play/:hostCode` resolution depends on — the code resolves to "the owner's open session" and would become ambiguous otherwise.

The classroom view addresses rooms within the session and composes them with a class roster (roster ACL to be specified in a future ADR). Classroom tables will typically be populated by roster-based seating. No teacher-specific table schema is required.

### 6. Migration *(simplified 2026-07-23 — now a no-op)*

Because the entity already exists (§1) and the modes collapsed to `link` | `friends` (§3), migration is four additive `ALTER TABLE`s on `table_sessions` plus a defaulted column:

```sql
ALTER TABLE table_sessions ADD COLUMN display_name TEXT;
ALTER TABLE table_sessions ADD COLUMN access_mode  TEXT NOT NULL DEFAULT 'link'
     CHECK (access_mode IN ('link','friends'));
ALTER TABLE table_sessions ADD COLUMN join_token   TEXT;   -- nullable, rotatable
ALTER TABLE table_sessions ADD COLUMN last_used_at TEXT;
```

Existing rows default to `link`, which **preserves today's behavior exactly** — no row rewriting, no behavior change, no re-issued URLs. (The draft's plan to migrate rows to `open` was needed only because `approval` was going to be the default; dropping both modes removed the problem rather than solving it.) `display_name` is backfilled lazily — hosts are prompted to name a table on next use.

## Consequences

**Positive**

- Link revocation without table destruction; "how do I un-share this?" has an answer.
- Friend invitations never expose the capability token; `friends` tables can have no token at all.
- Tables become nameable, listable objects — the original pain point (bookmarking/sharing URLs to get anywhere) dissolves, because URLs were standing in for a missing object model.
- Invitation UX improves: "You've been invited to *Tuesday Practice* by Rick S."
- `approval` default neutralizes static-URL bot seating with no per-user cost.
- The teacher multi-table case is ownership of N tables, not a new concept.

**Negative / Costs**

- New management surface: table list, rename, access-mode selector, link generate/reset. Small but real UI work.
- Token resolution adds an indirection to link-join; trivial cost.
- `approval` mode introduces a lobby state and host-notification path — though this is shared machinery with friend-invite pending seats, so the marginal cost is low.
- Migration touch, albeit small at prototype scale.

## Open Questions

- Table lifecycle: do idle tables expire, or persist indefinitely? (Lean: persist; they are cheap rows. Sessions within them are ephemeral.)
- Cap on tables per host (non-teacher)? Probably a generous default limit to prevent abuse.
- ~~Whether `open` mode should be offered at launch.~~ **Closed 2026-07-23: neither `open` nor `approval` ships — see §3.**
- URL shape for the per-table token: token-only path (e.g., `/t/<token>`) vs. vanity component; token-only is simplest and reveals nothing. *(Note the existing `/play/:hostCode` and `/table/:inviteCode` shapes are unaffected and stay.)*

# Table test-cycle roadmap — 2026-07-30

Twenty-five items from one afternoon's joint testing (Rick + David, first real
multiplayer session on the served table). Every item is triaged: the bundles carry an
`adjudication.md` with the diagnosis, and nothing below is a guess about cause unless it
says so.

**How to read this.** Phases are ordered by *what makes the next thing cheaper*, not by
severity. Two rules drove the sequence:

1. **Delete before you design.** One item (Phase 1) removes a feature and thereby
   answers three other reports. Do it first so the design questions it would otherwise
   raise never need answering.
2. **Make failure legible before chasing the illegible.** Two of the day's hardest
   investigations ended in "the client swallowed the outcome and nothing logged it".
   One unexplained item (3) stays open until that's fixed, deliberately — chasing it
   now means guessing.

**Deploy costs to remember**, since they shape batching:
- Frontend — merge to `main`, both domains rebuild themselves (~60s, `.org` first).
- Mac API — **merging Rust does not deploy it**: `cargo build --release` then
  `launchctl kickstart -k gui/$(id -u)/com.bridgeclassroom.api`.
- Table service — merge to `main` builds `ghcr.io/…:main`, then on the droplet
  `docker compose pull bridge-table-service && docker compose up -d bridge-table-service`.
  ⚠️ Sessions are **in-memory**: a deploy destroys every live table. Never mid-session.

---

## Phase 1 — Delete the thing that confused everyone (½ day)

### 1.1 Retire ready-up (#51, and the cause of #45 / the "not the host" report)

Rick's ruling: *"why does a human need to say they are ready for the next board? …
right now I don't see any use case."* Both testers hit it independently in one session.

Beyond taste, it's a **gate**, not a signal — the server advances only "once every
connected human is ready", so one idle-but-connected player stalls the table until the
host force-advances. A mechanism meant to smooth board changes can demand the very
intervention it was meant to remove.

- Remove the Ready button + `iAmReady` / `readySeats` UI (`BiddingPracticeView.vue:313`).
- Remove `ready_next_board` handling and the ready gate in the table service; the host's
  next-board / `force_advance` becomes the single path.
- Delete the classroom copy leaking onto friends tables: *"or for the teacher to open
  the next board"* — there is no teacher at an adhoc table.

**What it buys:** #45 ("three different buttons to deal next board") loses one button and
becomes a two-affordance tidy-up rather than a design question; the "I'm not the host"
report disappears entirely.

**If the classroom case returns**, rebuild it as **signal, not gate**: auto-ready on
board completion plus a passive per-table "still reviewing" indicator for the teacher.
Same information, no clicking, no way to strand a table.

### 1.2 Next-board affordances (#45)

After 1.1: NW transport ⏭ and the host's "Next deal →" both remain, plus "End table".
Decide which is canonical for a host and whether the NW ⏭ is host-only. Small, and
purely a decision.

---

## Phase 2 — Phase-blind derivations (½ day)

The most-reproduced defect of the cycle: **three separate captures** show it.

### 2.1 "Down N" on a bid-only board (Rick's report; David's #49 and #52 screenshots)

`deriveStatus` (`useTableStatus.js:50`) computes made/down the moment a contract and a
declaring side exist. On a bid-only board nothing was played, so `won = 0` and
`delta = 0 − 9 = −9` → "Down 9". The arithmetic is right; the premise is wrong. **The
function is never told whether the hand was played.**

Pass the board mode (or a plain `played` boolean) and return `result: null` — the same
null it already returns before a contract is known, so every consumer's "no result yet"
path is already correct.

### 2.2 "13 cards" on every unseen hand during the auction

`SeatPanel.chipCardCount` (`SeatPanel.vue:86`) counts whenever the holding is chipped,
in any phase. During bidding that's 13 for every unseen hand, always — true, constant,
uninformative. During play the same number earns its place.

Thread the phase (GridArrangement has it) and suppress while bidding. **Do not** suppress
on "count === 13": that also hides it at trick one, where it's legitimate.

### 2.3 Sweep for the others

Both are the same shape — *a value derived correctly from state, rendered in a phase
where its premise doesn't hold*. Two in one afternoon means look for more: anything
deriving a result, count or progress figure from table state without asking the phase.
Start with the rail result line, observations, and `board_complete` consumers.

---

## Phase 3 — Make failure legible (1 day)

Everything after this gets cheaper to diagnose. Item 3.3 also fixes a live UX bug.

### 3.1 Session identity in beetle bundles

The day's two hardest investigations were "correlate one screenshot with two server logs
by hand". The session id is **already the join key** in both logs — it's just missing
from one side's bundle: a joiner's URL carries it (`/table/<session>`), the host's does
not (server mode is entered in place, address bar stays `/table`).

`useRemoteTable` already exposes everything needed — `sessionId`, `tableId`, `seq`,
`board`, `boardNumber`, `phase`, `boardMode`, `isHost`, `yourSeat` — and the shell
already contributes a `context.table` block. So this is filling in fields, not building
plumbing:

```
context.table.session = { id, tableId, isHost, yourSeat }
context.table.at      = { board, boardNumber, seq, boardMode }
```

`isHost` / `yourSeat` explain most of why two people describe the same moment
differently — they'd have answered #51 without opening an editor.

**Use the server's `seq`, not a hand-rolled bid/card count** (Rick's question,
2026-07-30). `seq` is the table's monotonic action counter: the client already tracks it
and rejects out-of-order events against it (`if (ev.seq <= seq.value) return false`), the
service stamps it on every event, and `undo` addresses it as `to_seq: N`. A separate
"bid 4 / card 7" numbering would be a second, weaker index that can disagree with the
server's.

**Keep BOTH phase fields.** Bundles already carry `arranger.phase` (the LAYOUT phase) and
`table.phase` / `cardplayPhase` (the ENGINE phase), and in the "Down 9" bundle they
disagree — arranger `review` vs table `bidding` — because on a bid-only board the engine
never leaves bidding while the layout moves on. That disagreement is diagnostic; don't
collapse them. Do fix `env.phase`, which sits `null` on table surfaces while both other
copies are populated.

Also populate **`dealSource.board`** on the served path (null in every bundle read this
cycle), so a report ties to the hand it was about. Phase 5.2 needs the same field.

**Why this is worth more than correlation.** With the session id, a bundle becomes
addressable as **(session, tableId, board, seq)** — a coordinate, not just a join key.
That is the missing half of the beetle's stubbed `fixture.json` (bug-reporting spec,
Slice 3/4): a report naming the exact action index is most of the way to replayable,
which is what the harness loader was always meant to consume.

⚠️ **Never log the per-connection token** (`new_token()`) — it's the roster/kick handle,
effectively a bearer for that socket, and bundles get attached to GitHub issues. The
session id is opaque and short-lived; safe.

### 3.2 Log the invitation lifecycle in the API

`invitations.rs` has **zero** info-level logging — create, accept and the seat-reserve
call are all invisible at the running level. Establishing that an accept had succeeded
required reading the SQLite row by hand. One `info!` per transition.

### 3.3 Stop the client swallowing outcomes

Three bare `catch {}` blocks on the invitation-accept path with no user-visible result.
Worse, PR #366 made 404/409/410 **dismiss the toast silently** — which converts a failure
into "nothing happened", the exact complaint in two separate reports. Every terminal
outcome should say something (the app toast surface already exists).

### 3.4 Beetle submit takes ~8s (David)

`POST /api/bug-report` performs **5–6 sequential awaited round trips to api.github.com** —
a `PUT contents` per file (two ~90KB base64 screenshots, fixture, context), then
`POST issues`, then a back-ref — all inside the request the reporter waits on, behind
client → tunnel → Mac. ~1s per GitHub write explains 8s exactly.

Cheapest first: the four PUTs are independent → run concurrently. Better: accept the
bundle, return, and do the GitHub writes in a background task (the local dev sink already
has that shape). Submit latency is a tax on the reporting habit, and this cycle proves
the habit works.

---

## Phase 4 — The invite/toast outcome path (1 day)

### 4.1 Toasts pile up on other windows (#43-adjacent, own report)

Toasts are per-window client state; the server pushes per **user**, so every window pops
one and only the answering window dismisses. Two separable halves:

- **Server:** an `invitation_resolved` / `friend_request_resolved` event on the presence
  stream carrying the id. Note it must fan out to the **answering user's own**
  connections — a different fan-out from today's (which notifies the counterparty).
- **Client:** drop that toast everywhere on receipt; and when a stale one *is* clicked,
  say "already answered on another window" rather than dismissing mutely (3.3's rule).

### 4.2 Re-examine the unexplained accept — **RESOLVED 2026-07-30 evening**

**The environmental hypothesis was wrong, and the log says so.** Session
`4afd41d0` was `session_created` at 17:52:39 and the HOST's `ws_joined seat=S`
landed at 17:52:40 — one second later. The service had not "forgotten" this
session; it had just minted it. A restart 20 minutes earlier is irrelevant to a
session created after it. Retire that theory.

The invitee's sub appears **nowhere** in `4afd41d0` — not even a rejected join —
so the failure was entirely client-side, between a successful accept and the
socket open. That narrows it to one function, and the defect is plain once you
look at `TableLobbyView.doJoin`:

```js
const ok = await table.join({ … })
if (myEpoch !== navEpoch) return
joining.value = false
if (ok) mode.value = 'joined'      // ← and if it's NOT ok?
```

It acted **only on success**. A failed join fell through with no error, no retry
and no state change — leaving whatever mode was already showing. On the
accepted-invitation fast path that mode is `'identify'`, set just before the
call, so the invitee was left staring at an *identity prompt for a table they
had already accepted*. "It accepted and then nothing happened" is exactly what
that looks like from the outside, and it is the same swallowing class as §3.3 —
a terminal outcome with no user-visible result.

Fixed: a `join-failed` mode that names the failure, says the invitation is still
good (the seat reservation outlives the failed socket), and offers **Try again**.
The retry needs `lastJoinOpts` because `invitationJoin.take()` has already
consumed the one-shot ticket by then.

⚠️ **Operational note, learned the hard way:** `docker compose up -d` RECREATES the
container, and the old container's `docker logs` go with it. On a service whose
sessions are in-memory *and* whose logs are the only forensic record, a deploy
destroys both halves of the evidence. The 17:52 window survived only because it
had been read into a session transcript first. Worth a logging driver or log
shipping before the next test cycle.

<details><summary>Original entry — the reasoning that set up the fix</summary>


Session `4afd41d0`: the invitation reached `accepted` server-side and returned a ticket;
the client never opened a socket; Close Table + restart cleared it and the retry was
flawless (`ws_joined seat=N`). The one environmental oddity: the table service had been
restarted 20 minutes earlier, wiping its in-memory sessions, so clients held references
to a world it had forgotten. **Unproven.** With 3.1–3.3 in place a recurrence is
self-diagnosing; without them it's guesswork. Do not chase it before Phase 3.
</details>

---

## Phase 5 — Host surface (1–2 days)

Mostly David's, all from the host's TableView.

### 5.1 Table settings placement (#53, #54, #48)

PassBot and "Show BBA auction comparison" live in the right rail; David wants them in
Table settings. Plus a new request: **Randomly Rotate/Alternate**. One coherent piece of
work — decide what belongs in the settings modal vs. the rail, then move all three.

### 5.2 Report a Problem in the B tables (#47)

Two deliberately separate paths, worth stating as an invariant: **beetle → app defects →
app repo**; **Report a Problem → bridge/content defects → the content repo that owns the
deal**.

The backend needs **nothing** — `POST /api/report` already takes `collection` and
`route_for_collection` maps it to the owning repo *and that maintainer's PAT*. The
frontend is A1-only: `ReportProblemModal` is mounted solely in `MainLayout.vue`. So:
mount the modal in the table shell, build its context from the deal source, and gate it.

⚠️ **The gate has a sharp edge.** With `collection` absent the server falls back to the
Bridge-Classroom repo — fine as a safety net for a mis-tagged report, but it means a
button shown on a random/dealer-service deal or a pasted PBN silently files
bridge-content complaints in the *app* repo. Hide the button unless the source is
repository-backed (carries a collection id and a board identity). Needs 3.1's
`dealSource.board`.

### 5.3 Claim button (#42, #55 — filed twice)

Costing David repeatedly. Check whether it's missing on the served path only.

### 5.4 DD errors not visible (#56)

`showDdErrors: true` in his settings, nothing rendered. Check whether the overlay is
wired on the served/host path at all or only in solo.

---

## Phase 6 — Layout (1 day)

### 6.1 DD table too small at review

Two stacking causes:

1. **The arranger doesn't know SE is occupied.** The ledger has no `se` entry while
   `rendered` carries `se: 222×166`, and the X-ray legend reads `COLLAPSED … se`. Mirror
   image of the occupancy bug fixed in PR #364 (reserved-but-empty); this is
   **present-but-unreserved**. Same root shape: what the shell reports as occupied and
   what actually renders are two different questions.
2. **Its cap forbids growth.** `caps.se = 'seats'` resolves to `min(1, seatScale)` — a
   ceiling of **1.0** — so when the seats grow above natural (1.36 in the report) the
   corner stays pinned. Right for the bidding box (fixed-width widget); wrong for the DD
   table, which is that corner's occupant at review.

**Decision needed:** does the corner track the seats at review, or does the DD table get
its own cap distinct from the action relationship? Note the same relationship makes the
height fit model the corner as flat-then-proportional (`kind: 'action'` in
`solveHeightFit`), so a change here has a counterpart there.

### 6.2 Auction box cramped with compare on (#49)

With BBA compare enabled each cell stacks four lines (`● YOU / call / ○ BBA / call`)
inside a cell sized for one. `auctionReservePx()` provisions a *normal* auction, so
compare mode systematically under-reserves. Reserve should be compare-aware.

---

## Phase 7 — BBA compare correctness (½ day)

### 7.1 False divergence (#52)

David's capture shows `● YOU 1NT` over `○ BBA 1NT` struck through — identical calls
rendered as a divergence. Suspect a textual rather than semantic comparison (`1N` vs
`1NT` normalisation). Verify before fixing.

### 7.2 Divergence appears only at the end of the auction (#50)

Companion to 7.1: the compare populates retrospectively instead of per-call.

---

## Phase 8 — Deferred / needs triage

- **Cross-TLD guest registration** — [Bridge-Classroom#368](https://github.com/bridge-craftwork/Bridge-Classroom/issues/368).
  Made more likely by the `.org`-canonical invite links (PR #367). Four options sketched
  in the issue; 1 and 2 are cheap, 4 is effectively a login link with the security review
  that implies.
- **`ClassroomCard` join link path** — root-relative `/#/join/CODE` while the SPA lives
  at `/solo-practice-app/`. May not resolve on either domain; PR #367 changed only its
  origin. Needs testing, not guessing.
- **#41** "The bidding sequence is repeated. The text West led the TC. West led the KD"
  and **#42/#55** claim button — #41 is untriaged; read its bundle first.
- **#46 "aaa"** — a beetle test submission. Close as noise.

---

## Suggested first session

Phase 1 and Phase 2 together: both are small, both are decisions already made, and they
remove the two things the testers actually tripped over. That's one frontend deploy plus
one table-service deploy — do the service deploy while no table is live.

Then Phase 3 in full before touching Phase 4, so the one unexplained item has a chance of
explaining itself next time.

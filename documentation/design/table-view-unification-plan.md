# Table view unification plan (solo ↔ host)

Converge `/bidding-practice` (solo) and `/tables/host` (multiplayer) so they look
the same everywhere except where they *functionally* differ. Alpha; iterate online
via the beetle. Each slice below is independently shippable and beetle-verifiable.

## Current state

Both routes resolve to **one component**, `BiddingPracticeView.vue` (aliased
`UnifiedTable`), split at the top on the `server` prop:

- `server` → `.tv-page` branch (multiplayer) — rendered inside `TableHostView`'s
  own session chrome (`.th-nav` + `.th-controls`: Copy invite / Test players / End table).
- non-server → `.bp-app` branch (solo **and** the embedded `?pbn` bidding widget).

**Already shared (the felt inward):** `BridgeTable` (host wraps it as
`SeatControlTable` = BridgeTable + drag/drop seat labels), and `GridArrangement /
SeatPanel / HandDisplay / SeatChip / SeatIndicator`, plus `AuctionTable`,
`BiddingBox`, `TrickArea`, `StatusStrip`, `BoardIndicator`, and the `#nw/#center`
grid slots. Every recent table fix (#247–#250) lives here and applies to both.

**Duplicated (the felt outward):** page shell, header/control strip, the 2-column
table+rail layout, the rail cards, status lines, and **two CSS namespaces**
(`tv-*` ~51 rules, `bp-*` ~83 rules) with no shared table-view stylesheet.

## Target architecture

Extract a **`TableShell.vue`** that owns the shared frame; both branches fill it
via slots. Only genuinely functional content stays branch-specific.

```
<TableShell :title :tags :embedded>
  <template #actions>   … Pause/Undo/Deal (host)  |  Rotate/Play/Restart/Invite (solo) … </template>
  <template #notes>     … kibitz/paused note (host)  |  scenario name+meta (solo) …       </template>
  <template #table>     … <SeatControlTable> (host) |  <BridgeTable> (solo) …             </template>
  <template #rail>      … DoubleDummy/Kibitz/PassBot/Play/Result (host) | Auction/Your-bid (solo) … </template>
  <template #toasts>    … host error/undo toasts …                                        </template>
</TableShell>
```

`TableShell` owns: `.ts-page`, `.ts-header` (left = title+tags+status, right =
`#actions`), `#notes` strip, `.ts-main` (the 2-col grid — adopt the server's
`.tv-main` values: `minmax(0,3fr) minmax(240px,1fr)`, 1400px cap), `.ts-rail`,
the shared `.ts-card` and `.ts-btn` styles, and an `embedded` mode that drops the
chrome (nav/header) for the iframe widget.

### Shared vs slotted

| Piece | Shared (in `TableShell`) | Slotted (branch-specific) |
|---|---|---|
| Page wrapper, header frame, 2-col layout, rail container | ✓ | |
| Card + button styling (`.ts-card`, `.ts-btn`) | ✓ | |
| Title + tags + conn/status strip | frame ✓ | which tags/status |
| Header actions | frame ✓ | host: Pause/Undo/Deal/Next · solo: Rotate/Play/Bot/Restart/Invite/Description |
| Table | slot | host `SeatControlTable` · solo `BridgeTable` (same base) |
| Rail cards | container + card style ✓ | host: DoubleDummy/Kibitz/PassBot/Play/Result · solo: Auction/Your-bid |
| Notes strip | frame ✓ | host: kibitz/paused · solo: scenario name+meta |

## Common controls (belong on BOTH interfaces)

These should be shared actions, not solo- or host-only. Slice 2 introduces a
shared actions set in `#actions`; each branch adds only its truly-specific extras.

| Control | Today | Target |
|---|---|---|
| Deal source… | both | common |
| Next deal | both | common |
| Restart this deal | solo only | **add to host** |
| Description (scenario narrative) | solo only | **add to host** (when a scenario is loaded) |
| Bot selection | solo only | **add to host** |
| Play-after-bid checkbox | solo only | **add to host** — but see caveat |
| Rotate-randomly checkbox | solo only | **add to host** |

Host-only extras stay host-only: Pause/Resume bots, Undo, all-hands toggle,
Copy invite / Test players / End table (session chrome in `TableHostView`),
Kibitz, PassBot, Ready-for-next-board. Solo-only: Invite friends (convert to served).

**Caveat — play-after-bid on host:** the served table already advances
bidding→play for everyone, so "play after bidding" may be implicit there rather
than a per-user toggle. Confirm the intended host semantics before wiring it
(it may become a room/deal-source setting, not a checkbox).

## Decisions (2026-07-15, from Rick)

1. ~~Solo has no right rail~~ **REVISED 2026-07-15: solo DOES use its right rail**
   (`bp-right-rail` holds cardplay controls: waiting cue, tricks, bot stats). Keep
   it. **Slice 2c (grid rearrange) cancelled** — solo maps its rail to the shell's
   `#table`'s internal grid (unchanged) for now; a future end-of-hand DD→NE /
   auction→center / tricks→NW rearrange can be revisited separately if wanted.
2. **Header & footer match the A1 app** (`MainLayout`'s `.app-header` look +
   the shared `PageFooter`). **Drop "All Tools"** for now; inter-app nav comes
   later. Apply to both table views so they match A1 and each other.
3. **Play-after-bid is a real toggle on both surfaces**, not implicit:
   - OFF = bidding-only practice with a partner → the state machine must **not**
     advance into play; after the auction it's just **ready for Next Deal**.
   - OFF also changes bot seat names to the **bidding** bot only (e.g. `BBA`),
     dropping the cardplay suffix (`+Ben` / `+RulesBot`) since there's no cardplay.
   (Functional — Slice 3.)

## Slice plan

**Slice 1 — Extract `TableShell`, adopt in the server branch (pure refactor). ✅ DONE (#251).**
`TableShell.vue` owns page + header + 2-col frame (`ts-*`) with slots
`header-left/header-right/notes/table/rail/overlays` + `embedded`. Server branch
renders through it; no behavior change.

**Slice 2a — Shared page chrome. ✅ shipping now.**
Add `TableShell` single-column mode (no `#rail` → one column). Add the shared
`PageFooter` to both table views; **remove "All Tools"**. Low-risk prep for the
A1-style header.

**Slice 2b — Solo adopts `TableShell` (single column, no rail).**
Solo renders `<TableShell embedded=EMBEDDED>` with: scenario **buttons** →
`#header-right`, scenario **name/meta** → `#notes`, `BridgeTable` → `#table`, **no
`#rail`**. Keep the priming skeleton for now (Slice 2d). Verify solo + embedded.

**Slice 2c — Solo end-of-hand grid (decision #1).**
At complete/review: Double dummy → NE, auction → center, tricks/result → NW (with
table status). Solo grid-slot arrangement only.

**Slice 2d — A1-style header (decision #2). ✅ DONE (#256).**
Both table views now have brand + account avatar → Settings. Host already had it;
added the same to the solo nav (`user-btn` + `userInitials` + `SettingsPanel`,
switch/logout → main app). Footer shared in 2a. (Future polish: extract a single
shared header component / fold in inter-app nav.)

**Slice 2e — Kill the priming skeleton. ✅ DONE (#255).**
Replaced solo's faked `bp-ph-*` + rail skeleton with the real `BridgeTable` in
`:identity-only` mode (named seat chips, no hands), like the host's pre-deal
table. Removed the dead `bp-ph-*` / `bp-disabled` CSS; the empty state now matches
the live layout (fixed a report that the faked rail bidding box "looks like it's
in the rail").

**Slice 3 — Bidding-only mode (decision #3, functional).**
"Bidding only" is a **table/room MODE**, not a per-client front-end behavior — the
state machine is authoritative where it lives, and all clients must agree:

- **Server (`/tables/host`):** configure it on the **table-service (backend)** — a
  table-level flag (e.g. `mode: "bidding-only"` / `playAfterBid: false`) set at
  table create/config, alongside the existing deal-source / PassBot config. The
  backend then stops the shared state machine at auction-complete (board → ready
  for next, no play phase) and **never broadcasts cardplay commands** to the
  seated players / kibitzers / other tabs. Front-end just sends the flag and
  renders the resulting state — it does NOT locally "drop" the state machine
  (that would desync clients). Requires a change in the **`bridge-table-service`
  repo** (state machine + broadcast) plus a wire-contract field; capture the
  contract before wiring the UI.
- **Solo (`/bidding-practice`, LocalEngine):** no backend — here the *local* state
  machine honors the same flag (this is roughly today's `playCardplay` toggle:
  false → stop at auction-complete, ready for Next Deal).
- **RulesBot in solo cardplay:** BEN has its own service; RulesBot is currently
  called *locally by the table service*, so the solo (LocalEngine) front-end has
  no adapter. Surface it either as a **wasm** (`bridge-rulebot-wasm`) OR as a
  **BEN-style HTTP service** — either registers into `cardplayBots.js`. Until
  then it's shown **disabled ("RulesBot — coming soon")** in the solo pulldown
  (PR #255) so it reads as planned, not forgotten.
- **Bot seat names (both):** in bidding-only, name seats by the **bidding** engine
  only (`BBA`), dropping the cardplay suffix (`+Ben` / `+RulesBot`) since no
  cardplay bot runs. Server: the table-service assigns/ō reports seat bot identity,
  so the naming likely follows the backend flag too — confirm where seat bot names
  are sourced (`bots.rs` vs front-end derivation) as part of the contract.

So Slice 3 = one shared *toggle/UI* that maps to a **backend table flag** (server)
or a **local engine flag** (solo). Do the table-service side first (or in
lockstep) so the host toggle actually changes shared behavior.

**Slice 4 — Fold the CSS namespaces** (`tv-*` + `bp-*` → one `ts-*`), delete dead rules.

**Slice 5 — Collapse the branch (optional):** render `<TableShell>` once with
`v-if="server"` inside the slots.

---

## Full collapse + one route — decided 2026-07-23 (Rick)

The visual shell is unified (both routes render `TableShell`), but the two paths
are still **two live code paths in one file**: the server branch reads `srv.*`
(`useServerTable`, ~80 bindings) and the solo branch reads `engine.*`
(`useLocalEngine`). We're now finishing the job: **one interface, engine chosen
by state, at one URL** — the BBO model (same page; bots vs humans is just who's
seated).

**Two decisions that shape the work:**

1. **One `/table` route, mode chosen by state.** `/bidding-practice` and
   `/tables/host` go away. `/table` starts **local** (solo, LocalEngine, zero
   droplet cost) and **upgrades to server in place** when you host/invite or when
   you resume an owned open session. Because it's one route deciding its own mode,
   inviting is an in-place engine swap at the next board — no navigation.
2. **No back-compat.** Alpha, no real users, and these table views are the
   "replace freely" tier (only A1 is released). So: **delete** old routes and
   `TableHostView`; no redirects, no shims.

**Why keep the local default (not "everything on the service"):** a solo all-bots
table on the droplet holds a socket + session + server-side BBA/BEN bot compute
(BEN ~20s cold / ~500ms warm). LocalEngine runs all of that in the browser for
free, and today it *also* has richer analysis (BBA expected auction, divergence,
narrative) the server doesn't compute server-side — so routing solo through the
service would be both more load **and** a feature regression. Upgrade on invite;
never downgrade; never swap mid-hand (only at a board boundary).

### Prior-slice status (verified 2026-07-23, not just checkmarks)

- Slices **1, 2a, 2b, 2d, 2e** ✅ done; **2c** cancelled.
- Slice **3 (bidding-only) is HALF done**: the solo `playCardplay` toggle works;
  the **table-service flag does not exist** (grep for it in `bridge-table-service`
  is empty). In the collapse, the toggle is **capability-gated** — shown for
  LocalEngine, hidden for ServerEngine until the backend flag lands. Server-side
  bidding-only is a deferred follow-up, not a blocker.

### Staged sequence (URL-first, so invite-testing hits the target URL early)

Each stage is independently shippable and browser-verifiable on the real route.
The `server`-prop branch inside the view is kept until stage C, so routing (A/B)
lands the desired URL without also doing the ~80-binding template merge.

- **A — Session lifecycle → `useHostedTable` composable (pure refactor).**
  Lift create/resume-session, connect-as-owner, invite link, test-player spawn,
  handoff apply, end-table, and switch-user teardown out of `TableHostView` into a
  composable. No behavior change; `/tables/host` still works. This is what lets
  `/table` enter server mode conditionally.
- **B — One `/table` route, mode by state.** `/table` renders the view; local by
  default, server when `useHostedTable` reports an owned/created session. Hosting &
  "Invite friends" become in-place upgrades (no route jump). **Delete**
  `/bidding-practice`, `/tables/host`, `TableHostView`. Resolve the `/table` vs
  `/table/:inviteCode` collision (bare `/table` = your table; `/table/:code` +
  `/play/:code` = joins, still via `TableLobbyView` → server mode). **Invite-testing
  now uses the target URL.**
- **C — Grow `ServerEngine` to the host-management surface**, then **collapse the
  template** onto one `engine` (host controls gated on `engine.capabilities.seats`).
  Removes the `server`-prop branch and the `useServerTable` orchestration.
- **D — Cleanup:** fold `tv-*`/`bp-*` → `ts-*` (old Slice 4), and the table-service
  bidding-only flag (old Slice 3 server half).

## Constraints & risks

- **Do not touch `BridgeTable` / `GridArrangement` / `gridArranger.js` / the hand
  components.** They're the shared substrate and are also used by **A1 (released)**.
  This plan only restructures `BiddingPracticeView` + a new `TableShell`; A1 has its
  own view and is unaffected.
- **Embedded widget** (`EMBEDDED`, iframe `?pbn`) is a solo sub-mode — `TableShell`
  must support a chromeless variant. Regression-check it every slice from 2 on.
  (Known-good test URL is in memory: `reference_embedded_bidding_test_url`.)
- **Host session chrome stays in `TableHostView`** (`.th-controls`: Copy invite /
  Test players / End table). That's host-only session management *around* the shell,
  not part of it. Solo's `Invite friends` (convert-to-served) is the nearest analog
  and stays a solo `#actions` button.
- Namespace: use a neutral **`ts-*`** for the shared shell (avoids "tv = server"
  confusion). `tv-main`'s layout values are the canonical ones to copy.

## Verification (per slice)

Drive the real route(s), not just build:
- Slice 1: `/tables/host` — spawn Test players, deal, confirm unchanged.
- Slice 2–5: `/tables/host` **and** `/bidding-practice` **and** the embedded `?pbn`
  URL. The beetle's `screenshot-boxes` X-ray is the fast diff.

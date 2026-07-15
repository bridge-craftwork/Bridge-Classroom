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

## Slice plan

**Slice 1 — Extract `TableShell`, adopt in the server branch (pure refactor).**
Create `src/components/table/TableShell.vue` from the current `.tv-page` shell
(header + `.tv-main` + `.tv-rail` + toasts + card/btn CSS → `ts-*`). Server branch
renders `<TableShell>` with its markup in slots; **no behavior change**. Verify the
host table is pixel-identical. Ship.

**Slice 2 — Adopt `TableShell` in the solo branch.**
Solo renders `<TableShell embedded=…>`. Map: scenario **actions** → `#actions`;
scenario **name/meta** → `#notes`; `BridgeTable` → `#table`; Auction + Your-bid →
`#rail`. Add the `embedded` prop so the iframe `?pbn` widget still drops chrome.
This is the main design decision (scenario bar → header+notes). Verify solo **and**
embedded. Ship.

**Slice 3 — Kill the priming skeleton.**
Replace solo's placeholder hand (`bp-ph-*`) with the real `BridgeTable` in
`:identity-only` / no-deal mode, exactly as the host shows a pre-deal empty table.
Removes ~4 `bp-ph-*` blocks + CSS and makes the empty state identical. Verify the
solo no-deal state. Ship.

**Slice 4 — Fold the CSS namespaces.**
Delete the now-dead `bp-*` rules; migrate any solo-only bits (rotate toggle, bot
select, scenario meta) onto `ts-*` + small modifiers. One namespace. Verify both.
Ship.

**Slice 5 — Collapse the branch (optional polish).**
Render `<TableShell>` once; move the `v-if="server"` *inside* each slot so the
shell isn't duplicated. Leaves a single frame with server/solo slot content.

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

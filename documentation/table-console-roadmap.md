# Table diagnostics & controls — roadmap

Rick wants SharkBridge-console-style visibility and control over live
tables (screenshots reviewed 2026-07-02: Shark's teacher console with
Control Panel, per-table windows, student list, chat). This doc maps those
elements to our architecture and phases the work. Diagnostics are
URL-gated; controls are role-gated (teacher/owner) like the existing
console actions.

## Phase 1 — Diagnostics panel (DONE 2026-07-02)

`?debug=1` (any value) on any table route shows a read-only diagnostics
panel under the table ([TableDiagnostics.vue](../src/components/table/TableDiagnostics.vue)):

- Connection: status, session/table ids, identity, seat, bot mode, see-all.
- Board: seq, phase, dealer/vul, contract, turn, trick counts, current
  trick, my legal cards.
- Seats: occupant, connected/DISCONNECTED/bot, ready flags, hand counts.
- Protocol frame log: rolling last 100 ws frames both directions
  (useTableSocket records them always — cheap — so the welcome/snapshot are
  captured even though the panel mounts later). Bot plays show `via`
  (ben/rules/random), which is the client-side view of the server's
  `rulebot_decision` audit trail.
- "Copy state" puts a full JSON snapshot (state + frames) on the clipboard
  — the thing to paste into a bug report.

Works for players, guests, teachers, on the demo room and session tables.

## Phase 2 — Demo/table deal controls

The gap that bit on 2026-07-02: a completed demo board is a dead table
until service restart. Shark's `Next Deal` / `Replay Deal` equivalents:

- **New deal** (demo room): server action to re-deal (random or next in a
  small built-in set), resetting the action log. Open to any seated player
  on the demo room; teacher-gated on session tables (sessions already have
  `force_advance`).
- **Replay deal**: re-deal the SAME board (action log reset). Cheap — it's
  `truncate to 0` of the existing undo machinery.
- UI: buttons in the result panel / header, shown when phase == complete
  (and always for the demo room's seated players).

## Phase 3 — Teacher console parity (Shark Control Panel)

Existing: lobby grid, kibitz-any-table, open-round gate, boot/assign seat,
end session. Shark features to add, roughly in value order:

| Shark | Ours | Notes |
|---|---|---|
| Show All Cards | teacher kibitz already sees all; teacher's own "👁 all hands / my view" display toggle DONE 2026-07-02 (TableView header, persisted) | still todo: per-table "show all to STUDENTS" toggle (reveal event) for post-mortem teaching |
| Run Robots | per-seat `bot_takeover` request | teacher forces a bot to play a stuck/absent student's seat (zombie takeover exists; this is the manual trigger) |
| Stop play | pause flag on the room | bots stop acting, humans get "paused by teacher" |
| Swap Students | one-step reseat | needs `sub` in seats_json (known gap) |
| Load Deals / Deal Generator | PBN upload exists at session creation | add mid-session board-list append; generator later |
| Next Deal | `force_advance` exists | already in console |
| Classroom chat / Talk To | not built | server broadcast + per-table message frames; biggest new surface, do last |
| Auto-seat dropdown | seat policies exist (manual/one_per_seat/pairs/first_free) | expose as console control instead of create-time-only |

## Phase 4 — Bot/board options (Shark "Add tables" dialog)

Per-table/per-session toggles at creation (and later live): bot strength
(rules/BEN), bidding hints, disable undo/claim, stop-at-contract, hide
auction, bidding systems. Most map to a per-room options struct the server
already half-has (`BotMode`); add fields as features land.

## Design rules

- Diagnostics = URL parameter, read-only, available to anyone (it shows
  only what that viewer is already allowed to see — redaction happens
  server-side, so the panel can't leak hidden hands).
- Controls = explicit server-side authorization (session owner / teacher
  role), never hidden-UI-only.
- Every new control is a ws frame + server validation, mirroring
  open_boards/assign_seat/boot precedent in sessions.rs.

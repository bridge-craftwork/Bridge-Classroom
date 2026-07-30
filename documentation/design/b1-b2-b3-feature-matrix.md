# B1 / B2 / B3 — what turns on when

Answering Rick's 2026-07-30 question: *"compare B1 and B2, in terms of what turns on
when."* Read from the code at commit `7c73c28`, not from memory.

**The three surfaces**, all rendered by `BiddingPracticeView`:

| | what it is | engine | route |
|---|---|---|---|
| **B1** | solo practice table — you + three bots | `LocalEngine` | `/table` (no session) |
| **B2** | served table, **as host** | `ServerEngine` | `/table` (session), wrapped by `TableView` |
| **B3** | served table, **as invited guest** | `ServerEngine` | `/table/<session>` via `TableLobbyView` |

B2 and B3 are the *same* branch. Every difference between them is a permission
(`canManageSeats` / `canDeal` / `canHostAdvance`), not a different code path. B1 is a
genuinely separate branch, which is why it drifts.

---

## The matrix

| Feature | B1 (solo) | B2 (host) | B3 (guest) |
|---|---|---|---|
| DD table (SE, at review) | ✅ *(was ❌ — see 1)* | ✅ | ✅ |
| DD payload validity check | `hasDdTricks()` | truthy only *(see 2)* | truthy only |
| DD cardplay errors, post-hand | ✅ | ❌ *(see 3)* | ❌ |
| Claim | ✅ | ❌ *(see 4)* | ❌ |
| Undo | ✅ | ✅ host-only | ❌ |
| Restart deal / restart cardplay | ✅ | ❌ | ❌ |
| BBA compare (per-call) | ✅ | ✅ | ✅ |
| Bidding box | ✅ | ✅ when seated | ✅ when seated |
| Next board | ✅ | ✅ NW ⏭ | ❌ |
| Report a Problem | ✅ repo-backed deals | ✅ host-only *(see 5)* | ❌ |
| Table settings | full modal | merged modal | modal, host rows hidden |
| Seat management / kibitz | ❌ n/a | ✅ | ❌ |
| Scenario "Description" | ✅ | ❌ *(no `narrative` capability)* | ❌ |

---

## 1. The DD table never appeared on B1 — a one-word bug

Rick's example, and it was not a subtlety of *when*: it could not happen **at all**.

```js
// seSlot, solo path
if (capabilities.value?.doubleDummy && hasDdTricks(doubleDummy.value)) return 'double-dummy'
```

`LocalEngine` returns `capabilities: LOCAL_CAPABILITIES` — a **plain frozen object**,
not a ref. So `capabilities.value` is `undefined`, `undefined?.doubleDummy` is
`undefined`, and the branch was dead for every deal, however good the payload. The
same file reads it correctly twelve hundred lines earlier (`capabilities.narrative`
on the Description button); this one line disagreed with its own neighbour.

Ruled out the alternative by measurement first: posted the bundle's exact deal to the
solver, which returned a valid 20-char payload (`cached: true` — computed during
Rick's own session). So the data was there and the gate was throwing it away.

Fixed. B2/B3 were never affected because the served branch reads `srv.capabilities`
without `.value` (`srv` is a `reactive()` unwrap).

## 2. The two DD gates disagree about what "valid" means

- B1: `hasDdTricks(dd)` — requires ≥20 characters.
- B2/B3: `srv.doubleDummy` — truthy.

`ddTrickAt` returns **0** for any character it cannot read, so a truncated payload on
the served path renders a full grid of confident zeros: a table claiming every
contract makes nothing. `hasDdTricks` exists precisely to prevent that, and its own
comment says so. The served path should use it too. **Not yet changed** — it needs a
served table with a bad payload to confirm the symptom rather than assume it.

## 3. DD cardplay errors are structurally solo-only

Every gate reads `cardplayPhase`, which is derived from `useCardPlay` — the **solo**
cardplay module. On a served table the *server* drives the play, so that module never
leaves its idle state and the overlay can never fire. `showDdErrors` is a real,
persisted setting that simply does nothing there.

The blocker underneath is data, not gating: DD cardplay analysis needs the **full
ordered play line**, and `useRemoteTable` keeps only `currentTrick` +
`lastFinishedTrick`. It would need client-side accumulation of `card_played` (plus the
history in the snapshot, for rejoin) or a server-side record. Roadmap §5.4.

This is why the served Table settings modal deliberately omits that toggle.

## 4. Claim is absent from the served path by construction

B1 renders `ActionCluster` with `:show-claim` when `seSlot === 'cardplay'`. The served
path renders `ActionCluster` only when `srv.canManageSeats` (so B3 gets none at all)
and **never passes `show-claim`** — so even the host sees only Undo.

It isn't an oversight in the view: `grep -i claim` across **bridge-table-service**
returns only "reclaims seat". There is no claim concept on the server. Adding it means
a wire message, a validation policy (B1 asks the cardplay bot, then offers "override &
claim anyway"), a way for the other humans to accept or dispute, and trick
bookkeeping. Roadmap §5.3 — filed twice by David, because the gap reads as a bug every
time when solo has it.

## 5. Report a Problem is host-only on a served table

The button needs a repository-backed deal (a single scenario ref with a mappable repo
plus a board identity). On a served table the deal source belongs to the **host**; a
guest's local selection is empty, because the service broadcasts a set **label**, not
the repo/file identity a report needs. Stated as a limitation, not hidden.

---

## The pattern worth naming

Every drift in this table has the same origin: **B1 and B2 are two branches of one
component, and a feature added to one is not added to the other.** The `TableEngine`
contract (`capabilityGaps`) was built to make exactly this diff explicit, but the
*view* still gates on engine-specific internals — `cardplayPhase` (a solo module),
`capabilities.value` (wrong shape for one engine) — instead of on the capability set.

Two cheap follow-ups, in order of value:

1. **Make `capabilities` the same shape from both engines.** The `.value` bug was
   possible only because one engine hands back a plain object and the other a
   `reactive()` unwrap. One shape, and that class of bug disappears.
2. **Gate on capabilities, not on module internals.** `cardplayPhase` should not be
   what decides whether an overlay renders on a table the local cardplay module isn't
   driving. A `capabilities.cardplayAnalysis` flag would say the true thing.

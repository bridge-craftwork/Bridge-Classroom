# Full defensive play-out (student defends as South) — feasibility investigation

Branch: `defender-playout-investigation` (not pushed).
Goal: can the app run a **full** defensive play-out where the student defends
the whole hand as South — playing every card, with a mis-play reverted and the
correct card substituted, then continuing — "the same model the declarer-play
lessons already use"?

## TL;DR

- **That model does not exist yet — for *either* side.** The declarer-play
  lessons (e.g. `Establishment.pbn`) are **scripted NEXT-click narratives**, not
  interactive play-outs. `[PLAY seat:card]` is a *declarative display* tag that
  drops a card on the table as the student clicks NEXT; the student never plays
  every card and nothing is graded or reverted in those lessons.
- The only **graded** card interaction in lessons today is a single
  `[choose-card]` (opening lead / one defensive card), which is one-shot — it
  records the miss and advances; it does **not** revert-and-retry.
- The task's described format `[PLAY 3 S \HQ]` (trick / seat / card, used as a
  per-decision grading marker) **is not implemented anywhere.** The parser only
  understands `[PLAY <seat>:<card>]` (e.g. `[PLAY W:D9]`) and only uses it to
  show cards, never to grade.
- A **real** trick-by-trick engine *does* exist — `useCardPlay.js` — and it
  already supports the student sitting in **any** seat including South-as-
  defender (declarer E/W), full 13-trick play, legal-move enforcement, dummy
  reveal, trick winners, claims. But it is **bot-driven with no grading/revert**,
  and it is wired into the *bidding-practice* view, not the lesson view.

So enabling the requested feature is **not** "extend the declarer-play grading
to defenders" (there is nothing to extend). It is net-new work: add a
grading + revert-and-correct layer and a way to script the opponents. The
**smallest** path is to add a coaching mode to `useCardPlay.js` (prototyped on
this branch and unit-tested) and then wire it into the lesson view.

---

## 1. How the two systems actually work

### A. Lesson / coaching engine — `useDealPractice.js` (+ `MainLayout.vue`)

The PBN parser (`src/utils/pbnParser.js`) reads each board's `{…}` commentary
and splits it into an ordered **steps** array on the *interactive* control tags
`[BID]`, `[NEXT]`, `[ROTATE]`, `[choose-card]`. Everything else is *declarative*
and attached to the current step:

| Tag | Meaning | Effect |
|-----|---------|--------|
| `[show NS]` / `[show ALL]` | reveal seats | sets which hands are visible |
| `[PLAY W:D9]` | **display** a played card | `updateVisibilityAndPlays()` removes it from the hand and shows it on the table |
| `[choose-card HK]` / `[choose-card any:S9,S4]` | **graded** single card | the one place a click is checked |
| `[SHOW_LEAD] [AUCTION off] [showcards …] [RESET]` | display toggles | — |

Key facts:

- `[PLAY]` is purely visual. `updateVisibilityAndPlays()` (useDealPractice.js
  ~L403) walks `step.plays`, parses `^([NESW]):([SHDC])(.+)$`, and pushes the
  card into `playedCards` so it renders as already-played. **No turn order, no
  legality, no grading.**
- The student seat comes from `[Student "X"]` → `studentSeat` (any seat).
- Grading happens only in `makeCardChoice()` (useDealPractice.js ~L592): it
  compares the clicked card to the step's `chooseCard`, records the result,
  marks the step answered, and **calls `advance()` regardless of right/wrong**.
  There is no "put it back and try again" — the wrong card is recorded, the
  correct one is shown in feedback, and the lesson moves on.
- `MainLayout.vue` makes exactly one seat clickable, and only during a
  choose-card step:
  ```
  :clickableSeat="practice.hasCardChoice.value ? practice.studentSeat.value : null"
  @card-click="onCardClick"   // → practice.makeCardChoice(suit, rank)
  ```

So the lesson engine can grade **one** card per `[choose-card]` step. It has no
concept of a multi-trick play-out, opponents that auto-play, or revert.

### B. Cardplay engine — `useCardPlay.js` (+ `BiddingPracticeView.vue`)

A genuine trick-by-trick state machine:

- `startPlay({ hands, contract, declarer, bot, userSeats, … })`. Seats are
  derived correctly: `dummySeat = declarer+2`, `openingLeader = LHO(declarer)`.
- `userSeats` is arbitrary — **South-as-defender already works** structurally:
  pass `declarer:'E'`, `userSeats:['S']` and South is a clickable defender while
  N/E/W are bots.
- `currentPlayer`, `clickableSeat`, `hiddenSeats` (dummy revealed after the
  lead), `legalCardsForCurrent`, `trickWinner`, `tricksTaken`, claims.
- `onUserCard()` enforces legality, records the play, then `advanceBotsIfTheirTurn()`
  drives every non-user seat via the pluggable bot (`RandomLegalBot` / `BenBot`).

What it lacks for coaching: **no notion of a "correct" card, no revert, no
scripted opponents.** It just lets the user play any legal card and the bot
answers. It is also not used by the lesson view at all.

### Seat assignment summary

| | Declarer-play lesson (`Establishment`) | Defense lesson (`OLead`) | Cardplay engine |
|---|---|---|---|
| Student seat | `[Student "S"]` | `[Student "W"]` (the leader) | any (`userSeats`) |
| Declarer | S | S | any |
| Student plays | nothing (clicks NEXT) | **one** card (`choose-card`) | every legal card |
| Grading | none | one-shot, no revert | none |
| Opponents | scripted display | n/a (1 card) | bot |

---

## 2. What's missing for a full South-defends play-out with revert-and-correct

Concretely, four gaps:

1. **Scripted opponents.** Need N/E/W to play a *known* line, not a bot, so the
   lesson is deterministic and matches the author's intended defense. (Bots are
   non-deterministic and may not cooperate with the teaching point.)
2. **Per-card grading.** Need to compare each South click to the expected card.
3. **Revert-and-correct.** A wrong (but legal) card must not be recorded; the
   correct card must be surfaced so the UI can flash the mistake and show the
   fix, then let the student continue.
4. **Authoring + wiring.** A PBN representation that carries the full line and
   marks South's graded cards, a parser path for it, and a lesson-view component
   that drives `useCardPlay` instead of the static `[PLAY]` display.

The cleanest place to put 1–3 is **inside `useCardPlay.js`**, because seating,
turn order, legality, dummy reveal, and trick logic are already correct there.

---

## 3. Prototype on this branch (engine layer, unit-tested)

Implemented a contained **coaching mode** in `useCardPlay.js`:

- `startPlay({ …, coachLine })` — `coachLine` is the full chronological line
  `[{seat,suit,rank}, …]`.
- In `advanceBotsIfTheirTurn()`: when `coachLine` is set, **non-user seats play
  straight from the line** (no bot call); user seats pause for a graded click.
- In `onUserCard()`: the click is graded against `coachLine[played.length]`. A
  miss returns `{ ok:false, reason:'incorrect', expected }` and **is not
  recorded (reverted)**; `lastCoachMiss` is set for the UI to flash. A match is
  recorded and play advances. New `coachExpected` computed exposes the card the
  student should play now (for highlight / auto-correct).

This is ~30 lines, fully behind the `coachLine` flag — when it's absent the
engine behaves exactly as before (existing 14 cardplay tests still pass).

New test `src/composables/__tests__/useCardPlay.coach.test.js` proves it end to
end: **student South defends all 13 tricks vs declarer East**; on each trick a
wrong legal card is rejected and reverted (nothing recorded), the correct card
is then accepted, and N/E/W auto-play from the line until South is on lead
again. Final state: 13 completed tricks, South's 13 cards exactly equal the
scripted line. ✅

```
✓ useCardPlay.coach.test.js (1 test)         # revert + correct, full hand
✓ useCardPlay.test.js (14 tests)             # unchanged behavior
```

### Chosen UX: swap-and-explain (with a note)

Decision (David): on a wrong card, the wrong card flashes, slides back, the
**correct card is substituted, play continues, and a short note explains why**.
The note shows on correct plays too, as a confirmation.

This is now the engine **default** (`coachAutoCorrect: true`):

- Each `coachLine` entry may carry a `note` string.
- A wrong click sets `lastCoachMiss`, records the **correct** card (substitution),
  sets `coachNote = { corrected:true, card, wrong, text }`, and returns
  `{ ok:true, corrected:true, expected, note }`. The UI flashes `wrong`, then
  shows `card` + `text`.
- A correct click sets `coachNote = { corrected:false, card, text }` so the same
  explanation panel shows a confirmation.
- `coachAutoCorrect: false` keeps the stricter "reject until the student finds
  it" model (still available, same hook).

Covered by a second test (`SWAP-AND-EXPLAIN (default)`): a wrong card is
swapped for the correct one, the note (`"…keeps communication…"`) is surfaced,
and South still ends up having played exactly the scripted line. 16/16 tests
pass.

### Sample authoring file

`docs/sample-defender-playout.pbn` — a machine-verified-legal sample showing a
**proposed** `[PlayOut "<leader>"]` tag: one line per trick, four cards in play
order, the student's graded card marked `*` with its `{note}`. The parser would
turn this into the engine's `coachLine`. This is the piece closest to the
dealer-style notation work and is the natural place to start the authoring
design.

---

## 4. Smallest change to ship it (beyond the prototype)

The engine change above is the hard part and it's done. Remaining work, smallest
first:

1. **Authoring format.** Decide how a defender lesson carries the line. Two
   options:
   - *Reuse the existing `[Play "X"]` + a card list* the PBN already encodes a
     played sequence in some boards; extend the parser to collect the full
     ordered line and the student seat from `[Student "S"]`.
   - *Or* a new compact tag block, e.g. one `[LINE …]` per board listing the 52
     cards in order, with the student's graded cards implied by `[Student]`.
     (The task's `[PLAY 3 S \HQ]` per-decision form could be parsed into the
     same `coachLine` + "graded at these indices" structure.)
   This is a localized addition to `pbnParser.js`.
2. **Lesson view wiring.** In the lesson view, when a board is a "full play-out"
   board, call `useCardPlay.startPlay({ declarer, hands, userSeats:[studentSeat],
   coachLine })` and render with the existing `BridgeTable`/`HandDisplay`
   (already used by `BiddingPracticeView`). Make South clickable; on a returned
   `incorrect`, flash `lastCoachMiss`/`coachExpected`. Most of this is reusing
   `BiddingPracticeView`'s existing cardplay UI in the lesson context.
3. **Scoring/observations.** Feed misses into the existing observation pipeline
   (mirror `makeCardChoice`'s `recordBoardObservation`), so defender play-outs
   show up in progress the same way bid/choose-card boards do.

Rough size: parser + a thin lesson-view cardplay panel + observation hookup.
Days, not weeks — and no change to the already-correct trick engine.

---

## 5. Risks / watch-outs

- **Two engines, two UIs.** Lessons use `useDealPractice` + `MainLayout`;
  cardplay uses `useCardPlay` + `BiddingPracticeView`. Bringing the real engine
  into lessons means either embedding the cardplay panel in the lesson view or
  factoring the table UI out. Pick one deliberately to avoid a third code path.
- **Both are module-level singletons.** `useCardPlay` and `useDealPractice` hold
  global state. A board that mixes bidding/choose-card steps *and* a full
  play-out will need careful reset/handoff between the two singletons.
- **Determinism.** Coaching mode must script opponents (done). Do **not** fall
  back to the bot for opponents mid-line — it breaks the teaching point and
  reproducibility. (BEN is also slow/networked.)
- **Legality vs. the line.** A hand-authored line must itself be legal; the
  engine still validates, so a bad line will surface as a stuck seat. Worth a
  one-time validator over authored lines (replay the line through `isLegalPlay`).
- **"Revert" UX choice** (reject vs. flash-then-substitute) should be agreed
  with the lesson author before building the feedback UI — see the note in §3.
- **Defense lessons currently seat the student at the *leader* (`[Student "W"]`).**
  The goal asks for **South** as the defender with declarer **E/W**. The engine
  handles any seat; just make sure authored boards set `[Student "S"]` and a
  declarer of E or W, and that the table renders South at the bottom as usual.

## Files touched on this branch

- `src/composables/useCardPlay.js` — added `coachLine` mode (scripted opponents
  + graded, revertible student clicks; `coachExpected`, `lastCoachMiss`).
- `src/composables/__tests__/useCardPlay.coach.test.js` — new end-to-end test.
- `docs/defender-playout-investigation.md` — this report.

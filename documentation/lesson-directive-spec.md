# Lesson Directive Specification

**Who this is for:** anyone who authors a PBN lesson that Bridge Classroom renders —
today that's **Baker Bridge** and **David Bailey's Practice-Bidding-Scenarios**, and
any future collection. It is the normative reference for the in-board **directives**
that drive what the app shows and what it asks the student to do.

**What it is:** the complete, authoritative list of the control directives the
renderer recognizes inside a board's coaching comment, the exact effect each one has
on the rendered table, and the authoring rules you must follow so the rendered state
always matches what your prose says.

**Ownership.** These directives are **Bridge-Classroom-owned** — the renderer defines
their syntax and semantics. This document tracks the renderer
([`src/utils/pbnParser.js`](../src/utils/pbnParser.js) and its consumers); if the two
ever disagree, the renderer is the truth and this doc is the bug. Producers do not
invent directives; you adhere to this spec.

**Relationship to the producer contract.** The
[Collection Producer Contract](./adr/collection-producer-contract.md) obligation **R6**
is "adhere to this specification." R1–R5 there govern *identity, release, and
tracking*; this spec governs *rendering fidelity*.

---

## 0. The one-paragraph version

The app is a **dumb renderer**: it shows exactly what your directives say, with no
fallbacks and no inference from lesson type. So the burden is on the PBN to describe
the *complete* visible state. In particular, for **play lessons**: every card your
prose says has been played must be accounted for by a directive — `[showcards]` puts a
card **on the table** (the current, in-progress trick), and `[PLAY]` **strikes through** a
card in a hand (a card played to an *earlier*, gathered trick — kept visible for history). If your prose says a whole
trick has been played, all four of that trick's cards must be accounted for. If you
skip this, the table silently shows a stale or partial position that contradicts your
own text.

---

## 1. The renderer principle (why this spec exists)

From the project's foundational rule:

> The PBN provides explicit instructions; the app follows them. If something needs to
> be shown or hidden, the PBN says so explicitly. The app doesn't try to be smart about
> what "should" be visible based on lesson type.

Concretely, the renderer never:

- infers that a trick was played because your prose mentions it,
- guesses which cards left a hand, or
- decides on its own which card sits on the table.

It only reacts to the directives below. An omitted directive is not "filled in" — it is
simply absent from the render.

---

## 2. Notation

**Seats** are the single letters `N`, `E`, `S`, `W`.

**Cards** are written `<suit><rank>`:

| Part | Values |
|---|---|
| suit | `S` ♠ · `H` ♥ · `D` ♦ · `C` ♣ |
| rank | `A K Q J T 9 8 7 6 5 4 3 2` — write the ten as `T` **or** `10` (the parser normalizes `10`→`T`) |

**Seat-scoped card lists** are written `SEAT:CARD` and, for multiple cards in one seat,
`SEAT:CARD,CARD`. Multiple seats are separated by spaces **or** commas:
`[showcards W:SK E:S7 S:S5]` and `[PLAY N:C4,E:CT]` are both valid. (Cards *within* a
seat stay comma-joined; the split that separates seats keys on the `SEAT:` prefix, so a
bare card like `D7` never triggers a new seat.)

---

## 3. The step model

A board's coaching comment (the `{ … }` block) is parsed into an ordered list of
**steps**. Two kinds of tag:

- **Interactive control tags** *split* the comment into steps — the student must act to
  advance past one:
  - `[BID x]` — a bidding-quiz step (student enters a call).
  - `[choose-card X]` — a cardplay step (student clicks a card).
  - `[NEXT]` — an advance-on-click step (no answer required).
  - `[ROTATE]` — like `[NEXT]`, used where the view rotates seats.
- **Declarative tags** *attach as properties of the step they sit in* — they change what
  is shown when that step is active. These are cumulative as the student advances (each
  step's declaratives apply on top of prior steps), except where noted.

Prose before/around a control tag is that step's displayed text. A board with **no**
control tags is a display-only deal (no interaction).

---

## 4. Directive reference

### 4.1 Interactive (step-splitting)

| Directive | Syntax | Effect |
|---|---|---|
| `[BID x]` | `[BID 3NT]`, `[BID 4S]` | Bidding-quiz step. Text *before* the tag is the prompt; text *after* (until the next control tag) is the post-answer explanation. The `x` is the recorded correct call. |
| `[choose-card X]` | `[choose-card D2]` · `[choose-card any:DK,DA]` | Cardplay step; blocks until the student clicks a correct card. `any:` lists several equally-correct cards. |
| `[NEXT]` | `[NEXT]` | Advance-on-click; ends the current step, no answer required. |
| `[ROTATE]` | `[ROTATE]` | As `[NEXT]`, for seat-rotation views. |
| `[ACCEPT call …]` | `[ACCEPT 4S Pass]` | On a `[BID]` step, extra call(s) scored correct alongside the recorded one (judgment boards with more than one defensible call). Multiple tags accumulate. |

### 4.2 Visibility

| Directive | Syntax | Effect |
|---|---|---|
| `[SHOW seats]` | `[SHOW N]` · `[SHOW NS]` · `[SHOW NESW]` · `[SHOW ALL]` | Reveal whole hands for the named seats. Any combination of `N E S W` (order irrelevant); `ALL` = all four. Cumulative across steps. |
| `[showcards SEAT:CARD,…]` | `[showcards N:D5]` · `[showcards W:SK E:S7]` | Reveal **specific cards** and place them **on the table** as played cards of the current trick. See §5. |
| `[SHOW_LEAD]` | `[SHOW_LEAD]` | Display the opening-lead card label (from the `[Play]` section's first card). |
| `[AUCTION on\|off]` | `[AUCTION off]` | Show/hide the auction table for this step onward. |

### 4.3 Cardplay state

| Directive | Syntax | Effect |
|---|---|---|
| `[showcards SEAT:CARD,…]` | `[showcards N:D5]` | **Current trick.** Puts the card(s) on the table. If the seat is a *hidden* hand (e.g. the opening leader), the card floats in the trick as a lone played card. If the seat is a *shown* hand (e.g. **dummy** leading, or the hero's own led card), the card is placed on the table **and highlighted (light-blue background) in that hand** — a current-trick highlight, distinct from the strikethrough that marks *finished*-trick `[PLAY]` cards. |
| `[PLAY SEAT:CARD,…]` | `[PLAY N:SQ,E:S8,S:S3]` | **Earlier tricks.** Marks card(s) as played; they render **struck-through in the hand** (kept for history — the board keeps its full size) and are **not** placed on the table (the trick is gathered). Cumulative across steps. |
| `[RESET]` | `[RESET]` | Restore the original deal — clear all `[PLAY]` marks; every hand's cards render un-struck again. |

### 4.4 Commentary

| Directive | Syntax | Effect |
|---|---|---|
| `[clear-commentary]` | `[clear-commentary]` | Clear previously displayed commentary text before showing this step's text. |

---

## 5. Cardplay-state rules (normative)

This is the section the rest of the spec exists to support. A play lesson's prose
routinely narrates cards that have already been played ("Partner led the ♠J, won by
dummy's ♠Q; the ♦5 is now led from dummy"). The renderer will **not** reconstruct that
position from the prose. You must express it with directives, and which directive
depends on **which trick the card belongs to**.

### R-CP1 — The rendered table must match the prose

If your prose states that a card has been played, the board's directives must reproduce
that fact in the render. A card the prose calls "played" must not still be sitting in a
hand, and the trick the student is asked to act on must actually be on the table.

### R-CP2 — Current trick → `[showcards]` (on the table)

The cards of the **in-progress trick** — the one the student is responding to — go on
the table with `[showcards]`, one entry per card played to that trick so far, **in
seat order of play**.

- A card led from a **hidden** hand (the opening leader, or declarer leading from hand)
  floats on the table.
- A card led from a **shown** hand — most importantly **dummy** — is expressed exactly
  the same way: `[showcards N:<card>]`. Because dummy is a shown seat, the renderer
  places it on the table **and highlights it (light-blue) in dummy's hand** — a
  current-trick highlight, not the strikethrough used for finished tricks. Leaving it
  out is the single most common defect (see §6).

### R-CP3 — Earlier completed tricks → `[PLAY]` (struck-through in hands)

Cards played to **prior, gathered tricks** are marked with `[PLAY]`; they render
**struck-through in their hand** and are **not** placed on the table. The struck card
stays visible, so the board keeps its full size and the played history is legible —
the student can see which cards the prose already spent — without cluttering the table
with cards from a finished trick. (`[PLAY]` does **not** remove the card from the hand;
live *declarer* play removes cards through a separate engine path, not `[PLAY]`.)

### R-CP4 — A whole played trick is accounted for in all four hands

If the prose says a **complete trick** has been played, every one of its four cards must
be accounted for — one from each hand — via `[PLAY]` (for a gathered earlier trick). You
may not represent a completed trick by only its opening-lead card and leave the other
three cards sitting in their hands; that renders a table one full trick out of step with
the story.

---

## 6. Worked example — the defect this spec prevents

`SecondHand.pbn` board 1 (a second-hand-play defense lesson). The prose:

> Partner led the ♠J, won by dummy's ♠Q. The ♦5 is now played from dummy. What do you
> play? `[choose-card D2]`

The **intended** state: trick 1 (♠J ♠Q ♠x ♠x) is complete; dummy has led the ♦5 to
trick 2; East is second hand to play.

The board shipped with only:

```
[showcards W:SJ]
```

That places the **opening lead ♠J** on the table — a card from the *completed* trick 1 —
and never places dummy's **♦5**, the card East must actually respond to. The rendered
table was one full trick stale and contradicted the prose. (Reported via the A1 bug
beetle, 2026-07-13; routed as Baker-Bridge#12.)

**Correct** per §5:

```
[showcards N:D5]
```

— dummy's ♦5 (a card from the shown North hand) is placed on the table and highlighted
(light-blue) in dummy's hand (R-CP2); trick 1 is history, narrated in prose, and its
cards need not sit on the table. Optionally, if you want trick 1's cards visibly struck through in the hands
rather than merely un-mentioned, add `[PLAY …]` for them (R-CP3/R-CP4) — but the card
the student responds to, the ♦5, must be on the table either way.

The renderer already supports a card led from dummy; the app source even annotates this
exact case as *"a lesson-content gap, not an app one"*
([`src/views/MainLayout.vue`](../src/views/MainLayout.vue), the grid trick composition).

---

## 7. Anti-patterns

- **Showing only the opening lead for a mid-play position.** `[showcards W:SJ]` when the
  student is acting at trick 2+. Use `[showcards]` for the *current* trick's cards and
  `[PLAY]` for the earlier ones.
- **Omitting a dummy-led card** because dummy is already shown. A shown seat still needs
  `[showcards N:<card>]` to move that card onto the table.
- **Unmarked spent cards.** Prose says a card was played, but no `[PLAY]`/`[showcards]`
  marks it, so it renders as a normal (un-struck, playable-looking) card in the hand.
- **Half a trick.** Narrating a complete trick but only expressing one or two of its four
  cards (R-CP4).
- **Relying on lesson type.** Assuming the app will "know" this is second-hand play and
  arrange the table accordingly. It will not; only directives arrange the table.

---

## References

- [Collection Producer Contract](./adr/collection-producer-contract.md) — R6 points here.
- Renderer source of truth: [`src/utils/pbnParser.js`](../src/utils/pbnParser.js),
  [`src/composables/useDealPractice.js`](../src/composables/useDealPractice.js),
  [`src/views/MainLayout.vue`](../src/views/MainLayout.vue).
- [Developer guide](./developer-guide.md) — informal directive notes (this spec supersedes them).

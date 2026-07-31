# DoubleDummyTable — making it a real component

Brief from Rick, 2026-07-30, prompted by noticing it is absent from
`/dev#components`.

## Why it's missing from the gallery (measured, not guessed)

It **is** a real component — `src/components/DoubleDummyTable.vue`. It is simply not
in `src/harness/registry.js` and has no specimens.

The timeline explains it, and it isn't "borrowed code":

| | date |
|---|---|
| `DoubleDummyTable.vue` extracted (`refactor(analysis): extract engine-agnostic hand-analysis overlay (P1)`) | **2026-07-05** |
| harness registry created (`feat(harness): Slice 2 — minimum-viable Tier-1 component gallery`) | **2026-07-07** |

It was extracted **two days before the gallery existed**, and never backfilled.

## Is that why it doesn't scale? Not directly — but the gallery would have caught it

Being in the gallery does **not** predict scale-awareness. Audited across all
registered components:

| honours `--table-scale` | does not |
|---|---|
| HandDisplay, SeatChip, SeatPanel, AuctionTable, BiddingBox, StatusStrip, SeatIndicator | BridgeTable*, BoardIndicator†, RailCard, DealControls, ActionCluster, ScenarioBar |

\* BridgeTable is the container that *sets* the vars.
† BoardIndicator uses a **different, legitimate** mechanism — an explicit `size` prop
(default 130) driving its SVG.

The real split is by **role**: table *content* scales, *chrome/controls* don't. And
that is what makes DD the anomaly — it is table content (a data grid you read, exactly
like AuctionTable, which has 28 `--table-scale` references) but uses **neither**
mechanism. Plain fixed px. It is the only grid-region content that cannot respond to
its allocation.

So the gallery isn't what enforces scaling — but it is where you'd have *noticed*: a
specimen rendered at 0.65 / 1.0 / 1.32 would have shown it stubbornly flat on day one.
That is the argument for adding it, beyond tidiness.

## The work

Five items, and they interact — which is the main reason to plan before coding.

1. **Register it** — `registry.js` + specimens. Specimens should include the scale
   sweep (0.65 / 1.0 / 1.32) that would have caught the flatness, plus each of the
   display modes below.

2. **Honour `--table-scale`.** Prerequisite for roadmap §6.1: the corner-cap decision
   (DD tracks the seats) has *no visible effect* until this exists, because the
   component discards the scale the arranger computes. Measured: the table renders
   121px at `--table-scale` 1, 1.32, 2 and 0.65 alike.

3. **Collapse identical rows.** Today it is always 4 rows (N/S/E/W) × 5 strains. When
   a partnership's two rows are identical — the common case — show one **NS** row and
   one **EW** row. Roughly halves the height in normal use.

4. **Rotate when narrow.** Directions across the top, strains down the side. Inverts
   the aspect ratio: a wide-short table becomes narrow-tall, which is what a starved
   corner actually wants.

5. **Par contract + score**, param-driven options (added by Rick after the initial
   list).

## The one thing that needs care

**`doubleDummyReservePx()` must become shape-aware.** It currently returns a single
constant — `DD_COMPACT_MEASURED_PX (120) + 6` — measured from the one layout that
exists today. Items 3, 4 and 5 each change the footprint:

- collapsed rows → shorter
- rotated → narrower and taller
- par/score → an extra row or line

The arranger provisions the corner from that number, so a component that can render
in four shapes while the reserve reports one will mis-provision in three of them.
This is exactly the trap §6.2 hit with the auction: `auctionReservePx()` provisioned a
*normal* auction, so compare mode systematically under-reserved. The fix there was to
make the reserve take the mode as an argument and have the **shell** — which knows what
it is placing — supply it. Same pattern applies here.

Sequence that keeps each step verifiable:

1. register + specimens (baseline visible in the gallery)
2. `--table-scale` (unblocks §6.1; specimens prove it at three scales)
3. collapse rows, then rotate — each with a reserve variant and a specimen
4. par/score last, as additive options

Doing 2 before 3-4 matters: once the component scales, the reserve work can be
measured against a stable 1.0× natural rather than a moving one.

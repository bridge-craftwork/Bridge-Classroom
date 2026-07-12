# BiddingBox glyph-ratio restyle

**Location:** `documentation/design/biddingbox-glyph-restyle.md`
**Status:** Proposed (2026-07-11)
**Companion:** `grid-arranger-spec.md` (§3 reserve-driven allocation — this restyle
re-exports the BiddingBox reserve the allocator consumes)

## Why

The bidding box is fixed-width (~308px at 1.0×) with small glyphs — the rank/strain
symbols sit well under half the button height. In the grid arranger's budget
allocation that 308px reserve starves the stage column at the primary teaching
viewport (laptop-half): the priority rule keeps the hand at 1.0× by compressing the
periphery, but the box (and status) land around 0.74×. An honestly narrower box
with **bigger** glyphs both reads better on its own and returns ~90px to the stage.

## What (the restyle)

- **Keep the outer button dimensions and ≥44px touch targets.** Buttons don't
  shrink below a comfortable tap; where the visual box is smaller than 44px the
  **hit area** is extended to ≥44px (transparent padding / `::after`, no layout
  cost — the same technique as the card-selector `+N` chip).
- **Raise glyph size relative to the button box.** Target: rank/strain glyphs
  **~55–60% of button height** (currently well under half), achieved by tightening
  the glyph's internal padding — the number/suit fills more of its button.
- **Reduce inter-button gaps and container padding** to produce an **honestly
  narrower natural form**. This — not scaling the box down — is what makes it
  narrow while keeping tap targets full size.
- **Re-export the reserve.** The box's natural width is the single source the grid
  arranger reads (like `handMetrics`/`auctionMetrics`); export it and expect the
  reserve to fall **~308 → ~220px**. The arranger's `BOX_RESERVE` becomes an import.

## Production-shared — this is a named visible change on a1

BiddingBox renders in the **current bands layout too** (Scenario Mastery, the
Practice Tables), so its appearance changes there, not only in the dark grid. Per
the Rules of Engagement this is a **visible slice** with a test-deploy gate:

- **Before/after specimens** at all four component-gallery widths
  (`tile 160 · narrow 240 · panel 320 · drill 480`) × three scales (`1 · 1.25 ·
  1.5`) in the PR — the box is fixed-width, so the point is the glyph ratio and the
  new natural width, shown side by side with today's.
- **Touch-target audit at tablet** — confirm every button's effective tap area is
  ≥44px at 1.0× on `tablet-landscape`/`tablet-portrait`.

## Acceptance

- At **laptop-half bidding, post-restyle**, the periphery tier's ledger scale
  (`se`, `nw`) rises **above 0.85×** (from ~0.74×) — read from the arranger's
  `*.ledger.json`.
- Glyphs **at that scale** are **no smaller than today's at 1.0×** — the bigger
  glyph ratio offsets the compression, so legibility net-improves even where the
  box compresses.
- Re-exported reserve is the number the arranger imports; no hardcoded `308`
  survives.

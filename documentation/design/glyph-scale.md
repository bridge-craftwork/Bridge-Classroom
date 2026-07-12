# Unified glyph scale (game typography rule)

**Location:** `documentation/design/glyph-scale.md`
**Status:** Proposed (2026-07-11)
**Governs:** AuctionTable, BiddingBox, HandDisplay (reference), StatusStrip — every
component that renders game glyphs (calls, ranks, level/strain labels, suits).

## The rule

**Game glyphs share one type scale.** At **equal region scale**, an auction call, a
hand rank, and a bidding-box level/strain label render at **comparable size**. A
number is a number wherever it appears on the table.

- **Reference standard: hand-rank typography.** Family `'Segoe UI', system-ui`,
  weight **~500 (medium)**, size **~24px at `--table-scale: 1.0`**. Auction calls
  and BB numerals match this — same family, same weight, same size. (This retires
  per-component bolding and the ad-hoc 18px/34px sizes.)
- **Suit symbols render at 100% of companion text character extents** — the full
  cap-to-baseline height of the digits they sit beside, not a fraction of it. This
  applies everywhere for consistency, but the **binding rationale is the auction**:
  there, suits are *read*, not recognised by position, so spade/club discrimination
  at call-glyph size is a comprehension requirement (the direct user complaint).
  Hands and BB identify suits positionally and would tolerate less, but **one
  constant beats two**.

## Why "at equal region scale"

The arranger scales each region independently (§3 of `grid-arranger-spec.md`): a BB
compressed to 0.74× renders smaller than a hand at 1.0×, and that's correct — the
budget said so. The rule is about the **intrinsic** type scale each component
declares at 1.0×; the region scale then multiplies uniformly. So "comparable size"
is judged at equal `--region-scale`, and the ledger's per-region scale explains any
on-screen difference.

## Consequences (tracked as separate items)

- **AuctionTable** — call glyphs up to the reference (from ~18px); suits to the
  cap-height rule; header band compressed. Re-export reserve. *(item 1)*
- **BiddingBox** — numerals to the reference (medium, not bold); suits to the
  cap-height rule; NT at the strain-symbol scale. Revises the glyph-ratio restyle,
  which sized numerals by *button fill* (~55–60%) rather than by this shared scale —
  the shared scale wins. Re-export reserve. *(item 2, extends
  `biddingbox-glyph-restyle.md`)*
- Each re-exported reserve flows through the arranger's allocation (the ledger
  confirms), so a glyph change that widens/narrows a component moves its column.

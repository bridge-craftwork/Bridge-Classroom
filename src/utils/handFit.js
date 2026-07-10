// Pure per-row fit / truncation math for HandDisplay, extracted so the
// play-state invariants can be unit-tested without a layout engine (jsdom has
// none). All widths are in natural (scale-1) pixels; `available` is the row's
// content zone (container minus the fixed label zone).
//
// Cascade:
//   needed ≤ available          → scale 1 (no-op)
//   floor ≤ scale < 1           → one line at the computed scale (compress)
//   scale < floor               → hold at floor, TRUNCATE the tail, +N chip
// The truncation TEST excludes the chip (only the cards decide if truncation
// is needed); the COUNT of how many cards fit INCLUDES the chip reserve —
// computing in that order avoids truncating one card too many.

export const LEGIBILITY_FLOOR = 0.65

/**
 * @param {object} o
 * @param {number[]} o.cumWidths  natural cumulative widths: cumWidths[i] = width
 *   of the first (i+1) cards. Ascending; last entry is the full suit width.
 * @param {number} o.available    content-zone width in px.
 * @param {number} o.chipReserve  natural width the "+N" chip needs (0 if none).
 * @param {number} [o.floor]      legibility floor (default LEGIBILITY_FLOOR).
 * @returns {{scale:number, visible:number, hidden:number}}
 */
export function computeFit({ cumWidths, available, chipReserve = 0, floor = LEGIBILITY_FLOOR }) {
  const total = cumWidths.length
  const natural = total ? cumWidths[total - 1] : 0
  if (natural <= 0) return { scale: 1, visible: total, hidden: 0 }

  const scaleFull = Math.min(1, available / natural)
  // Chip EXCLUDED from the truncation test — only the cards decide it.
  if (scaleFull >= floor) return { scale: scaleFull, visible: total, hidden: 0 }

  // Truncate at the floor; the COUNT includes the chip's reserved width.
  const budget = available / floor // natural units at floor scale
  let visible = 0
  for (let i = 0; i < total; i++) {
    if (cumWidths[i] + chipReserve <= budget) visible = i + 1
    else break
  }
  return { scale: floor, visible, hidden: total - visible }
}

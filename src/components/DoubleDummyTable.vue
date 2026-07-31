<template>
  <template v-if="rows">
    <div class="dd-label" :class="{ 'dd-label-compact': compact }">Double-dummy tricks</div>

    <!-- UPRIGHT: declarers down the side, strains across the top. -->
    <table v-if="!rotated" class="dd-table" :class="{ 'dd-compact': compact }">
      <thead>
        <tr>
          <th></th>
          <th v-for="s in STRAINS" :key="s.key" :class="s.cls">{{ s.glyph }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.seat">
          <td class="dd-seat">{{ row.seat }}</td>
          <td v-for="(c, i) in row.cells" :key="i" :class="cellClass(c)">{{ c.tricks }}</td>
        </tr>
      </tbody>
    </table>

    <!-- ROTATED: the same grid transposed — declarers across the top, strains down the
         side. For a corner that is narrow rather than short: five strain rows over two
         or four declarer columns is a much taller, thinner box than the upright form,
         which is the shape a starved corner actually wants (Rick, 2026-07-30). Same
         cells, same highlight — only the axes swap. -->
    <table v-else class="dd-table dd-rotated" :class="{ 'dd-compact': compact }">
      <thead>
        <tr>
          <th></th>
          <th v-for="row in rows" :key="row.seat" class="dd-seat-head">{{ row.seat }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(s, si) in STRAINS" :key="s.key">
          <td class="dd-seat" :class="s.cls">{{ s.glyph }}</td>
          <td v-for="row in rows" :key="row.seat" :class="cellClass(row.cells[si])">
            {{ row.cells[si].tricks }}
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Par contract + score, both optional and independent. Rendered only when
         supplied, so every existing caller is unchanged. -->
    <div v-if="parLine" class="dd-par" :class="{ 'dd-par-compact': compact }">
      <span class="dd-par-key">Par</span>
      <span class="dd-par-val" v-html="parLine"></span>
    </div>
  </template>
</template>

<script setup>
// Shared double-dummy trick grid. Highlights the cell matching the final contract —
// green if the auction matched the reference (BBA), pink if it diverged. Pure
// presentation; used by any table view.
//
// Four display axes, all prop-driven so the SHELL decides (it is the only party that
// knows its own space — same division of labour as regionReserves):
//   compact   — corner density: squeeze the air, then the type
//   collapse  — one row per partnership when the pair agrees (default ON, lossless)
//   rotated   — transpose for a narrow-but-tall space
//   par       — optional par contract / score line
import { computed } from 'vue'
import { buildDdRows, collapseDdRows } from '../utils/handAnalysis.js'
import { formatBid } from '../utils/cardFormatting.js'

// Column order matches buildDdRows' cells: ♣ ♦ ♥ ♠ NT.
const STRAINS = [
  { key: 'C', glyph: '♣', cls: 'dd-black' },
  { key: 'D', glyph: '♦', cls: 'dd-red' },
  { key: 'H', glyph: '♥', cls: 'dd-red' },
  { key: 'S', glyph: '♠', cls: 'dd-black' },
  { key: 'NT', glyph: 'NT', cls: '' },
]

const props = defineProps({
  // Raw ddtricks string (or null before it loads).
  ddtricks: { type: [String, Array], default: null },
  finalContract: { type: Object, default: () => ({ contract: '', declarer: null }) },
  // Colour the contract cell as "diverged" (pink) vs "matched" (green).
  diverged: { type: Boolean, default: false },
  // Compact density for a grid CORNER (2026-07-29, Rick: "there is a lot of white
  // space that can be compressed out on the sides before clamping, especially with
  // single digits — the font can be reduced as necessary here also").
  //
  // The default cells carry 10px of padding on EACH side to hold a single digit —
  // ~120px of the table's ~205px is padding. Compressing that is strictly better
  // than letting the arranger scale the whole table down: a transform shrinks the
  // digits too, while this keeps them legible and removes only the air. Squeeze
  // first, clamp second.
  compact: { type: Boolean, default: false },
  // Merge a partnership's rows when their tricks are identical (N+S → NS). Defaults
  // ON because it is LOSSLESS — a pair only merges when every cell already matches —
  // and it halves the height in the common case. When they differ, all four rows stay.
  collapse: { type: Boolean, default: true },
  // Transpose: declarers across the top, strains down the side. Shell-set, because
  // only the shell knows whether its space is narrow-and-tall or wide-and-short.
  rotated: { type: Boolean, default: false },
  // Par contract and/or score. Either may be given alone.
  //   { contract: '4S', declarer: 'S', score: 620 }
  par: { type: Object, default: null },
})

const rows = computed(() => {
  const built = buildDdRows(props.ddtricks, props.finalContract)
  return props.collapse ? collapseDdRows(built) : built
})

function cellClass(c) {
  return {
    'dd-contract': c.isContract,
    'dd-match': c.isContract && !props.diverged,
    'dd-diverged': c.isContract && props.diverged,
  }
}

// "4♠ by S · 620" — each half optional. Suit symbols are coloured by formatBid, the
// same helper StatusStrip uses, so a par contract renders like every other contract
// in the app. The doubling suffix is split off first for the same reason it is there:
// formatBid renders the base call, and X / XX rides alongside.
const parLine = computed(() => {
  const p = props.par
  if (!p) return ''
  const bits = []
  if (p.contract) {
    const m = /^([1-7])(NT|N|[CDHS])(XX|X)?$/i.exec(String(p.contract).trim())
    let html
    if (m) {
      const base = m[1] + (m[2].toUpperCase() === 'N' ? 'NT' : m[2].toUpperCase())
      html = formatBid(base).html + (m[3] ? m[3].toUpperCase() : '')
    } else {
      html = String(p.contract)
    }
    bits.push(html + (p.declarer ? ` by ${p.declarer}` : ''))
  }
  if (p.score != null && p.score !== '') bits.push(String(p.score))
  return bits.join(' · ')
})
</script>

<style scoped>
/* Every dimension rides --table-scale, like HandDisplay / AuctionTable / BiddingBox.
   It did NOT until 2026-07-30: the CSS was fixed px, so this component silently
   discarded the scale the arranger computed for its region. Measured before the fix,
   it rendered 121px at --table-scale 1, 1.32, 2 AND 0.65 alike — which meant the
   review corner could neither grow into spare room nor shrink when starved, and the
   §6.1 corner-cap change would have had no visible effect at all.

   The px numbers below are the 1.0x naturals and are MIRRORED by doubleDummyReservePx()
   in table/clusterMetrics.js — keep the two in step (same contract as auctionMetrics). */
.dd-label {
  font-size: calc(11px * var(--table-scale, 1));
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: calc(10px * var(--table-scale, 1));
}
.dd-table {
  border-collapse: collapse;
  margin-top: calc(6px * var(--table-scale, 1));
  font-size: calc(13px * var(--table-scale, 1));
}
.dd-table th,
.dd-table td {
  border: 0.5px solid #ddd;
  padding: calc(4px * var(--table-scale, 1)) calc(10px * var(--table-scale, 1));
  text-align: center;
}
/* Corner form: the air comes out of the sides first, then the type steps down.
   Widths here are mirrored by doubleDummyReservePx() in table/clusterMetrics.js. */
.dd-compact { font-size: calc(11px * var(--table-scale, 1)); margin-top: calc(4px * var(--table-scale, 1)); }
.dd-compact th,
.dd-compact td {
  padding: calc(2px * var(--table-scale, 1)) calc(4px * var(--table-scale, 1));
  min-width: calc(15px * var(--table-scale, 1));
}
.dd-label-compact {
  font-size: calc(9px * var(--table-scale, 1));
  margin-top: calc(6px * var(--table-scale, 1));
  letter-spacing: 0.03em;
}
.dd-table th { background: #f3f3f0; color: #666; font-weight: 600; }
.dd-table th.dd-red { color: #d32f2f; }
.dd-table th.dd-black { color: #1a1a1a; }
.dd-seat { background: #f3f3f0; font-weight: 600; }
/* Rotated: the strain glyphs now sit in the left column, so they carry the suit
   colour there instead of in the header row. */
.dd-rotated .dd-seat.dd-red { color: #d32f2f; }
.dd-rotated .dd-seat.dd-black { color: #1a1a1a; }
.dd-rotated .dd-seat-head { font-weight: 600; }
.dd-contract.dd-match {
  background: #d4edda;
  color: #155724;
  font-weight: 700;
}
.dd-contract.dd-diverged {
  background: #fbd6e5;
  color: #88224a;
  font-weight: 700;
}
.dd-par {
  margin-top: calc(4px * var(--table-scale, 1));
  font-size: calc(12px * var(--table-scale, 1));
  color: #555;
}
.dd-par-compact { font-size: calc(10px * var(--table-scale, 1)); margin-top: calc(3px * var(--table-scale, 1)); }
.dd-par-key {
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-right: calc(5px * var(--table-scale, 1));
}
.dd-par-val { font-weight: 600; }
</style>

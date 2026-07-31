<template>
  <template v-if="rows">
    <div class="dd-label" :class="{ 'dd-label-compact': compact }">Double-dummy tricks</div>
    <table class="dd-table" :class="{ 'dd-compact': compact }">
      <thead>
        <tr>
          <th></th>
          <th class="dd-black">&clubs;</th>
          <th class="dd-red">&diams;</th>
          <th class="dd-red">&hearts;</th>
          <th class="dd-black">&spades;</th>
          <th>NT</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.seat">
          <td class="dd-seat">{{ row.seat }}</td>
          <td
            v-for="(c, i) in row.cells"
            :key="i"
            :class="{
              'dd-contract': c.isContract,
              'dd-match': c.isContract && !diverged,
              'dd-diverged': c.isContract && diverged,
            }"
          >{{ c.tricks }}</td>
        </tr>
      </tbody>
    </table>
  </template>
</template>

<script setup>
// Shared double-dummy trick grid (rows N/S/E/W × cols ♣♦♥♠ NT). Highlights the
// cell matching the final contract — green if the auction matched the reference
// (BBA), pink if it diverged. Pure presentation; used by any table view.
import { computed } from 'vue'
import { buildDdRows } from '../utils/handAnalysis.js'

const props = defineProps({
  // Raw bridgewebs ddtricks string (or null before it loads).
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
})

const rows = computed(() => buildDdRows(props.ddtricks, props.finalContract))
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
</style>

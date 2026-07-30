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
.dd-label {
  font-size: 11px;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: 10px;
}
.dd-table {
  border-collapse: collapse;
  margin-top: 6px;
  font-size: 13px;
}
.dd-table th,
.dd-table td {
  border: 0.5px solid #ddd;
  padding: 4px 10px;
  text-align: center;
}
/* Corner form: the air comes out of the sides first, then the type steps down.
   Widths here are mirrored by doubleDummyReservePx() in table/clusterMetrics.js. */
.dd-compact { font-size: 11px; margin-top: 4px; }
.dd-compact th,
.dd-compact td { padding: 2px 4px; min-width: 15px; }
.dd-label-compact { font-size: 9px; margin-top: 6px; letter-spacing: 0.03em; }
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

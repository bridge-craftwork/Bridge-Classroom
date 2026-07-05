<template>
  <template v-if="rows">
    <div class="dd-label">Double-dummy tricks</div>
    <table class="dd-table">
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

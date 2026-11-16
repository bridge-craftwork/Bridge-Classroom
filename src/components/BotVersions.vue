<script setup>
import { computed } from 'vue'
import { botVersions, rulesNote } from '../utils/botVersions.js'
import { rustyRules } from '../utils/rbbClient.js'

const rows = botVersions()
// Known once a Rusty table has loaded the engine, which fetches its rules.
const rules = computed(() => rulesNote(rustyRules.value))
</script>

<template>
  <div class="bp-setting-sep">Bot versions</div>
  <table class="bot-versions" data-testid="bot-versions">
    <tr v-for="r in rows" :key="r.id" :data-testid="`bot-version-${r.id}`">
      <th scope="row">{{ r.name }}</th>
      <td>{{ r.version }}</td>
      <td>{{ r.date }}</td>
      <td v-if="r.id === 'rusty' && rules" data-testid="bot-version-rusty-rules">{{ rules }}</td>
    </tr>
  </table>
</template>

<style scoped>
.bot-versions { font-size: 12px; color: #667; border-collapse: collapse; margin: 4px 0 8px; }
.bot-versions th { font-weight: 600; text-align: left; padding: 1px 12px 1px 0; }
.bot-versions td { padding: 1px 12px 1px 0; }
</style>

<template>
  <div class="dlp">
    <div class="dlp-head">
      <span class="dlp-title">My library</span>
      <button class="dlp-refresh" :disabled="loading" title="Reload" @click="refresh">↻</button>
    </div>

    <p v-if="loading" class="dlp-muted">Loading…</p>
    <p v-else-if="error" class="dlp-error">{{ error }}</p>
    <p v-else-if="!rows.length" class="dlp-muted">
      Your library is empty. Save some boards to it first.
    </p>

    <div v-else class="dlp-tree">
      <div
        v-for="row in rows"
        :key="row.entry.id"
        class="dlp-row"
        :style="{ paddingLeft: 8 + row.depth * 16 + 'px' }"
      >
        <!-- Folder: toggles open/closed -->
        <button
          v-if="row.entry.kind === 'folder'"
          class="dlp-folder"
          @click="toggle(row.entry.id)"
        >
          <span class="dlp-caret">{{ expanded.has(row.entry.id) ? '▾' : '▸' }}</span>
          📁 {{ row.entry.name }}
        </button>

        <!-- File: selectable (materialized PBN) -->
        <button
          v-else-if="row.entry.kind === 'file'"
          class="dlp-item"
          :disabled="busyId === row.entry.id"
          @click="$emit('select', row.entry)"
        >
          <span class="dlp-item-name">📄 {{ row.entry.name }}</span>
          <span v-if="row.entry.payload_bytes" class="dlp-size">{{ sizeHint(row.entry.payload_bytes) }}</span>
        </button>

        <!-- Link: reference to an evolving source; shown, not yet dealable -->
        <div v-else class="dlp-item dlp-link" title="External references aren't dealable from here yet — coming in a later update.">
          <span class="dlp-item-name">🔗 {{ row.entry.name }}</span>
          <span class="dlp-badge">ref</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
// Shared read-only browser over a teacher's deal library (roadmap Phase
// 2.5, step 2). Fetches the owner's flat entry list once, assembles the
// folder tree, and emits `select` with a FILE entry's metadata when the
// teacher picks one. The consumer fetches the payload (useDealLibrary
// .fetchEntry) — the list is metadata-only. Links are displayed (so
// favorites are visible) but not selectable yet.
import { ref, computed, watch, onMounted } from 'vue'
import { useDealLibrary } from '../../composables/useDealLibrary.js'

const props = defineProps({
  owner: { type: String, default: '' },
  // Highlight/disable a row while its payload is being fetched by the parent.
  busyId: { type: String, default: '' },
})
defineEmits(['select'])

const { entries, loading, error, fetchLibrary } = useDealLibrary()

// Folder ids currently expanded. Everything starts open — libraries are
// shallow ("Tuesday class" / "Week 3") and a teacher wants to see the set.
const expanded = ref(new Set())

function refresh() {
  if (props.owner) fetchLibrary(props.owner)
}

onMounted(refresh)
watch(() => props.owner, refresh)

// Auto-expand every folder whenever the entry set changes.
watch(entries, (list) => {
  const next = new Set(expanded.value)
  for (const e of list) if (e.kind === 'folder') next.add(e.id)
  expanded.value = next
})

function toggle(id) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

// Flatten the parent/child hierarchy into an ordered, depth-tagged list,
// skipping the children of collapsed folders. Server already sorts each
// sibling group by (sort_order, name).
const rows = computed(() => {
  const byParent = new Map()
  for (const e of entries.value) {
    const key = e.parent_id || 'root'
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key).push(e)
  }
  const out = []
  const walk = (parentKey, depth) => {
    for (const entry of byParent.get(parentKey) || []) {
      out.push({ entry, depth })
      if (entry.kind === 'folder' && expanded.value.has(entry.id)) {
        walk(entry.id, depth + 1)
      }
    }
  }
  walk('root', 0)
  return out
})

function sizeHint(bytes) {
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}
</script>

<style scoped>
.dlp { display: flex; flex-direction: column; gap: 6px; }
.dlp-head { display: flex; align-items: center; justify-content: space-between; }
.dlp-title { font-size: 12px; font-weight: 600; color: #24435a; }
.dlp-refresh {
  border: none; background: none; cursor: pointer; font-size: 14px; color: #667;
}
.dlp-refresh:disabled { opacity: 0.4; cursor: default; }
.dlp-tree { display: flex; flex-direction: column; gap: 2px; max-height: 46vh; overflow-y: auto; }
.dlp-row { display: flex; }
.dlp-folder,
.dlp-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: 1px solid transparent;
  border-radius: 6px;
  background: none;
  padding: 6px 8px;
  font-size: 13.5px;
  cursor: pointer;
  text-align: left;
  color: #333;
}
.dlp-folder { font-weight: 600; color: #24435a; }
.dlp-folder:hover,
.dlp-item:hover:not(:disabled) { background: #f0f5fa; border-color: #d8dee4; }
.dlp-item { justify-content: space-between; }
.dlp-item:disabled { opacity: 0.5; cursor: default; }
.dlp-caret { width: 12px; display: inline-block; color: #99a; }
.dlp-item-name { display: flex; align-items: center; gap: 6px; }
.dlp-size { font-size: 11px; color: #99a; }
.dlp-link { cursor: default; color: #778; }
.dlp-link:hover { background: none; border-color: transparent; }
.dlp-badge {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;
  background: #eef1f4; color: #8895a3; border-radius: 4px; padding: 1px 5px;
}
.dlp-muted { color: #777; font-size: 13px; margin: 4px 0; }
.dlp-error { color: #c62828; font-size: 13px; margin: 4px 0; }
</style>

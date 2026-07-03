<template>
  <div class="lib-tab">
    <div class="tab-header">
      <div>
        <h2 class="tab-title">My Deal Library</h2>
        <p class="tab-desc">
          Organize saved boards into folders, set how each deals, and reuse
          them at tables or when creating a class session.
        </p>
      </div>
      <div class="header-actions">
        <button class="btn btn-secondary" @click="openCreate('folder')">+ Folder</button>
        <button class="btn btn-primary" @click="openCreate('file')">+ Boards file</button>
      </div>
    </div>

    <div v-if="loading && !entries.length" class="empty-state">Loading library…</div>

    <div v-else-if="!entries.length" class="empty-state">
      <p class="empty-title">Your library is empty.</p>
      <p class="empty-desc">
        Save a set of boards here, or send a game over from the Game Analysis
        app. Files are frozen copies; folders keep things tidy.
      </p>
      <button class="btn btn-primary" @click="openCreate('file')">Add your first boards file</button>
    </div>

    <div v-else class="lib-tree">
      <div
        v-for="row in rows"
        :key="row.entry.id"
        class="lib-row"
        :style="{ paddingLeft: 8 + row.depth * 20 + 'px' }"
      >
        <button
          v-if="row.entry.kind === 'folder'"
          class="lib-caret-btn"
          @click="toggle(row.entry.id)"
        >{{ expanded.has(row.entry.id) ? '▾' : '▸' }}</button>
        <span v-else class="lib-caret-spacer"></span>

        <span class="lib-icon">{{ ICON[row.entry.kind] }}</span>
        <span class="lib-name">{{ row.entry.name }}</span>

        <span v-if="row.entry.kind === 'file' && row.entry.payload_bytes" class="lib-size">
          {{ sizeHint(row.entry.payload_bytes) }}
        </span>
        <span v-if="row.entry.kind === 'link'" class="lib-badge">ref</span>
        <span v-if="settingsSummary(row.entry)" class="lib-settings">{{ settingsSummary(row.entry) }}</span>

        <span class="lib-actions">
          <button v-if="row.entry.kind === 'folder'" class="btn-link" title="New item in this folder" @click="openCreate('file', row.entry.id)">+ Add</button>
          <button class="btn-link" @click="openEdit(row.entry.id)">Edit</button>
          <button class="btn-link danger" @click="pendingDelete = row.entry">Delete</button>
        </span>
      </div>
    </div>

    <p v-if="error" class="error-text">{{ error }}</p>

    <DealLibraryEntryModal
      v-if="editorOpen"
      :entry-id="editingId"
      :parent-id="editingParentId"
      :kind-lock="editingKindLock"
      :folder-options="folderOptions"
      @close="editorOpen = false"
      @saved="onSaved"
    />

    <div v-if="pendingDelete" class="modal-overlay" @click.self="pendingDelete = null">
      <div class="confirm-modal">
        <h3>Delete "{{ pendingDelete.name }}"?</h3>
        <p v-if="pendingDelete.kind === 'folder'">
          This deletes the folder <strong>and everything inside it</strong>.
          This can't be undone from here.
        </p>
        <p v-else>This removes the entry from your library. This can't be undone from here.</p>
        <div class="confirm-actions">
          <button class="btn btn-secondary" @click="pendingDelete = null">Cancel</button>
          <button class="btn btn-danger" @click="doDelete">Delete</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
// Teacher deal-library manager (roadmap Phase 2.5 authoring UI). A CRUD tree
// over the per-teacher library: create folders/files/links, rename, move
// (re-parent via the editor), edit per-entry settings, and delete (folders
// cascade). Mirrors TeacherExercisesTab conventions.
import { ref, computed, onMounted } from 'vue'
import { useDealLibrary } from '../../../composables/useDealLibrary.js'
import { useUserStore } from '../../../composables/useUserStore.js'
import DealLibraryEntryModal from '../DealLibraryEntryModal.vue'

const userStore = useUserStore()
const { entries, loading, error, fetchLibrary, deleteEntry } = useDealLibrary()

const ICON = { folder: '📁', file: '📄', link: '🔗' }

const expanded = ref(new Set())
const editorOpen = ref(false)
const editingId = ref(null)
const editingParentId = ref(null)
const editingKindLock = ref('')
const pendingDelete = ref(null)

async function loadList() {
  const user = userStore.currentUser.value
  if (!user) return
  await fetchLibrary(user.id)
  // Expand every folder by default.
  const next = new Set(expanded.value)
  for (const e of entries.value) if (e.kind === 'folder') next.add(e.id)
  expanded.value = next
}

function toggle(id) {
  const next = new Set(expanded.value)
  next.has(id) ? next.delete(id) : next.add(id)
  expanded.value = next
}

// Depth-first flatten, skipping collapsed subtrees.
const rows = computed(() => {
  const byParent = new Map()
  for (const e of entries.value) {
    const key = e.parent_id || 'root'
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key).push(e)
  }
  const out = []
  const walk = (key, depth) => {
    for (const entry of byParent.get(key) || []) {
      out.push({ entry, depth })
      if (entry.kind === 'folder' && expanded.value.has(entry.id)) walk(entry.id, depth + 1)
    }
  }
  walk('root', 0)
  return out
})

// Folder list for the editor's parent selector, depth-indented.
const folderOptions = computed(() =>
  rows.value
    .filter((r) => r.entry.kind === 'folder')
    .map((r) => ({ id: r.entry.id, label: '  '.repeat(r.depth) + r.entry.name }))
)

function openCreate(kind, parentId = null) {
  editingId.value = null
  editingParentId.value = parentId
  editingKindLock.value = kind || ''
  editorOpen.value = true
}

function openEdit(id) {
  editingId.value = id
  editingParentId.value = null
  editingKindLock.value = ''
  editorOpen.value = true
}

async function doDelete() {
  const target = pendingDelete.value
  if (!target) return
  const user = userStore.currentUser.value
  const result = await deleteEntry(target.id, user?.id)
  if (!result?.success) error.value = 'Could not delete entry.'
  pendingDelete.value = null
  await loadList()
}

async function onSaved() {
  editorOpen.value = false
  editingId.value = null
  await loadList()
}

function sizeHint(bytes) {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`
}

const MODE_LABEL = { full: 'bid+play', bid: 'bid only', play: 'play only' }
const ROTATE_LABEL = { 1: '¼ turn', 2: '½ turn', 3: '¾ turn' }
function settingsSummary(entry) {
  if (!entry.settings) return ''
  try {
    const s = JSON.parse(entry.settings)
    const parts = []
    if (s.mode && MODE_LABEL[s.mode]) parts.push(MODE_LABEL[s.mode])
    if (s.rotate && ROTATE_LABEL[s.rotate]) parts.push(ROTATE_LABEL[s.rotate])
    return parts.join(' · ')
  } catch {
    return ''
  }
}

onMounted(loadList)
</script>

<style scoped>
.lib-tab { padding: 4px 0; }
.tab-header {
  display: flex; justify-content: space-between; align-items: flex-end;
  margin-bottom: 20px; gap: 16px;
}
.tab-title {
  font-family: var(--font-heading, 'Source Serif 4', serif);
  font-size: 22px; color: var(--green-dark, #2d6a4f); margin: 0 0 4px;
}
.tab-desc { color: var(--text-secondary, #6b7280); font-size: 14px; margin: 0; max-width: 60ch; }
.header-actions { display: flex; gap: 8px; flex-shrink: 0; }

.empty-state {
  background: white; border: 1px dashed var(--card-border, #e0ddd7);
  border-radius: var(--radius-card, 10px); padding: 40px; text-align: center;
  color: var(--text-secondary, #6b7280);
}
.empty-title { font-size: 16px; color: var(--text-primary, #1a1a1a); font-weight: 600; margin: 0 0 6px; }
.empty-desc { font-size: 14px; margin: 0 0 16px; }

.lib-tree {
  background: white; border: 1px solid var(--card-border, #e0ddd7);
  border-radius: var(--radius-card, 10px); padding: 6px; display: flex; flex-direction: column;
}
.lib-row {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 8px; border-radius: 6px; font-size: 14px;
}
.lib-row:hover { background: #f6f8f7; }
.lib-caret-btn {
  border: none; background: none; cursor: pointer; color: #99a; font-size: 13px;
  width: 16px; padding: 0;
}
.lib-caret-spacer { width: 16px; display: inline-block; }
.lib-icon { flex-shrink: 0; }
.lib-name { font-weight: 500; color: var(--text-primary, #1a1a1a); }
.lib-size { font-size: 11px; color: #9ca3af; }
.lib-badge {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;
  background: #eef1f4; color: #8895a3; border-radius: 4px; padding: 1px 5px;
}
.lib-settings {
  font-size: 11px; color: #5f6b7a; background: #eef7f1; border-radius: 4px; padding: 1px 7px;
}
.lib-actions { margin-left: auto; display: flex; gap: 12px; flex-shrink: 0; }
.btn-link {
  background: none; border: none; cursor: pointer; color: var(--green-dark, #2d6a4f);
  font-size: 13px; padding: 0; font-weight: 500;
}
.btn-link:hover { text-decoration: underline; }
.btn-link.danger { color: var(--red, #ef4444); }

.btn {
  padding: 8px 16px; border-radius: var(--radius-button, 6px); font-size: 14px;
  font-weight: 500; cursor: pointer; border: none; font-family: inherit;
}
.btn-primary { background: var(--green-mid, #40916c); color: white; }
.btn-primary:hover { background: var(--green-dark, #2d6a4f); }
.btn-secondary { background: #f3f4f6; color: var(--text-primary, #1a1a1a); }
.btn-secondary:hover { background: #e5e7eb; }
.btn-danger { background: var(--red, #ef4444); color: white; }
.btn-danger:hover { background: #dc2626; }

.modal-overlay {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5);
  display: flex; align-items: center; justify-content: center; z-index: 2100; padding: 20px;
}
.confirm-modal {
  background: white; border-radius: var(--radius-card, 10px); padding: 24px 28px;
  max-width: 440px; width: 100%; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.2);
}
.confirm-modal h3 {
  font-family: var(--font-heading, 'Source Serif 4', serif);
  font-size: 18px; margin: 0 0 8px; color: var(--text-primary, #1a1a1a);
}
.confirm-modal p { color: var(--text-secondary, #6b7280); font-size: 14px; margin: 0 0 16px; }
.confirm-actions { display: flex; gap: 10px; justify-content: flex-end; }
.error-text { color: var(--red, #ef4444); font-size: 14px; margin-top: 12px; }
</style>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content">
      <div class="step">
        <h2>{{ isEdit ? 'Edit ' + kindLabel : 'New ' + kindLabel }}</h2>

        <!-- Kind picker (create only, when not locked to one kind) -->
        <div v-if="!isEdit && !kindLock" class="form-group">
          <label>Type</label>
          <div class="kind-row">
            <label v-for="k in KINDS" :key="k.id" class="kind-opt" :class="{ active: kind === k.id }">
              <input v-model="kind" type="radio" :value="k.id" />
              {{ k.label }}
            </label>
          </div>
        </div>

        <div class="form-group">
          <label for="dle-name">Name</label>
          <input id="dle-name" v-model="name" type="text" class="form-input" placeholder="e.g. Week 3 defense set" />
        </div>

        <!-- Parent folder (move / place) -->
        <div class="form-group">
          <label for="dle-parent">Folder</label>
          <select id="dle-parent" v-model="parentId" class="form-input">
            <option :value="null">Top level</option>
            <option v-for="f in folderOptions" :key="f.id" :value="f.id">{{ f.label }}</option>
          </select>
        </div>

        <!-- File: materialized PBN -->
        <div v-if="kind === 'file'" class="form-group">
          <label for="dle-pbn">Boards (PBN)</label>
          <textarea
            id="dle-pbn"
            v-model="payload"
            class="form-textarea"
            rows="6"
            placeholder='[Board "1"]
[Dealer "N"]
[Vulnerable "None"]
[Deal "N:K843.T542.J6.863 AQJ7.K.Q75.AT942 962.AJ7.KT82.J75 T5.Q9863.A943.KQ"]'
          ></textarea>
          <p class="field-hint">Copied in as a frozen snapshot — editing here doesn't touch the original source.</p>
        </div>

        <!-- Link: reference descriptor -->
        <div v-else-if="kind === 'link'" class="form-group">
          <label for="dle-desc">Source descriptor (JSON)</label>
          <textarea
            id="dle-desc"
            v-model="payload"
            class="form-textarea"
            rows="3"
            placeholder='{"source":"pbs_scenario","file":"Preempts"}'
          ></textarea>
          <p class="field-hint">A live reference to an evolving source. Not dealable from the picker yet.</p>
        </div>

        <!-- Per-entry settings (file/link) -->
        <div v-if="kind !== 'folder'" class="settings-box">
          <div class="settings-title">When dealt</div>
          <div class="settings-row">
            <label class="settings-field">
              Board mode
              <select v-model="settingsMode" class="form-input">
                <option value="">Default (table's current)</option>
                <option value="full">Bid + play</option>
                <option value="bid">Bid only</option>
                <option value="play">Play only</option>
              </select>
            </label>
            <label class="settings-field">
              Rotate deal
              <select v-model.number="settingsRotate" class="form-input">
                <option :value="0">None</option>
                <option :value="1">90° (¼ turn)</option>
                <option :value="2">180° (½ turn)</option>
                <option :value="3">270° (¾ turn)</option>
              </select>
            </label>
          </div>
          <p class="field-hint">Rotation turns the deal, never the players — so the interesting seat can face South.</p>
        </div>

        <div class="step-actions">
          <button class="btn btn-secondary" @click="$emit('close')">Cancel</button>
          <button class="btn btn-primary" :disabled="!canSave || saving" @click="handleSave">
            {{ saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create' }}
          </button>
        </div>
        <p v-if="error" class="error-text">{{ error }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
// Create/edit a deal-library entry (roadmap Phase 2.5 authoring UI). Handles
// folder / file / link, placement into a folder (move), and the per-entry
// settings that apply when the entry is dealt (board mode + deal rotation).
import { ref, computed, onMounted } from 'vue'
import { useDealLibrary } from '../../composables/useDealLibrary.js'
import { useUserStore } from '../../composables/useUserStore.js'

const props = defineProps({
  entryId: { type: String, default: null },
  // Default folder for a new entry (null = top level).
  parentId: { type: String, default: null },
  // Lock the kind for create (e.g. the "+ New folder" button).
  kindLock: { type: String, default: '' },
  // The teacher's folders, for the parent selector: [{ id, label }].
  folderOptions: { type: Array, default: () => [] },
})
const emit = defineEmits(['close', 'saved'])

const { entries, fetchEntry, createEntry, updateEntry, error: storeError } = useDealLibrary()
const userStore = useUserStore()

const KINDS = [
  { id: 'folder', label: 'Folder' },
  { id: 'file', label: 'Boards file' },
  { id: 'link', label: 'Link (reference)' },
]

const isEdit = computed(() => !!props.entryId)
const kind = ref(props.kindLock || 'folder')
const name = ref('')
const parentId = ref(props.parentId)
const payload = ref('')
const settingsMode = ref('')
const settingsRotate = ref(0)
const saving = ref(false)
const error = ref(null)

const kindLabel = computed(() => KINDS.find((k) => k.id === kind.value)?.label.toLowerCase() || 'entry')

// A new file/link needs a payload; a folder never does. Names always required.
const canSave = computed(() => {
  if (!name.value.trim()) return false
  if (!isEdit.value && kind.value !== 'folder' && !payload.value.trim()) return false
  return true
})

function buildSettings() {
  const s = {}
  if (settingsMode.value) s.mode = settingsMode.value
  if (settingsRotate.value) s.rotate = settingsRotate.value
  return Object.keys(s).length ? JSON.stringify(s) : null
}

async function handleSave() {
  if (!canSave.value || saving.value) return
  const user = userStore.currentUser.value
  if (!user) {
    error.value = 'You must be signed in.'
    return
  }
  saving.value = true
  error.value = null

  let result
  if (isEdit.value) {
    const updates = {
      actor_user_id: user.id,
      name: name.value.trim(),
      parent_id: parentId.value || null,
    }
    if (kind.value !== 'folder') {
      updates.payload = payload.value
      updates.settings = buildSettings()
    }
    result = await updateEntry(props.entryId, updates)
  } else {
    result = await createEntry({
      owner: user.id,
      parent_id: parentId.value || null,
      kind: kind.value,
      name: name.value.trim(),
      payload: kind.value === 'folder' ? null : payload.value,
      settings: kind.value === 'folder' ? null : buildSettings(),
    })
  }

  saving.value = false
  if (result?.success) {
    emit('saved', result.entry)
  } else {
    error.value = storeError.value || 'Could not save.'
  }
}

onMounted(async () => {
  if (!isEdit.value) return
  // Prefer the already-loaded metadata for instant field population, then
  // fetch the payload (the list omits it).
  const meta = entries.value.find((e) => e.id === props.entryId)
  if (meta) {
    kind.value = meta.kind
    name.value = meta.name
    parentId.value = meta.parent_id || null
  }
  const detail = await fetchEntry(props.entryId)
  if (detail) {
    kind.value = detail.kind
    name.value = detail.name
    parentId.value = detail.parent_id || null
    payload.value = detail.payload || ''
    try {
      const s = detail.settings ? JSON.parse(detail.settings) : {}
      settingsMode.value = s.mode || ''
      settingsRotate.value = typeof s.rotate === 'number' ? s.rotate : 0
    } catch { /* leave defaults */ }
  }
})
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 2100; padding: 20px;
}
.modal-content {
  background: white;
  border-radius: var(--radius-card, 10px);
  max-width: 520px;
  width: 100%;
  max-height: 88vh;
  overflow-y: auto;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.2);
}
.step { padding: 24px 28px; }
.step h2 {
  font-family: var(--font-heading, 'Source Serif 4', serif);
  font-size: 20px;
  margin: 0 0 16px;
  color: var(--text-primary, #1a1a1a);
  text-transform: capitalize;
}
.form-group { margin-bottom: 14px; }
.form-group label { display: block; font-size: 13px; font-weight: 600; color: #333; margin-bottom: 5px; }
.form-input, .form-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid #ccc;
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
}
.form-textarea { font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
.field-hint { font-size: 12px; color: var(--text-muted, #9ca3af); margin: 5px 0 0; }
.kind-row { display: flex; gap: 8px; flex-wrap: wrap; }
.kind-opt {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px; border: 1px solid #d8dee4; border-radius: 999px;
  font-size: 13px; font-weight: 500; cursor: pointer; color: #444;
}
.kind-opt.active { border-color: var(--green-mid, #40916c); background: #eef7f1; color: var(--green-dark, #2d6a4f); }
.settings-box {
  border: 1px solid #e2e6ea; border-radius: 8px; padding: 12px 14px;
  background: #fafbfc; margin-bottom: 14px;
}
.settings-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #8895a3; margin-bottom: 8px; }
.settings-row { display: flex; gap: 12px; flex-wrap: wrap; }
.settings-field { flex: 1; min-width: 150px; font-size: 13px; font-weight: 600; color: #333; }
.settings-field .form-input { margin-top: 4px; font-weight: 400; }
.step-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 18px; }
.btn {
  padding: 8px 16px; border-radius: 6px; font-size: 14px; font-weight: 500;
  cursor: pointer; border: none; font-family: inherit;
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary { background: var(--green-mid, #40916c); color: white; }
.btn-primary:hover:not(:disabled) { background: var(--green-dark, #2d6a4f); }
.btn-secondary { background: #f3f4f6; color: var(--text-primary, #1a1a1a); }
.btn-secondary:hover { background: #e5e7eb; }
.error-text { color: var(--red, #ef4444); font-size: 14px; margin-top: 12px; }
</style>

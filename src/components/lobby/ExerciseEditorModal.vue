<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content">
      <div class="step">
        <h2>{{ isEdit ? 'Edit Exercise' : 'Create Exercise' }}</h2>
        <p class="step-desc">
          Build an exercise by picking boards from one or more lessons.
          The Wild / Tame tag on each board shows how it will be classified
          (CORRECTNESS_AND_MASTERY.md §11).
        </p>

        <div class="form-group">
          <label for="ex-name">Name</label>
          <input
            id="ex-name"
            v-model="name"
            type="text"
            placeholder="e.g. Two Over One — Quick Review"
            class="form-input"
          />
        </div>

        <div class="form-group">
          <label for="ex-desc">Description <span class="optional">(optional)</span></label>
          <textarea
            id="ex-desc"
            v-model="description"
            placeholder="A note for yourself about what this exercise is for."
            class="form-textarea"
            rows="2"
          ></textarea>
        </div>

        <div class="form-group">
          <label>Visibility</label>
          <div class="radio-row">
            <label class="radio-label">
              <input type="radio" v-model="visibility" value="public" />
              Public — other teachers can use this exercise
            </label>
            <label class="radio-label">
              <input type="radio" v-model="visibility" value="private" />
              Private — only you
            </label>
          </div>
        </div>

        <div class="editor-grid">
          <!-- Boards panel -->
          <section class="panel boards-panel">
            <div class="panel-header">
              <h3>Boards ({{ boards.length }})</h3>
              <button v-if="boards.length > 1" class="btn-link" @click="shuffleBoards">
                Shuffle order
              </button>
            </div>
            <p v-if="boards.length === 0" class="empty-hint">
              No boards yet — pick some from a lesson on the right.
            </p>
            <ol v-else class="boards-list">
              <li v-for="(b, i) in boards" :key="`${b.deal_subfolder}-${b.deal_number}-${i}`" class="board-row">
                <span class="board-pos">{{ i + 1 }}</span>
                <span class="board-id">
                  <span class="board-subfolder">{{ b.deal_subfolder }}</span>
                  <span class="board-number">#{{ b.deal_number }}</span>
                </span>
                <span class="wilderness-tag" :class="wildernessFor(i).toLowerCase()">
                  {{ wildernessFor(i) }}
                </span>
                <span class="row-actions">
                  <button class="btn-icon" :disabled="i === 0" @click="moveBoard(i, -1)" title="Move up">↑</button>
                  <button class="btn-icon" :disabled="i === boards.length - 1" @click="moveBoard(i, 1)" title="Move down">↓</button>
                  <button class="btn-icon btn-remove" @click="removeBoard(i)" title="Remove">×</button>
                </span>
              </li>
            </ol>
          </section>

          <!-- Picker panel -->
          <section class="panel picker-panel">
            <div class="panel-header">
              <h3>Add boards</h3>
            </div>

            <div class="form-group">
              <label for="ex-lesson">Lesson</label>
              <select id="ex-lesson" v-model="pickerSkillPath" class="form-input">
                <option value="">Choose a lesson…</option>
                <optgroup v-for="cat in categories" :key="cat" :label="cat">
                  <option
                    v-for="entry in entriesByCategory[cat]"
                    :key="entry.path"
                    :value="entry.path"
                  >
                    {{ entry.name }} ({{ entry.dealCount }} boards)
                  </option>
                </optgroup>
              </select>
            </div>

            <div v-if="pickerLesson" class="picker-modes">
              <div class="mode-tabs">
                <button
                  class="mode-tab"
                  :class="{ active: pickerMode === 'specific' }"
                  @click="pickerMode = 'specific'"
                >
                  Pick specific
                </button>
                <button
                  class="mode-tab"
                  :class="{ active: pickerMode === 'random' }"
                  @click="pickerMode = 'random'"
                >
                  Add N random
                </button>
              </div>

              <!-- Specific picker -->
              <div v-if="pickerMode === 'specific'" class="specific-picker">
                <p class="form-hint">
                  Click boards to toggle. Already-included boards are dimmed.
                </p>
                <div class="board-grid">
                  <button
                    v-for="n in pickerLesson.dealCount"
                    :key="n"
                    class="board-btn"
                    :class="{
                      selected: pickerSelectedSet.has(n),
                      taken: pickerTakenSet.has(n) && !pickerSelectedSet.has(n)
                    }"
                    @click="togglePicker(n)"
                  >{{ n }}</button>
                </div>
                <button
                  class="btn btn-primary"
                  :disabled="pickerSelected.length === 0"
                  @click="addSpecific"
                >
                  Add {{ pickerSelected.length }} board{{ pickerSelected.length === 1 ? '' : 's' }}
                </button>
              </div>

              <!-- Random picker -->
              <div v-else class="random-picker">
                <p class="form-hint">
                  Picks unique boards from this lesson at random and appends
                  them to the list. Boards already in the exercise are excluded.
                </p>
                <div class="random-row">
                  <input
                    v-model.number="randomCount"
                    type="number"
                    min="1"
                    :max="randomAvailable"
                    class="form-input random-input"
                  />
                  <span class="random-of">of {{ randomAvailable }} available</span>
                  <button
                    class="btn btn-primary"
                    :disabled="!randomAvailable || randomCount < 1"
                    @click="addRandom"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div v-if="boards.length > 0" class="wilderness-summary">
          <span class="legend-dot wild"></span>{{ wildernessCounts.Wild }} Wild
          <span class="legend-dot tame"></span>{{ wildernessCounts.Tame }} Tame
          <span class="hint">Wild = fewer than 25% of the exercise's boards share that lesson (§11).</span>
        </div>

        <div class="step-actions">
          <button class="btn btn-secondary" @click="$emit('close')">Cancel</button>
          <button
            class="btn btn-primary"
            :disabled="!canSave || saving"
            @click="handleSave"
          >
            {{ saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Exercise' }}
          </button>
        </div>

        <p v-if="error" class="error-text">{{ error }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useExercises } from '../../composables/useExercises.js'
import { useUserStore } from '../../composables/useUserStore.js'
import { BAKER_BRIDGE_TAXONOMY, TAXONOMY_CATEGORIES, getTaxonomyEntry } from '../../utils/bakerBridgeTaxonomy.js'
import { deriveWildernessForBoardList } from '../../utils/wilderness.js'

const props = defineProps({
  exerciseId: { type: String, default: null },
})

const emit = defineEmits(['close', 'saved'])

const userStore = useUserStore()
const exercisesStore = useExercises()

const isEdit = computed(() => !!props.exerciseId)

const name = ref('')
const description = ref('')
const visibility = ref('public')
// boards: [{ deal_subfolder, deal_number }] — sort_order is the array index
const boards = ref([])

const pickerSkillPath = ref('')
const pickerMode = ref('specific')
const pickerSelected = ref([])  // deal_numbers selected in specific mode
const randomCount = ref(5)

const saving = ref(false)
const error = ref(null)

// Group taxonomy entries by category for the dropdown
const categories = TAXONOMY_CATEGORIES
const entriesByCategory = computed(() => {
  const out = {}
  for (const cat of categories) out[cat] = []
  for (const entry of BAKER_BRIDGE_TAXONOMY) {
    if (out[entry.category]) out[entry.category].push(entry)
  }
  return out
})

const pickerLesson = computed(() =>
  pickerSkillPath.value ? getTaxonomyEntry(pickerSkillPath.value) : null
)

const pickerSubfolder = computed(() =>
  pickerLesson.value ? pickerLesson.value.pbn.replace(/\.pbn$/i, '') : null
)

// deal_numbers from this lesson that are already in the exercise
const pickerTakenSet = computed(() => {
  const sf = pickerSubfolder.value
  if (!sf) return new Set()
  return new Set(boards.value.filter(b => b.deal_subfolder === sf).map(b => b.deal_number))
})

const pickerSelectedSet = computed(() => new Set(pickerSelected.value))

const randomAvailable = computed(() => {
  if (!pickerLesson.value) return 0
  return pickerLesson.value.dealCount - pickerTakenSet.value.size
})

const wildernessTags = computed(() => deriveWildernessForBoardList(boards.value))

function wildernessFor(i) {
  return wildernessTags.value[i] || 'Tame'
}

const wildernessCounts = computed(() => {
  const tags = wildernessTags.value
  return {
    Wild: tags.filter(t => t === 'Wild').length,
    Tame: tags.filter(t => t === 'Tame').length,
  }
})

const canSave = computed(() => name.value.trim().length > 0 && boards.value.length > 0)

watch(pickerSkillPath, () => {
  pickerSelected.value = []
})

function togglePicker(n) {
  if (pickerTakenSet.value.has(n)) return  // can't re-add an existing one
  const i = pickerSelected.value.indexOf(n)
  if (i === -1) pickerSelected.value.push(n)
  else pickerSelected.value.splice(i, 1)
}

function addSpecific() {
  const sf = pickerSubfolder.value
  if (!sf) return
  const additions = [...pickerSelected.value]
    .sort((a, b) => a - b)
    .map(n => ({ deal_subfolder: sf, deal_number: n }))
  boards.value = [...boards.value, ...additions]
  pickerSelected.value = []
}

function addRandom() {
  const sf = pickerSubfolder.value
  if (!sf || !pickerLesson.value) return
  const available = []
  for (let n = 1; n <= pickerLesson.value.dealCount; n++) {
    if (!pickerTakenSet.value.has(n)) available.push(n)
  }
  const wanted = Math.min(Math.max(1, randomCount.value || 0), available.length)
  // Fisher–Yates shuffle, take first `wanted`
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[available[i], available[j]] = [available[j], available[i]]
  }
  const picks = available.slice(0, wanted).sort((a, b) => a - b)
  boards.value = [
    ...boards.value,
    ...picks.map(n => ({ deal_subfolder: sf, deal_number: n })),
  ]
}

function moveBoard(i, delta) {
  const j = i + delta
  if (j < 0 || j >= boards.value.length) return
  const next = boards.value.slice()
  ;[next[i], next[j]] = [next[j], next[i]]
  boards.value = next
}

function removeBoard(i) {
  const next = boards.value.slice()
  next.splice(i, 1)
  boards.value = next
}

function shuffleBoards() {
  const next = boards.value.slice()
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[next[i], next[j]] = [next[j], next[i]]
  }
  boards.value = next
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

  // Materialize sort_order from array position. The collection_id field
  // is unused for teacher-built exercises; pass null.
  const payloadBoards = boards.value.map((b, i) => ({
    deal_subfolder: b.deal_subfolder,
    deal_number: b.deal_number,
    sort_order: i,
    collection_id: null,
  }))

  let result
  if (isEdit.value) {
    result = await exercisesStore.updateExercise(props.exerciseId, {
      name: name.value.trim(),
      description: description.value.trim() || null,
      visibility: visibility.value,
      boards: payloadBoards,
      actor_user_id: user.id,
    })
  } else {
    result = await exercisesStore.createExercise({
      name: name.value.trim(),
      description: description.value.trim() || null,
      created_by: user.id,
      curriculum_path: null,
      visibility: visibility.value,
      boards: payloadBoards,
    })
  }

  saving.value = false

  if (result && result.success) {
    emit('saved', result.exercise || { id: props.exerciseId })
  } else {
    error.value = exercisesStore.error.value || 'Could not save the exercise.'
  }
}

onMounted(async () => {
  if (!isEdit.value) return
  const data = await exercisesStore.fetchExerciseDetail(props.exerciseId)
  if (data?.success) {
    const ex = data.exercise
    name.value = ex.name
    description.value = ex.description || ''
    visibility.value = ex.visibility || 'public'
    boards.value = (ex.boards || [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(b => ({ deal_subfolder: b.deal_subfolder, deal_number: b.deal_number }))
  }
})
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  overflow-y: auto;
  z-index: 2000;
  padding: 20px;
}

.modal-content {
  background: white;
  border-radius: var(--radius-card, 10px);
  max-width: 920px;
  width: 100%;
  margin: auto;
  max-height: 90dvh;
  overflow: auto;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.2);
}

.step {
  padding: 28px 32px;
}

.step h2 {
  font-family: var(--font-heading, 'Source Serif 4', serif);
  font-size: 24px;
  color: var(--green-dark, #2d6a4f);
  margin-bottom: 8px;
}

.step-desc {
  color: var(--text-secondary, #6b7280);
  margin-bottom: 20px;
  font-size: 14px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  font-weight: 500;
  color: var(--text-primary, #1a1a1a);
  margin-bottom: 6px;
  font-size: 14px;
}

.optional {
  font-weight: 400;
  color: var(--text-muted, #9ca3af);
}

.form-input, .form-textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--card-border, #e0ddd7);
  border-radius: var(--radius-button, 6px);
  font-size: 15px;
  font-family: var(--font-body, 'DM Sans', sans-serif);
  color: var(--text-primary, #1a1a1a);
  box-sizing: border-box;
  background: white;
}

.form-input:focus, .form-textarea:focus {
  outline: none;
  border-color: var(--green-mid, #40916c);
}

.form-textarea { resize: vertical; }

.radio-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.radio-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--text-primary, #1a1a1a);
  cursor: pointer;
}

.form-hint {
  font-size: 13px;
  color: var(--text-muted, #9ca3af);
  margin: 4px 0 8px;
}

.editor-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-top: 8px;
}

.panel {
  border: 1px solid var(--card-border, #e0ddd7);
  border-radius: 8px;
  padding: 14px 16px;
  background: #fafafa;
  min-height: 280px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 10px;
}

.panel-header h3 {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #1a1a1a);
  margin: 0;
}

.btn-link {
  background: none;
  border: none;
  color: var(--green-dark, #2d6a4f);
  font-size: 13px;
  cursor: pointer;
  padding: 0;
}
.btn-link:hover { text-decoration: underline; }

.empty-hint {
  color: var(--text-muted, #9ca3af);
  font-size: 13px;
  text-align: center;
  margin: 30px 0;
}

.boards-list {
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 320px;
  overflow-y: auto;
}

.board-row {
  display: grid;
  grid-template-columns: 24px 1fr auto auto;
  gap: 8px;
  align-items: center;
  padding: 6px 6px 6px 0;
  border-bottom: 1px solid #efefee;
  font-size: 13px;
}

.board-pos {
  color: var(--text-muted, #9ca3af);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.board-id {
  display: flex;
  gap: 6px;
  align-items: baseline;
  min-width: 0;
}

.board-subfolder {
  font-weight: 500;
  color: var(--text-primary, #1a1a1a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.board-number {
  color: var(--text-muted, #9ca3af);
  font-family: monospace;
}

.wilderness-tag {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 8px;
  border-radius: 999px;
}

.wilderness-tag.tame {
  background: #d8efdc;
  color: #1f6638;
}

.wilderness-tag.wild {
  background: #fbe9b8;
  color: #7a5a08;
}

.row-actions {
  display: flex;
  gap: 2px;
}

.btn-icon {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  color: var(--text-secondary, #6b7280);
  font-size: 14px;
  line-height: 1;
}

.btn-icon:hover:not(:disabled) {
  background: #efefee;
  color: var(--text-primary, #1a1a1a);
}

.btn-icon:disabled { opacity: 0.3; cursor: not-allowed; }

.btn-icon.btn-remove:hover { color: var(--red, #ef4444); }

.mode-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--card-border, #e0ddd7);
}

.mode-tab {
  background: none;
  border: none;
  padding: 6px 12px;
  cursor: pointer;
  color: var(--text-secondary, #6b7280);
  font-size: 13px;
  font-weight: 500;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}

.mode-tab.active {
  color: var(--green-dark, #2d6a4f);
  border-bottom-color: var(--green-mid, #40916c);
}

.specific-picker, .random-picker { margin-top: 6px; }

.board-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(38px, 1fr));
  gap: 4px;
  margin-bottom: 12px;
  max-height: 200px;
  overflow-y: auto;
}

.board-btn {
  padding: 6px 0;
  border: 1px solid var(--card-border, #e0ddd7);
  background: white;
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
  cursor: pointer;
  color: var(--text-primary, #1a1a1a);
}

.board-btn:hover:not(.taken) {
  border-color: var(--green-mid, #40916c);
}

.board-btn.selected {
  background: var(--green-mid, #40916c);
  color: white;
  border-color: var(--green-mid, #40916c);
}

.board-btn.taken {
  background: #f3f4f6;
  color: var(--text-muted, #9ca3af);
  cursor: not-allowed;
}

.random-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.random-input { width: 80px; }

.random-of {
  font-size: 13px;
  color: var(--text-muted, #9ca3af);
}

.wilderness-summary {
  margin-top: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: var(--text-secondary, #6b7280);
}

.wilderness-summary .legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
  margin-right: 4px;
}
.wilderness-summary .legend-dot.wild { background: #d4a900; }
.wilderness-summary .legend-dot.tame { background: #1f6638; }
.wilderness-summary .hint { color: var(--text-muted, #9ca3af); margin-left: auto; }

.step-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 20px;
}

.btn {
  padding: 10px 20px;
  border-radius: var(--radius-button, 6px);
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
  font-family: var(--font-body, 'DM Sans', sans-serif);
}

.btn:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-primary { background: var(--green-mid, #40916c); color: white; }
.btn-primary:hover:not(:disabled) { background: var(--green-dark, #2d6a4f); }

.btn-secondary { background: #f3f4f6; color: var(--text-primary, #1a1a1a); }
.btn-secondary:hover { background: #e5e7eb; }

.error-text {
  color: var(--red, #ef4444);
  font-size: 14px;
  margin-top: 12px;
  text-align: center;
}

@media (max-width: 720px) {
  .editor-grid { grid-template-columns: 1fr; }
}
</style>

<template>
  <div class="exercises-tab">
    <div class="tab-header">
      <div>
        <h2 class="tab-title">My Exercises</h2>
        <p class="tab-desc">
          Build reusable board sequences. Assign them to a classroom from the Assignments tab.
        </p>
      </div>
      <button class="btn btn-primary" @click="openCreate">
        + New Exercise
      </button>
    </div>

    <div v-if="loading && myExercises.length === 0" class="empty-state">
      Loading exercises…
    </div>

    <div v-else-if="myExercises.length === 0" class="empty-state">
      <p class="empty-title">You haven't built any exercises yet.</p>
      <p class="empty-desc">
        An exercise is an ordered collection of boards — pick from one
        lesson, mix several, or randomise within a lesson.
      </p>
      <button class="btn btn-primary" @click="openCreate">Create your first exercise</button>
    </div>

    <div v-else class="exercise-list">
      <div v-for="ex in myExercises" :key="ex.id" class="exercise-row">
        <div class="row-main">
          <div class="row-title">
            <span class="ex-name">{{ ex.name }}</span>
            <span v-if="ex.visibility === 'private'" class="ex-visibility-tag">Private</span>
            <span
              v-if="ex.success_rate != null"
              class="success-rate"
              :class="successRateClass(ex.success_rate)"
              :title="`${ex.observation_count} observations · clean_correct ÷ total`"
            >{{ formatPercent(ex.success_rate) }}</span>
          </div>
          <div v-if="ex.description" class="ex-desc">{{ ex.description }}</div>
          <div class="ex-meta">
            {{ ex.board_count }} board{{ ex.board_count === 1 ? '' : 's' }}
            <span v-if="ex.assignment_count > 0">
              <span class="dot-sep">·</span>
              {{ ex.assignment_count }} assignment{{ ex.assignment_count === 1 ? '' : 's' }}
            </span>
            <span v-if="ex.student_count > 0">
              <span class="dot-sep">·</span>
              {{ ex.student_count }} student{{ ex.student_count === 1 ? '' : 's' }} played
            </span>
            <span class="dot-sep">·</span>
            Created {{ formatDate(ex.created_at) }}
          </div>
        </div>
        <div class="row-actions">
          <button class="btn-link" @click="openEdit(ex.id)">Edit</button>
          <button class="btn-link danger" @click="confirmDelete(ex)">Delete</button>
        </div>
      </div>
    </div>

    <p v-if="error" class="error-text">{{ error }}</p>

    <ExerciseEditorModal
      v-if="editorOpen"
      :exercise-id="editingId"
      @close="editorOpen = false"
      @saved="onSaved"
    />

    <!-- Delete confirmation -->
    <div v-if="pendingDelete" class="modal-overlay" @click.self="pendingDelete = null">
      <div class="confirm-modal">
        <h3>Delete "{{ pendingDelete.name }}"?</h3>
        <p>This soft-deletes the exercise. Concretely:</p>
        <ul class="impact-list">
          <li v-if="pendingDelete.assignment_count > 0">
            <strong>{{ pendingDelete.assignment_count }} assignment{{ pendingDelete.assignment_count === 1 ? '' : 's' }}</strong>
            will stay in place for history, but new attempts will be blocked.
          </li>
          <li v-else>No assignments reference this exercise.</li>
          <li v-if="pendingDelete.observation_count > 0">
            <strong>{{ pendingDelete.observation_count }} observation{{ pendingDelete.observation_count === 1 ? '' : 's' }}</strong>
            from <strong>{{ pendingDelete.student_count }} student{{ pendingDelete.student_count === 1 ? '' : 's' }}</strong>
            remain — they still count toward each student's lesson mastery.
          </li>
          <li v-else>No students have played this exercise yet.</li>
          <li v-if="pendingDelete.visibility === 'public' && otherTeacherAssignments(pendingDelete).length > 0">
            <strong>{{ otherTeacherAssignments(pendingDelete).length }}</strong>
            of those assignments {{ otherTeacherAssignments(pendingDelete).length === 1 ? 'was' : 'were' }}
            created by other teachers (this exercise is public).
          </li>
        </ul>
        <p class="confirm-note">The exercise will be hidden from listings but can be referenced by `exercise_id` in old observations.</p>
        <div class="confirm-actions">
          <button class="btn btn-secondary" @click="pendingDelete = null">Cancel</button>
          <button class="btn btn-danger" @click="doDelete">Delete</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useExercises } from '../../../composables/useExercises.js'
import { useUserStore } from '../../../composables/useUserStore.js'
import ExerciseEditorModal from '../ExerciseEditorModal.vue'

const userStore = useUserStore()
const exercisesStore = useExercises()

const editorOpen = ref(false)
const editingId = ref(null)
const pendingDelete = ref(null)
const error = ref(null)

const myExercises = computed(() => exercisesStore.exercises.value)
const loading = computed(() => exercisesStore.loading.value)

async function loadList() {
  const user = userStore.currentUser.value
  if (!user) return
  await exercisesStore.fetchExercises({ created_by: user.id })
}

function openCreate() {
  editingId.value = null
  editorOpen.value = true
}

function openEdit(id) {
  editingId.value = id
  editorOpen.value = true
}

function confirmDelete(ex) {
  pendingDelete.value = ex
}

async function doDelete() {
  const target = pendingDelete.value
  if (!target) return
  const user = userStore.currentUser.value
  const result = await exercisesStore.deleteExercise(target.id, user?.id)
  if (!result?.success) {
    error.value = exercisesStore.error.value || 'Could not delete exercise.'
  } else {
    error.value = null
  }
  pendingDelete.value = null
}

async function onSaved() {
  editorOpen.value = false
  editingId.value = null
  await loadList()
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return iso
  }
}

function formatPercent(rate) {
  return `${Math.round(rate * 100)}%`
}

// Mirrors the rateColor thresholds for the lesson-card recent accuracy
// (CORRECTNESS_AND_MASTERY.md §15.2) — same green/orange/red palette
// for a consistent eyeball read across the app.
function successRateClass(rate) {
  if (rate >= 0.75) return 'rate-green'
  if (rate >= 0.50) return 'rate-orange'
  return 'rate-red'
}

// Assignments authored by someone other than the current teacher
// (relevant only for public exercises that other teachers have picked up).
function otherTeacherAssignments(exercise) {
  const me = userStore.currentUser.value?.id
  return (exercise.assignments || []).filter(a => a.assigned_by && a.assigned_by !== me)
}

onMounted(loadList)
</script>

<style scoped>
.exercises-tab {
  padding: 4px 0;
}

.tab-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 20px;
  gap: 16px;
}

.tab-title {
  font-family: var(--font-heading, 'Source Serif 4', serif);
  font-size: 22px;
  color: var(--green-dark, #2d6a4f);
  margin: 0 0 4px;
}

.tab-desc {
  color: var(--text-secondary, #6b7280);
  font-size: 14px;
  margin: 0;
}

.empty-state {
  background: white;
  border: 1px dashed var(--card-border, #e0ddd7);
  border-radius: var(--radius-card, 10px);
  padding: 40px;
  text-align: center;
  color: var(--text-secondary, #6b7280);
}

.empty-title {
  font-size: 16px;
  color: var(--text-primary, #1a1a1a);
  font-weight: 600;
  margin: 0 0 6px;
}

.empty-desc {
  font-size: 14px;
  margin: 0 0 16px;
}

.exercise-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.exercise-row {
  background: white;
  border: 1px solid var(--card-border, #e0ddd7);
  border-radius: var(--radius-card, 10px);
  padding: 14px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.row-main { min-width: 0; flex: 1; }

.row-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.ex-name {
  font-weight: 600;
  font-size: 15px;
  color: var(--text-primary, #1a1a1a);
}

.ex-visibility-tag {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 8px;
  border-radius: 999px;
  background: #eef0f3;
  color: #5f6b7a;
}

.success-rate {
  margin-left: auto;
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  padding: 2px 8px;
  border-radius: 999px;
}
.success-rate.rate-green  { background: #d8efdc; color: #1f6638; }
.success-rate.rate-orange { background: #fbe9b8; color: #7a5a08; }
.success-rate.rate-red    { background: #fbd5d5; color: #8b1a1a; }

.ex-desc {
  color: var(--text-secondary, #6b7280);
  font-size: 13px;
  margin-top: 2px;
}

.ex-meta {
  color: var(--text-muted, #9ca3af);
  font-size: 12px;
  margin-top: 4px;
}

.dot-sep { margin: 0 6px; }

.row-actions {
  display: flex;
  gap: 14px;
  flex-shrink: 0;
}

.btn-link {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--green-dark, #2d6a4f);
  font-size: 14px;
  padding: 0;
  font-weight: 500;
}

.btn-link:hover { text-decoration: underline; }

.btn-link.danger { color: var(--red, #ef4444); }

.btn {
  padding: 8px 16px;
  border-radius: var(--radius-button, 6px);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  font-family: var(--font-body, 'DM Sans', sans-serif);
}

.btn-primary { background: var(--green-mid, #40916c); color: white; }
.btn-primary:hover { background: var(--green-dark, #2d6a4f); }

.btn-secondary { background: #f3f4f6; color: var(--text-primary, #1a1a1a); }
.btn-secondary:hover { background: #e5e7eb; }

.btn-danger { background: var(--red, #ef4444); color: white; }
.btn-danger:hover { background: #dc2626; }

.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex; align-items: flex-start; justify-content: center; overflow-y: auto;
  z-index: 2100; padding: 20px;
}

.confirm-modal {
  background: white;
  border-radius: var(--radius-card, 10px);
  padding: 24px 28px;
  max-width: 460px;
  width: 100%;
  margin: auto;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.2);
}

.confirm-modal h3 {
  font-family: var(--font-heading, 'Source Serif 4', serif);
  font-size: 18px;
  margin: 0 0 8px;
  color: var(--text-primary, #1a1a1a);
}

.confirm-modal p {
  color: var(--text-secondary, #6b7280);
  font-size: 14px;
  margin: 0 0 12px;
}

.impact-list {
  margin: 0 0 16px;
  padding-left: 18px;
  color: var(--text-secondary, #6b7280);
  font-size: 14px;
  line-height: 1.5;
}

.impact-list strong { color: var(--text-primary, #1a1a1a); }

.confirm-note {
  font-size: 12px;
  color: var(--text-muted, #9ca3af);
  margin: 0 0 20px;
}

.confirm-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}

.error-text {
  color: var(--red, #ef4444);
  font-size: 14px;
  margin-top: 12px;
}
</style>

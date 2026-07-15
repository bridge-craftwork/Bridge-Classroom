<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content">
      <div class="step">
        <h2>Create Assignment</h2>
        <p class="step-desc">Assign an exercise to a classroom or individual student.</p>

        <!-- Exercise selection -->
        <div class="form-group">
          <label for="exercise-select">Exercise</label>
          <select
            id="exercise-select"
            v-model="selectedExerciseId"
            class="form-select"
          >
            <option value="">Select an exercise...</option>
            <option
              v-for="ex in exercisesList"
              :key="ex.id"
              :value="ex.id"
            >{{ ex.name }} ({{ ex.board_count }} boards)</option>
          </select>
          <p v-if="exercisesLoading" class="form-hint">Loading exercises...</p>
        </div>

        <!-- Target selection -->
        <div class="form-group">
          <label>Assign to</label>
          <div class="target-options">
            <label class="radio-option">
              <input type="radio" v-model="targetType" value="classroom" />
              <span>Classroom</span>
            </label>
            <label class="radio-option">
              <input type="radio" v-model="targetType" value="student" />
              <span>Individual Student</span>
            </label>
          </div>
        </div>

        <!-- Classroom dropdown -->
        <div v-if="targetType === 'classroom'" class="form-group">
          <label for="classroom-select">Classroom</label>
          <select
            id="classroom-select"
            v-model="selectedClassroomId"
            class="form-select"
          >
            <option value="">Select a classroom...</option>
            <option
              v-for="c in classroomsList"
              :key="c.id"
              :value="c.id"
            >{{ c.name }} ({{ c.member_count }} students)</option>
          </select>
        </div>

        <!-- Student dropdown -->
        <div v-if="targetType === 'student'" class="form-group">
          <label for="student-select">Student</label>
          <select
            id="student-select"
            v-model="selectedStudentId"
            class="form-select"
          >
            <option value="">Select a student...</option>
            <option
              v-for="s in studentsList"
              :key="s.id"
              :value="s.id"
            >{{ s.first_name }} {{ s.last_name }}</option>
          </select>
        </div>

        <!-- Due date -->
        <div class="form-group">
          <label for="due-date">Due Date <span class="optional">(optional)</span></label>
          <input
            id="due-date"
            v-model="dueDate"
            type="date"
            class="form-input"
          />
        </div>

        <div class="step-actions">
          <button class="btn btn-secondary" @click="$emit('close')">Cancel</button>
          <button
            class="btn btn-primary"
            :disabled="!canCreate || creating"
            @click="handleCreate"
          >
            {{ creating ? 'Creating...' : 'Create Assignment' }}
          </button>
        </div>

        <p v-if="error" class="error-text">{{ error }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useUserStore } from '../../composables/useUserStore.js'
import { useExercises } from '../../composables/useExercises.js'
import { useAssignments } from '../../composables/useAssignments.js'
import { useClassrooms } from '../../composables/useClassrooms.js'
import { useTeacherRole } from '../../composables/useTeacherRole.js'

const props = defineProps({
  preselectedClassroomId: {
    type: String,
    default: null
  }
})

const emit = defineEmits(['close', 'assignment-created'])

const userStore = useUserStore()
const exercisesStore = useExercises()
const assignmentsStore = useAssignments()
const classroomsStore = useClassrooms()
const teacherRole = useTeacherRole()

const selectedExerciseId = ref('')
const targetType = ref('classroom')
const selectedClassroomId = ref(props.preselectedClassroomId || '')
const selectedStudentId = ref('')
const dueDate = ref('')
const creating = ref(false)
const error = ref(null)

const exercisesList = computed(() => exercisesStore.exercises.value)
const exercisesLoading = computed(() => exercisesStore.loading.value)
const classroomsList = computed(() => classroomsStore.teacherClassrooms.value)
const studentsList = computed(() => teacherRole.students.value)

const canCreate = computed(() => {
  if (!selectedExerciseId.value) return false
  if (targetType.value === 'classroom' && !selectedClassroomId.value) return false
  if (targetType.value === 'student' && !selectedStudentId.value) return false
  return true
})

async function handleCreate() {
  if (!canCreate.value || creating.value) return

  const user = userStore.currentUser.value
  if (!user) return

  creating.value = true
  error.value = null

  const result = await assignmentsStore.createAssignment({
    exercise_id: selectedExerciseId.value,
    classroom_id: targetType.value === 'classroom' ? selectedClassroomId.value : null,
    student_id: targetType.value === 'student' ? selectedStudentId.value : null,
    assigned_by: user.id,
    due_at: dueDate.value || null
  })

  if (result.success) {
    emit('assignment-created', result.assignment)
  } else {
    error.value = result.error || 'Failed to create assignment'
  }

  creating.value = false
}

onMounted(async () => {
  // Load exercises if not already loaded
  if (!exercisesStore.exercises.value.length) {
    await exercisesStore.fetchExercises()
  }

  // Load classrooms if not already loaded
  const user = userStore.currentUser.value
  if (user && !classroomsStore.teacherClassrooms.value.length) {
    await classroomsStore.fetchTeacherClassrooms(user.id)
  }
})
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
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
  max-width: 500px;
  width: 100%;
  margin: auto;
  max-height: 90dvh;
  overflow-y: auto;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.2);
}

.step {
  padding: 32px;
}

.step h2 {
  font-family: var(--font-heading, 'Source Serif 4', serif);
  font-size: 24px;
  color: var(--green-dark, #2d6a4f);
  margin-bottom: 8px;
}

.step-desc {
  color: var(--text-secondary, #6b7280);
  margin-bottom: 24px;
}

.form-group {
  margin-bottom: 20px;
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

.form-input,
.form-select {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--card-border, #e0ddd7);
  border-radius: var(--radius-button, 6px);
  font-size: 15px;
  font-family: var(--font-body, 'DM Sans', sans-serif);
  color: var(--text-primary, #1a1a1a);
  transition: border-color 0.2s;
  box-sizing: border-box;
  background: white;
}

.form-input:focus,
.form-select:focus {
  outline: none;
  border-color: var(--green-mid, #40916c);
}

.form-hint {
  font-size: 13px;
  color: var(--text-muted, #9ca3af);
  margin-top: 4px;
}

.target-options {
  display: flex;
  gap: 20px;
  margin-top: 4px;
}

.radio-option {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-weight: 400;
  font-size: 14px;
}

.radio-option input[type="radio"] {
  accent-color: var(--green-mid, #40916c);
}

.step-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 24px;
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

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--green-mid, #40916c);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: var(--green-dark, #2d6a4f);
}

.btn-secondary {
  background: #f3f4f6;
  color: var(--text-primary, #1a1a1a);
}

.btn-secondary:hover {
  background: #e5e7eb;
}

.error-text {
  color: var(--red, #ef4444);
  font-size: 14px;
  margin-top: 12px;
  text-align: center;
}
</style>

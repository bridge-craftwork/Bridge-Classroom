<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content">
      <div class="step">
        <h2>Create a Classroom</h2>
        <p class="step-desc">Set up a new classroom for your students.</p>

        <div class="form-group">
          <label for="classroom-name">Classroom Name</label>
          <input
            id="classroom-name"
            v-model="name"
            type="text"
            placeholder="e.g. Beginning Bridge — Spring 2026"
            class="form-input"
            @keyup.enter="handleCreate"
          />
          <p class="form-hint">Choose a name your students will recognize.</p>
        </div>

        <div class="form-group">
          <label for="classroom-desc">Description <span class="optional">(optional)</span></label>
          <textarea
            id="classroom-desc"
            v-model="description"
            placeholder="e.g. Tuesdays 10am — Focus on NT openings and responses"
            class="form-textarea"
            rows="3"
          ></textarea>
        </div>

        <div class="step-actions">
          <button class="btn btn-secondary" @click="$emit('close')">Cancel</button>
          <button
            class="btn btn-primary"
            :disabled="!name.trim() || creating"
            @click="handleCreate"
          >
            {{ creating ? 'Creating...' : 'Create Classroom' }}
          </button>
        </div>

        <p v-if="error" class="error-text">{{ error }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useUserStore } from '../../composables/useUserStore.js'
import { useClassrooms } from '../../composables/useClassrooms.js'

const emit = defineEmits(['close', 'classroom-created'])

const userStore = useUserStore()
const classrooms = useClassrooms()

const name = ref('')
const description = ref('')
const creating = ref(false)
const error = ref(null)

async function handleCreate() {
  if (!name.value.trim() || creating.value) return

  const user = userStore.currentUser.value
  if (!user) return

  creating.value = true
  error.value = null

  const result = await classrooms.createClassroom(
    user.id,
    name.value.trim(),
    description.value.trim() || null
  )

  if (result.success) {
    emit('classroom-created', result.classroom)
  } else {
    error.value = result.error || 'Failed to create classroom'
  }

  creating.value = false
}
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
.form-textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--card-border, #e0ddd7);
  border-radius: var(--radius-button, 6px);
  font-size: 15px;
  font-family: var(--font-body, 'DM Sans', sans-serif);
  color: var(--text-primary, #1a1a1a);
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.form-input:focus,
.form-textarea:focus {
  outline: none;
  border-color: var(--green-mid, #40916c);
}

.form-textarea {
  resize: vertical;
}

.form-hint {
  font-size: 13px;
  color: var(--text-muted, #9ca3af);
  margin-top: 4px;
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

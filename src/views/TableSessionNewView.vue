<template>
  <div class="tn-page">
    <div class="tn-card">
      <h2>New table session</h2>

      <!-- Gate: must be logged in (teacher for class sets) -->
      <template v-if="!currentUser">
        <p>You need to be signed in to host tables. Open the
          <a href="#/">main app</a> and sign in first.</p>
      </template>

      <!-- Creation is deliberately minimal: just spin up the session and land
           on the console. Tables, seating, and the deal source are all chosen
           live from the console (Shark model) — none of it is needed here. -->
      <form v-else @submit.prevent="create">
        <p class="tn-lead">
          Start a session, then manage the deal source (and seating) live from
          the teacher console.
        </p>

        <div class="tn-row">
          <label class="tn-label tn-inline">
            Tables
            <input v-model.number="tableCount" type="number" min="1" max="20" class="tn-num">
          </label>

          <label class="tn-label tn-inline">
            Rounds
            <select v-model="kind" class="tn-select">
              <option value="teacher_set">Teacher-run (I drive the boards)</option>
              <option value="adhoc">Casual (all boards open)</option>
            </select>
          </label>
        </div>
        <p class="tn-muted tn-hint">Adding/removing tables live from the console is coming next.</p>

        <p v-if="kind === 'teacher_set' && !isTeacher" class="tn-error">
          Teacher-run sessions need a teacher account — pick "Casual" or ask for
          the teacher role.
        </p>
        <p v-if="errorMessage" class="tn-error">{{ errorMessage }}</p>

        <button
          class="tn-btn tn-btn-primary tn-create"
          type="submit"
          :disabled="creating || (kind === 'teacher_set' && !isTeacher)"
        >
          {{ creating ? 'Starting…' : 'Start session' }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup>
// TableSessionNewView (#/tables/new) — deliberately minimal: create an empty
// session (no boards, default seating) and land on the teacher console, where
// the deal source (and later seating/tables) are managed live. The Mac API
// closes any previous open session of this owner.
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '../composables/useUserStore.js'
import { API_URL } from '../utils/apiUrl.js'

const API_KEY = import.meta.env.VITE_API_KEY || ''

const router = useRouter()
const userStore = useUserStore()
const currentUser = userStore.currentUser

const tableCount = ref(1)
const kind = ref('teacher_set')
const creating = ref(false)
const errorMessage = ref('')

const isTeacher = computed(() =>
  currentUser.value &&
  (currentUser.value.role === 'teacher' || currentUser.value.role === 'admin'))

async function apiPost(path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body ?? {}),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Request failed (${res.status})`)
  }
  return res.json()
}

// Create an empty session (no boards → idle) and go straight to the console.
// The deal source is loaded there. Seating defaults to first-free for now.
async function create() {
  errorMessage.value = ''
  creating.value = true
  try {
    const data = await apiPost('/table-sessions', {
      owner_user_id: currentUser.value.id,
      kind: kind.value,
      boards_pbn: '',
      table_count: tableCount.value || 1,
      seat_policy: { mode: 'auto', pattern: 'first_free' },
    })
    router.push(`/tables/console/${data.session.id}`)
  } catch (err) {
    errorMessage.value = err.message || 'Could not create the session.'
    creating.value = false
  }
}

onMounted(() => {
  userStore.initialize()
})
</script>

<style scoped>
.tn-page { font-family: 'Segoe UI', system-ui, sans-serif; }
.tn-card {
  max-width: 640px;
  margin: 48px auto;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 10px;
  padding: 28px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}
.tn-card h2 { margin: 0 0 14px; }

.tn-lead { color: #555; font-size: 14px; margin: 0 0 16px; line-height: 1.5; }
.tn-label { display: block; font-size: 14px; font-weight: 600; color: #333; margin-bottom: 10px; }
.tn-inline { display: flex; flex-direction: column; gap: 4px; }
.tn-row { display: flex; gap: 18px; flex-wrap: wrap; align-items: flex-end; margin: 10px 0; }
.tn-num { width: 70px; padding: 8px; border: 1px solid #ccc; border-radius: 6px; font-size: 14px; }
.tn-hint { margin: 6px 0; }
.tn-select { padding: 8px; border: 1px solid #ccc; border-radius: 6px; font-size: 14px; }

.tn-btn {
  padding: 8px 16px;
  border: 1px solid #ccc;
  border-radius: 6px;
  background: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.tn-btn:hover:not(:disabled) { border-color: #007bff; }
.tn-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.tn-btn-primary { background: #1d9e75; border-color: #1d9e75; color: #fff; }
.tn-btn-primary:hover:not(:disabled) { background: #178a65; border-color: #178a65; }
.tn-create { margin-top: 8px; }

.tn-muted { color: #777; font-size: 13px; }
.tn-error { color: #c62828; font-size: 14px; }
</style>

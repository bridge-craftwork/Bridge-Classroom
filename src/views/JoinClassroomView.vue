<template>
  <div class="join-page">
    <div class="join-card">
      <!-- Loading -->
      <div v-if="step === 'loading'" class="step-loading">
        <p>Loading classroom info...</p>
      </div>

      <!-- Error -->
      <div v-else-if="step === 'error'" class="step-error">
        <div class="error-icon">&#x26A0;</div>
        <h2>Classroom Not Found</h2>
        <p>{{ errorMessage }}</p>
        <router-link to="/" class="btn btn-primary">Go to Bridge Classroom</router-link>
      </div>

      <!-- Not logged in -->
      <div v-else-if="step === 'not-logged-in'" class="step-auth">
        <div class="card-header-gradient">
          <div class="join-icon">&#x2660;</div>
          <h2>{{ classroomName }}</h2>
          <p class="teacher-info">Taught by {{ teacherName }}</p>
        </div>
        <div class="card-body-section">
          <p v-if="classroomDescription" class="classroom-desc">{{ classroomDescription }}</p>
          <p class="auth-prompt">Sign in or create an account to join this classroom.</p>
          <div class="auth-actions">
            <button class="btn btn-primary" @click="goToAuth('signin')">Sign In to Join</button>
            <div class="divider-text">or</div>
            <button class="btn btn-secondary" @click="goToAuth('create')">Create an Account</button>
          </div>
        </div>
      </div>

      <!-- Confirm join (logged in) -->
      <div v-else-if="step === 'confirm'" class="step-confirm">
        <div class="card-header-gradient">
          <h2>Join {{ classroomName }}</h2>
          <p class="teacher-info">Teacher: {{ teacherName }}</p>
        </div>
        <div class="card-body-section">
          <div class="student-info">
            <strong>Your account:</strong>
            <p>{{ studentName }} ({{ studentEmail }})</p>
          </div>

          <div class="sharing-disclosure">
            <strong>What joining means:</strong>
            <p>Your teacher will be able to see your practice results (which exercises you've completed and your accuracy) for assignments in this classroom. You can leave the classroom at any time from your settings, which stops your teacher from seeing your progress on new assignments.</p>
          </div>

          <div v-if="!teacherViewerId" class="warning-box">
            <p>This classroom isn't ready for students yet. Please ask your teacher to check their setup.</p>
          </div>

          <div class="step-actions">
            <router-link to="/" class="btn btn-secondary">Decline</router-link>
            <button
              class="btn btn-primary"
              @click="handleJoin"
              :disabled="joining || !teacherViewerId"
            >
              {{ joining ? 'Joining...' : 'Join Classroom' }}
            </button>
          </div>

          <p v-if="joinError" class="error-text">{{ joinError }}</p>
        </div>
      </div>

      <!-- Already a member -->
      <div v-else-if="step === 'already-member'" class="step-success">
        <div class="success-icon">&#x2705;</div>
        <h2>Already Joined</h2>
        <p>You're already a member of <strong>{{ classroomName }}</strong>.</p>
        <router-link to="/" class="btn btn-primary btn-full">Go to Lobby</router-link>
      </div>

      <!-- Success -->
      <div v-else-if="step === 'success'" class="step-success">
        <div class="success-icon">&#x2705;</div>
        <h2>You're In!</h2>
        <p>Welcome to <strong>{{ classroomName }}</strong> with {{ teacherName }}.</p>

        <div class="info-items">
          <div class="info-item">
            <span class="info-icon">&#x1F4CB;</span>
            <span>Assignments from your teacher will appear in your lobby</span>
          </div>
          <div class="info-item">
            <span class="info-icon">&#x1F441;</span>
            <span>Your teacher can see your practice progress for assigned exercises</span>
          </div>
          <div class="info-item">
            <span class="info-icon">&#x2699;</span>
            <span>You can leave this classroom or change sharing at any time from Settings</span>
          </div>
        </div>

        <router-link to="/" class="btn btn-primary btn-full">Go to Lobby</router-link>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '../composables/useUserStore.js'
import { useClassrooms } from '../composables/useClassrooms.js'
import { createSharingGrant } from '../utils/crypto.js'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const classroomStore = useClassrooms()

const step = ref('loading')
const errorMessage = ref('')
const joinError = ref(null)
const joining = ref(false)

// Classroom info from server
const classroomName = ref('')
const classroomDescription = ref('')
const teacherName = ref('')
const teacherViewerId = ref(null)
const teacherPublicKey = ref(null)
const classroomId = ref(null)

// Student info
const studentName = ref('')
const studentEmail = ref('')

onMounted(async () => {
  const joinCode = route.params.joinCode

  // Ensure user store is initialized
  userStore.initialize()

  // Fetch classroom info (public endpoint)
  const info = await classroomStore.fetchJoinInfo(joinCode)

  if (!info) {
    step.value = 'error'
    errorMessage.value = classroomStore.error.value || 'This invite link is invalid or the classroom no longer exists.'
    return
  }

  classroomName.value = info.classroom_name
  classroomDescription.value = info.classroom_description
  teacherName.value = info.teacher_name
  teacherViewerId.value = info.teacher_viewer_id
  teacherPublicKey.value = info.teacher_public_key

  // Check if user is logged in
  if (!userStore.isAuthenticated.value) {
    step.value = 'not-logged-in'
    return
  }

  // User is logged in — show confirmation
  const user = userStore.currentUser.value
  studentName.value = `${user.firstName} ${user.lastName}`
  studentEmail.value = user.email || ''
  step.value = 'confirm'
})

function goToAuth() {
  // Store join code for redirect after auth
  sessionStorage.setItem('pendingJoinCode', route.params.joinCode)
  router.push('/')
}

async function handleJoin() {
  const user = userStore.currentUser.value
  if (!user || !teacherPublicKey.value) return

  joining.value = true
  joinError.value = null

  try {
    // Client-side: encrypt student's secret key with teacher's public key
    let encryptedPayload = ''
    try {
      encryptedPayload = await createSharingGrant(user.secretKey, teacherPublicKey.value)
    } catch (cryptoErr) {
      console.error('Failed to create sharing grant:', cryptoErr)
      joinError.value = 'Failed to create secure connection. Please try again.'
      joining.value = false
      return
    }

    // Server-side: create membership + grant
    const result = await classroomStore.joinClassroom(
      route.params.joinCode,
      user.id,
      encryptedPayload
    )

    if (result.success) {
      classroomId.value = result.classroom_id

      // Check if already a member
      if (result.error && result.error.includes('Already a member')) {
        step.value = 'already-member'
      } else {
        // Update local user store's classrooms array
        const currentClassrooms = user.classrooms || []
        if (result.classroom_id && !currentClassrooms.includes(result.classroom_id)) {
          userStore.updateUser(user.id, {
            classrooms: [...currentClassrooms, result.classroom_id]
          })
        }
        step.value = 'success'
      }
    } else {
      joinError.value = result.error || 'Failed to join classroom. Please try again.'
    }
  } catch (err) {
    console.error('Join failed:', err)
    joinError.value = 'Unable to connect to server. Please try again.'
  } finally {
    joining.value = false
  }
}
</script>

<style scoped>
.join-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-warm, #f5f3ef);
  font-family: var(--font-body, 'DM Sans', sans-serif);
  padding: 20px;
}

.join-card {
  background: white;
  border-radius: var(--radius-card, 10px);
  border: 1px solid var(--card-border, #e0ddd7);
  max-width: 480px;
  width: 100%;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
}

/* Gradient header for classroom info */
.card-header-gradient {
  background: linear-gradient(135deg, var(--green-dark, #2d6a4f), #1d4e89);
  color: white;
  padding: 32px;
  text-align: center;
}

.card-header-gradient h2 {
  font-family: var(--font-heading, 'Source Serif 4', serif);
  font-size: 24px;
  margin: 0 0 6px 0;
}

.join-icon {
  font-size: 36px;
  margin-bottom: 12px;
}

.teacher-info {
  opacity: 0.85;
  font-size: 15px;
  margin: 0;
}

.card-body-section {
  padding: 28px 32px 32px;
}

/* Loading */
.step-loading {
  padding: 48px 32px;
  text-align: center;
  color: var(--text-secondary, #6b7280);
}

/* Error */
.step-error {
  padding: 48px 32px;
  text-align: center;
}

.error-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.step-error h2 {
  font-family: var(--font-heading, 'Source Serif 4', serif);
  color: var(--text-primary, #1a1a1a);
  margin-bottom: 8px;
}

.step-error p {
  color: var(--text-secondary, #6b7280);
  margin-bottom: 24px;
}

/* Auth (not logged in) */
.classroom-desc {
  color: var(--text-secondary, #6b7280);
  font-size: 14px;
  margin-bottom: 16px;
}

.auth-prompt {
  color: var(--text-secondary, #6b7280);
  margin-bottom: 20px;
}

.auth-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
}

.divider-text {
  color: var(--text-muted, #9ca3af);
  font-size: 13px;
}

/* Confirm */
.student-info {
  background: #f9fafb;
  border-radius: var(--radius-button, 6px);
  padding: 12px 16px;
  margin-bottom: 16px;
  font-size: 14px;
}

.student-info strong {
  display: block;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary, #6b7280);
  margin-bottom: 4px;
}

.student-info p {
  margin: 0;
  color: var(--text-primary, #1a1a1a);
}

.sharing-disclosure {
  background: #e3edf7;
  border-radius: var(--radius-button, 6px);
  padding: 12px 16px;
  margin-bottom: 20px;
  font-size: 14px;
  line-height: 1.5;
}

.sharing-disclosure strong {
  display: block;
  color: #1d4e89;
  margin-bottom: 4px;
}

.sharing-disclosure p {
  margin: 0;
  color: #2c3e50;
}

.warning-box {
  background: var(--amber-light, #fef3c7);
  border-radius: var(--radius-button, 6px);
  padding: 12px 16px;
  margin-bottom: 16px;
  font-size: 14px;
  color: #92400e;
}

.warning-box p {
  margin: 0;
}

.step-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

/* Success */
.step-success {
  padding: 48px 32px;
  text-align: center;
}

.success-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.step-success h2 {
  font-family: var(--font-heading, 'Source Serif 4', serif);
  font-size: 24px;
  color: var(--green-dark, #2d6a4f);
  margin-bottom: 8px;
}

.step-success p {
  color: var(--text-secondary, #6b7280);
  margin-bottom: 24px;
}

.info-items {
  text-align: left;
  margin-bottom: 24px;
}

.info-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 0;
  font-size: 14px;
  color: var(--text-primary, #1a1a1a);
  line-height: 1.4;
}

.info-icon {
  font-size: 18px;
  flex-shrink: 0;
  margin-top: 1px;
}

/* Shared button styles */
.btn {
  display: inline-block;
  padding: 10px 20px;
  border-radius: var(--radius-button, 6px);
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
  font-family: var(--font-body, 'DM Sans', sans-serif);
  text-decoration: none;
  text-align: center;
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

.btn-full {
  display: block;
  width: 100%;
  box-sizing: border-box;
}

.error-text {
  color: var(--red, #ef4444);
  font-size: 14px;
  margin-top: 12px;
  text-align: center;
}
</style>

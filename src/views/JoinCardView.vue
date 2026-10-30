<template>
  <!-- A partner's invitation to share a convention card (#436). The link is
       /cards/join/<token> on bridge-classroom.org; joining needs a signed-in
       account (sessions don't cross .com/.org, so a .com regular signs in
       here with the emailed code: same account). -->
  <div class="join-page">
    <div class="join-card">
      <div v-if="step === 'loading'" class="step-loading">
        <p>Loading the invitation...</p>
      </div>

      <div v-else-if="step === 'error'" class="step-error">
        <div class="error-icon">&#x26A0;</div>
        <h2>Invitation not available</h2>
        <p>{{ errorMessage }}</p>
        <router-link to="/" class="btn btn-primary">Go to Bridge Classroom</router-link>
      </div>

      <template v-else-if="step === 'not-logged-in' || step === 'confirm'">
        <div class="card-header-gradient">
          <div class="join-icon">&#x2660;</div>
          <h2>{{ invite.card_name }}</h2>
          <p class="teacher-info">{{ invite.invited_by }} is sharing this convention card with you</p>
        </div>
        <div class="card-body-section">
          <div class="sharing-disclosure">
            <strong>{{ invite.role === 'editor' ? 'You can edit it' : 'You can view it' }}</strong>
            <p v-if="invite.role === 'editor'">Changes either of you saves are seen by both. The card appears in your list of cards.</p>
            <p v-else>You'll see the card as your partner keeps it up to date. The card appears in your list of cards.</p>
          </div>

          <template v-if="step === 'not-logged-in'">
            <p class="auth-prompt">Sign in to join this card. Use the email address you use for Bridge Classroom; we'll send you a sign-in code.</p>
            <div class="auth-actions">
              <button class="btn btn-primary" @click="goToAuth">Sign In to Join</button>
            </div>
          </template>

          <template v-else>
            <div class="student-info">
              <strong>Your account:</strong>
              <p>{{ userName }}<span v-if="userEmail"> ({{ userEmail }})</span></p>
            </div>
            <div class="step-actions">
              <router-link to="/" class="btn btn-secondary">Not now</router-link>
              <button class="btn btn-primary" :disabled="joining" @click="handleJoin">
                {{ joining ? 'Joining...' : 'Join this card' }}
              </button>
            </div>
            <p v-if="joinError" class="error-text">{{ joinError }}</p>
          </template>
        </div>
      </template>

      <div v-else-if="step === 'success'" class="step-success">
        <div class="success-icon">&#x2705;</div>
        <h2>{{ joined ? "You're in" : 'Already shared with you' }}</h2>
        <p><strong>{{ invite.card_name }}</strong> is in your cards{{ role === 'viewer' ? ' to view' : '' }}.</p>
        <router-link to="/convention-card" class="btn btn-primary btn-full">Open my cards</router-link>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '../composables/useUserStore.js'
import { apiFetch, API_URL } from '../utils/apiFetch.js'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const step = ref('loading')
const errorMessage = ref('')
const invite = ref({})
const joining = ref(false)
const joinError = ref(null)
const joined = ref(false)
const role = ref('')

const token = computed(() => route.params.token)
const userName = computed(() => {
  const u = userStore.currentUser.value
  return u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : ''
})
const userEmail = computed(() => userStore.currentUser.value?.email || '')

async function readError(res) {
  const text = await res.text().catch(() => '')
  return text || `The invitation couldn't be opened (${res.status}).`
}

onMounted(async () => {
  userStore.initialize()
  let res
  try {
    res = await apiFetch(`${API_URL}/cards/join/${encodeURIComponent(token.value)}`)
  } catch {
    step.value = 'error'
    errorMessage.value = "Bridge Classroom's server can't be reached right now. Please try again shortly."
    return
  }
  if (!res.ok) {
    step.value = 'error'
    errorMessage.value = await readError(res)
    return
  }
  invite.value = await res.json()
  step.value = userStore.isAuthenticated.value ? 'confirm' : 'not-logged-in'
})

function goToAuth() {
  // Back here after signing in (MainLayout resumes it)
  sessionStorage.setItem('pendingCardInvite', token.value)
  router.push('/')
}

async function handleJoin() {
  const user = userStore.currentUser.value
  if (!user) return
  joining.value = true
  joinError.value = null
  try {
    const res = await apiFetch(`${API_URL}/cards/join/${encodeURIComponent(token.value)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acting_user_id: user.id }),
    })
    if (res.status === 401) {
      // Signed in here before durable sessions, or on another device: a fresh
      // sign-in mints the session this needs.
      joinError.value = 'Please sign in again to join (your session on this browser has expired).'
      return
    }
    if (!res.ok) {
      joinError.value = await readError(res)
      return
    }
    const r = await res.json()
    joined.value = r.joined
    role.value = r.role
    step.value = 'success'
  } catch {
    joinError.value = 'Unable to connect to the server. Please try again.'
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

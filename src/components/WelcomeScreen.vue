<script setup>
import { ref, computed, onMounted } from 'vue'
import { useAppConfig } from '../composables/useAppConfig.js'
import { useUserStore } from '../composables/useUserStore.js'
import { useDataSync } from '../composables/useDataSync.js'
import { logDiagnostic, flush as flushDiagnostics } from '../utils/diagnostics.js'
import { API_URL } from '@/utils/apiUrl.js'

const emit = defineEmits(['userReady'])

const appConfig = useAppConfig()
const userStore = useUserStore()
const dataSync = useDataSync()

// View state: 'form' | 'returning' | 'switcher' | 'recovery-sent' | 'recovery-claiming'
const viewState = ref('form')

// Form data
const firstName = ref('')
const lastName = ref('')
const email = ref('')
const selectedClassrooms = ref([])
const dataConsent = ref(true)

// Form validation errors
const errors = ref({
  firstName: '',
  lastName: '',
  email: '',
  classrooms: ''
})

// UI state
const showConsentDetails = ref(false)
const isLoading = ref(false)
const loadingMessage = ref('')

// Recovery state
const recoveryEmail = ref('')
const recoveryError = ref('')
const recoveryMessage = ref('')
const recoveryCode = ref('')

// Initialize
onMounted(async () => {
  userStore.initialize()
  appConfig.initializeFromUrl()

  // Check for recovery URL parameters
  const urlParams = new URLSearchParams(window.location.search)
  const recoverToken = urlParams.get('recover')
  const recoverUserId = urlParams.get('user_id')

  if (recoverToken && recoverUserId) {
    // Handle account recovery from magic link
    await handleRecoveryClaim(recoverUserId, recoverToken)
    // Clean URL after processing
    window.history.replaceState({}, document.title, window.location.pathname)
    return
  }

  // Determine initial view
  if (userStore.hasUsers.value && userStore.currentUser.value) {
    viewState.value = 'returning'
  } else if (userStore.hasUsers.value) {
    viewState.value = 'switcher'
  } else {
    viewState.value = 'form'
  }

  // If single classroom, auto-select it
  if (appConfig.hasSingleClassroom.value) {
    selectedClassrooms.value = [appConfig.singleClassroom.value.id]
  }
})

// Email validation regex
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Detect Safari browser (has known issues with cross-origin requests)
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)

// Computed
const isFormValid = computed(() => {
  return (
    firstName.value.trim().length > 0 &&
    lastName.value.trim().length > 0 &&
    email.value.trim().length > 0 &&
    emailRegex.test(email.value.trim())
  )
})

const displayName = computed(() => {
  if (userStore.currentUser.value) {
    return userStore.currentUser.value.firstName
  }
  return ''
})

const teacherDisplay = computed(() => {
  if (appConfig.teacherName.value) {
    return `${appConfig.teacherName.value}'s Bridge Classroom`
  }
  return 'Bridge Bidding Practice'
})

const currentHost = computed(() => window.location.hostname || 'bridge-classroom.com')

// Methods
function validateForm() {
  errors.value = { firstName: '', lastName: '', email: '', classrooms: '' }
  let valid = true

  if (!firstName.value.trim()) {
    errors.value.firstName = 'First name is required'
    valid = false
  }

  if (!lastName.value.trim()) {
    errors.value.lastName = 'Last name is required'
    valid = false
  }

  if (!email.value.trim()) {
    errors.value.email = 'Email is required'
    valid = false
  } else if (!emailRegex.test(email.value.trim())) {
    errors.value.email = 'Please enter a valid email address'
    valid = false
  }

  // Check if email already in use locally
  const existingUser = userStore.findUserByEmail(email.value)
  if (existingUser) {
    errors.value.email = 'This email is already registered on this device.'
    valid = false
  }

  return valid
}

/**
 * Check if email exists on server and offer recovery if so
 * @returns {Promise<boolean>} True if should proceed with registration
 */
async function checkEmailOnServer() {
  const emailToCheck = email.value.trim().toLowerCase()

  // If offline, skip server check and proceed with local registration
  if (!navigator.onLine) {
    logDiagnostic('registration_offline', 'checkEmailOnServer — navigator.onLine is false, skipping server check')
    return true
  }

  try {
    // Try to request recovery - if successful, account exists
    const result = await userStore.requestRecovery(emailToCheck, API_URL)

    if (result.success) {
      // Account exists - recovery link sent
      recoveryEmail.value = emailToCheck
      recoveryMessage.value = result.message
      viewState.value = 'recovery-sent'
      return false
    } else if (result.message && result.message.includes('No account found')) {
      // No account found - proceed with registration
      return true
    } else {
      // Online but got an unexpected error - show it to the user
      logDiagnostic('registration_email_check_unexpected', `checkEmailOnServer — unexpected result for ${emailToCheck}`, result.message)
      await flushDiagnostics()
      errors.value.email = result.message || 'Unable to verify email. Please try again.'
      return false
    }
  } catch (err) {
    // Online but request failed (CORS, network error, etc.) - show error
    logDiagnostic('registration_email_check_failed', `checkEmailOnServer — fetch failed for ${emailToCheck}`, err)
    await flushDiagnostics()
    if (isSafari) {
      errors.value.email = 'Safari is blocking the connection. Please try Chrome or Firefox, or enable Safari Developer Tools (Settings → Advanced → Show features for web developers).'
    } else {
      errors.value.email = 'Unable to connect to server. Please check your connection and try again. If using a VPN, try disabling it.'
    }
    return false
  }
}

/**
 * Handle recovery claim from magic link
 */
async function handleRecoveryClaim(userId, token) {
  viewState.value = 'recovery-claiming'
  isLoading.value = true
  loadingMessage.value = 'Recovering your account...'
  recoveryError.value = ''

  try {
    const result = await userStore.claimRecovery(userId, token, API_URL)

    if (result.success && result.user) {
      emit('userReady', result.user)
    } else {
      recoveryError.value = result.error || 'Recovery failed. Please try again.'
      viewState.value = 'form'
    }
  } catch (err) {
    logDiagnostic('recovery_claim_failed', `handleRecoveryClaim — claimRecovery threw for userId=${userId}`, err)
    recoveryError.value = 'Unable to complete recovery. Please try again.'
    viewState.value = 'form'
  } finally {
    isLoading.value = false
    loadingMessage.value = ''
  }
}

/**
 * Handle "Send recovery link" button click
 */
async function handleRequestRecovery() {
  if (!recoveryEmail.value.trim()) {
    recoveryError.value = 'Please enter your email address'
    return
  }

  isLoading.value = true
  loadingMessage.value = 'Sending recovery link...'
  recoveryError.value = ''

  try {
    const result = await userStore.requestRecovery(recoveryEmail.value.trim(), API_URL)

    if (result.success) {
      recoveryMessage.value = result.message
      viewState.value = 'recovery-sent'
    } else {
      recoveryError.value = result.message || 'Failed to send recovery link'
    }
  } catch (err) {
    logDiagnostic('recovery_request_failed', `handleRequestRecovery — requestRecovery threw for ${recoveryEmail.value.trim()}`, err)
    recoveryError.value = 'Unable to connect to server. Please try again.'
  } finally {
    isLoading.value = false
    loadingMessage.value = ''
  }
}

/**
 * Handle recovery code submission
 */
async function handleClaimByCode() {
  if (recoveryCode.value.trim().length !== 6) return

  isLoading.value = true
  loadingMessage.value = 'Verifying code...'
  recoveryError.value = ''

  try {
    const result = await userStore.claimRecoveryByCode(
      recoveryEmail.value.trim(),
      recoveryCode.value.trim(),
      API_URL
    )

    if (result.success && result.user) {
      emit('userReady', result.user)
    } else {
      recoveryError.value = result.error || 'Invalid code. Please check and try again.'
    }
  } catch (err) {
    logDiagnostic('recovery_code_claim_failed', `handleClaimByCode — claimRecoveryByCode threw for ${recoveryEmail.value.trim()}`, err)
    recoveryError.value = 'Unable to connect to server. Please try again.'
  } finally {
    isLoading.value = false
    loadingMessage.value = ''
  }
}

async function handleSubmit() {
  if (!validateForm()) return

  // Show loading state while checking server
  isLoading.value = true
  loadingMessage.value = 'Checking account...'

  // Check if email already exists on server
  const shouldProceed = await checkEmailOnServer()
  if (!shouldProceed) {
    // Recovery flow was triggered or error occurred
    isLoading.value = false
    loadingMessage.value = ''
    return
  }

  // Determine classrooms
  let classrooms = []
  if (appConfig.hasSingleClassroom.value) {
    classrooms = [appConfig.singleClassroom.value.id]
  } else if (appConfig.hasMultipleClassrooms.value) {
    classrooms = [...selectedClassrooms.value]
  }
  // If ad-hoc, classrooms stays empty

  // Continue with user creation
  loadingMessage.value = 'Creating your secure encryption key...'

  try {
    // Create user with AES secret key and admin sharing grant
    const user = await userStore.createUser({
      firstName: firstName.value,
      lastName: lastName.value,
      email: email.value,
      classrooms,
      dataConsent: dataConsent.value,
      apiUrl: API_URL
    })

    // Persist the new account to the server immediately (creates the server
    // user + uploads the recovery key) instead of waiting for a background
    // sync trigger. Fire-and-forget: never block onboarding, and it's
    // offline-safe (performSync no-ops when offline, leaving the background
    // triggers as fallback). POST /api/users is idempotent by user_id, so
    // this can't conflict with handleUserReady's own sync.
    dataSync.forceSync().catch(() => {})

    emit('userReady', user)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    logDiagnostic('registration_create_user_failed', `handleSubmit — createUser threw for ${email.value.trim()}`, err)
    await flushDiagnostics()
    errors.value.email = `Failed to create account: ${detail}. Please try again.`
  } finally {
    isLoading.value = false
    loadingMessage.value = ''
  }
}

function handleContinue() {
  emit('userReady', userStore.currentUser.value)
}

function handleSwitchUser() {
  viewState.value = 'switcher'
}

function handleSelectUser(userId) {
  userStore.switchUser(userId)
  emit('userReady', userStore.currentUser.value)
}

function handleAddNewUser() {
  // Clear form
  firstName.value = ''
  lastName.value = ''
  email.value = ''
  selectedClassrooms.value = appConfig.hasSingleClassroom.value
    ? [appConfig.singleClassroom.value.id]
    : []
  dataConsent.value = true
  errors.value = { firstName: '', lastName: '', email: '', classrooms: '' }

  viewState.value = 'form'
}

function handleBackToReturning() {
  if (userStore.currentUser.value) {
    viewState.value = 'returning'
  } else if (userStore.hasUsers.value) {
    viewState.value = 'switcher'
  }
}

function toggleClassroom(classroomId) {
  const index = selectedClassrooms.value.indexOf(classroomId)
  if (index === -1) {
    selectedClassrooms.value.push(classroomId)
  } else {
    selectedClassrooms.value.splice(index, 1)
  }
}

</script>

<template>
  <div class="welcome-screen">

    <!-- Nav matching landing pages -->
    <nav class="welcome-nav">
      <a class="nav-logo" href="/">
        <span class="suit">&#9824;</span> Bridge Classroom
      </a>
    </nav>

    <div class="welcome-main">

      <!-- Left: form panel -->
      <div class="form-panel">
        <div class="form-inner">

          <!-- First-time user form -->
          <template v-if="viewState === 'form'">
            <h1>{{ teacherDisplay }}</h1>
            <p class="subtitle">Enter your details to get started. Free — no partner needed.</p>

            <form @submit.prevent="handleSubmit" class="user-form">
              <div class="form-row">
                <div class="form-group">
                  <label for="firstName">First Name</label>
                  <input id="firstName" v-model="firstName" type="text" placeholder="e.g. Terry"
                    :class="{ 'has-error': errors.firstName }" autocomplete="given-name" />
                  <span v-if="errors.firstName" class="error-message">{{ errors.firstName }}</span>
                </div>
                <div class="form-group">
                  <label for="lastName">Last Name</label>
                  <input id="lastName" v-model="lastName" type="text" placeholder="e.g. Lee"
                    :class="{ 'has-error': errors.lastName }" autocomplete="family-name" />
                  <span v-if="errors.lastName" class="error-message">{{ errors.lastName }}</span>
                </div>
              </div>

              <div class="form-group">
                <label for="email">Email Address</label>
                <input id="email" v-model="email" type="email" placeholder="you@example.com"
                  :class="{ 'has-error': errors.email }" autocomplete="email" />
                <span v-if="errors.email" class="error-message">{{ errors.email }}</span>
                <span class="field-hint">Used for account recovery and sharing with your teacher</span>
              </div>

              <div v-if="appConfig.hasMultipleClassrooms.value" class="form-group">
                <label>Select Your Class(es)</label>
                <div class="checkbox-group">
                  <label v-for="classroom in appConfig.availableClassrooms.value" :key="classroom.id" class="checkbox-label">
                    <input type="checkbox" :value="classroom.id"
                      :checked="selectedClassrooms.includes(classroom.id)"
                      @change="toggleClassroom(classroom.id)" />
                    <span>{{ classroom.name }}</span>
                  </label>
                </div>
              </div>

              <div v-else-if="appConfig.hasSingleClassroom.value" class="form-group">
                <label>Class</label>
                <div class="single-classroom">{{ appConfig.singleClassroom.value.name }}</div>
              </div>

              <div class="form-group consent-group">
                <label class="checkbox-label consent-label">
                  <input type="checkbox" v-model="dataConsent" />
                  <span>Preserve my practice history</span>
                </label>
                <button type="button" class="details-toggle" @click="showConsentDetails = !showConsentDetails">
                  {{ showConsentDetails ? 'Hide details' : 'What data is preserved?' }}
                </button>
                <div v-if="showConsentDetails" class="consent-details">
                  <p>Your practice history is saved online so you can track your progress over time.</p>
                  <p><strong>What's preserved:</strong> which hands you practiced, your bidding choices, and when you practiced. Data is encrypted with your personal key.</p>
                  <p class="consent-note">You can change this setting anytime in Settings.</p>
                </div>
              </div>

              <button type="submit" class="submit-btn" :disabled="!isFormValid || isLoading">
                <span v-if="isLoading">{{ loadingMessage }}</span>
                <span v-else>Start Practicing &#8212; it's free</span>
              </button>
            </form>

            <button v-if="userStore.hasUsers.value" class="back-link" @click="handleBackToReturning">
              Back to user selection
            </button>
          </template>

          <!-- Returning user -->
          <template v-else-if="viewState === 'returning'">
            <h1>Welcome back, {{ displayName }}!</h1>
            <p class="subtitle">Ready to continue practicing?</p>
            <button class="submit-btn full-width" @click="handleContinue">Continue</button>
            <button class="switch-link" @click="handleSwitchUser">Not {{ displayName }}? Switch user</button>
          </template>

          <!-- User switcher -->
          <template v-else-if="viewState === 'switcher'">
            <h1>Select User</h1>
            <p class="subtitle">Choose who's practicing today:</p>
            <div class="user-list">
              <button v-for="user in userStore.allUsers.value" :key="user.id" class="user-item"
                :class="{ 'is-current': user.id === userStore.currentUserId.value }"
                @click="handleSelectUser(user.id)">
                <span class="user-name">{{ user.firstName }} {{ user.lastName }}</span>
                <span v-if="user.email" class="user-email">{{ user.email }}</span>
              </button>
            </div>
            <button class="add-user-btn" @click="handleAddNewUser">+ Add New User</button>
            <button v-if="userStore.currentUser.value" class="back-link" @click="handleBackToReturning">Cancel</button>
          </template>

          <!-- Recovery link sent -->
          <template v-else-if="viewState === 'recovery-sent'">
            <h1>Check Your Email</h1>
            <p class="subtitle">We found an existing account for <strong>{{ recoveryEmail }}</strong>.</p>
            <div class="recovery-info">
              <p>{{ recoveryMessage }}</p>
              <p class="recovery-note">Click the link in the email, or enter the 6-digit code below.</p>
              <p class="recovery-note spam-note">Don't see it? It can take a minute to arrive — be sure to check your spam or junk folder.</p>
            </div>
            <div class="code-entry">
              <label for="recoveryCode">Recovery Code</label>
              <input id="recoveryCode" v-model="recoveryCode" type="text" inputmode="numeric"
                pattern="[0-9]*" maxlength="6" placeholder="000000" class="code-input"
                autocomplete="one-time-code" @keyup.enter="handleClaimByCode" />
              <button class="submit-btn" :disabled="recoveryCode.trim().length !== 6 || isLoading" @click="handleClaimByCode">
                <span v-if="isLoading">{{ loadingMessage }}</span>
                <span v-else>Restore Account</span>
              </button>
              <span v-if="recoveryError" class="error-message">{{ recoveryError }}</span>
            </div>
            <button class="back-link" @click="viewState = 'form'">Use a different email</button>
          </template>

          <!-- Recovery claiming -->
          <template v-else-if="viewState === 'recovery-claiming'">
            <h1>Restoring Your Account</h1>
            <p class="subtitle">{{ loadingMessage }}</p>
            <div v-if="recoveryError" class="recovery-error-panel">
              <p class="error-message">{{ recoveryError }}</p>
              <button class="back-link" @click="viewState = 'form'">Try again</button>
            </div>
            <div v-else class="loading-spinner">
              <div class="spinner"></div>
            </div>
          </template>

        </div>
      </div>

      <!-- Right: screenshot panel -->
      <div class="preview-panel">
        <div class="preview-inner">
          <div class="preview-screenshot">
            <img :src="'/screenshots/solo-practice-detail.png'" alt="Bridge bidding practice" />
          </div>
          <p class="preview-caption">Practice bidding deals, track your mastery, and pick up where you left off on any device.</p>
        </div>
      </div>

    </div>

    <!-- Footer -->
    <div class="welcome-footer">
      <div class="footer-links">
        <a class="footer-link" href="https://github.com/bridge-craftwork/Bridge-Classroom" target="_blank">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/></svg>
          GitHub
        </a>
        <a class="footer-link" href="https://discord.gg/GqyyU3sVS4" target="_blank">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>
          Discord
        </a>
        <a class="footer-link" href="mailto:bridge-craftwork@gmail.com">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          Email support
        </a>
        <a class="footer-link" href="https://patreon.com/BridgeCraftwork" target="_blank">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M14.82 2.41C18.78 2.41 22 5.65 22 9.62c0 3.96-3.22 7.18-7.18 7.18-3.96 0-7.17-3.22-7.17-7.18 0-3.97 3.21-7.21 7.17-7.21M2 21.6h3.5V2.41H2V21.6z"/></svg>
          Patreon
        </a>
        <a class="footer-link" href="/about.html">About</a>
      </div>
      <div class="footer-copy">Bridge Classroom &middot; free &amp; open source &middot; {{ currentHost }}</div>
    </div>

  </div>
</template>

<style scoped>
* { box-sizing: border-box; }

.welcome-screen {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f5f5f2;
  font-family: 'DM Sans', sans-serif;
}

/* Nav */
.welcome-nav {
  display: flex;
  align-items: center;
  padding: 11px 32px;
  border-bottom: 0.5px solid #e0e0e0;
  background: white;
  flex-shrink: 0;
}
.nav-logo {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 500;
  color: #1a1a1a;
  text-decoration: none;
}
.suit { color: #1D9E75; }

/* Main two-column layout */
.welcome-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  flex: 1;
  align-items: stretch;
}

/* Form panel */
.form-panel {
  background: white;
  border-right: 0.5px solid #e0e0e0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 48px 40px;
  overflow-y: auto;
}
.form-inner {
  width: 100%;
  max-width: 400px;
}
.form-inner h1 {
  font-size: 22px;
  font-weight: 500;
  color: #1a1a1a;
  margin: 0 0 6px 0;
  line-height: 1.3;
}
.subtitle {
  color: #666;
  font-size: 13px;
  margin: 0 0 28px 0;
  line-height: 1.6;
}

/* Form elements */
.user-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.form-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.form-group label {
  font-size: 12px;
  font-weight: 500;
  color: #555;
}
.form-group input[type="text"],
.form-group input[type="email"] {
  padding: 9px 12px;
  border: 0.5px solid #d0d0d0;
  border-radius: 8px;
  font-size: 14px;
  font-family: inherit;
  background: white;
  color: #1a1a1a;
  transition: border-color 0.15s;
}
.form-group input:focus {
  outline: none;
  border-color: #1D9E75;
  box-shadow: 0 0 0 2px rgba(29, 158, 117, 0.1);
}
.form-group input.has-error { border-color: #d32f2f; }

.field-hint {
  font-size: 11px;
  color: #999;
}
.error-message {
  color: #d32f2f;
  font-size: 12px;
}

.single-classroom {
  padding: 9px 12px;
  background: #f5f5f5;
  border-radius: 8px;
  font-size: 14px;
  color: #333;
}

.checkbox-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 14px;
  color: #444;
}
.checkbox-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: #1D9E75;
}

.consent-group {
  padding-top: 8px;
  border-top: 0.5px solid #eee;
}
.consent-label { font-weight: normal; }
.consent-label span { font-size: 13px; color: #555; }

.details-toggle {
  background: none;
  border: none;
  color: #1D9E75;
  font-size: 12px;
  cursor: pointer;
  padding: 3px 0;
  text-align: left;
  font-family: inherit;
}
.details-toggle:hover { text-decoration: underline; }

.consent-details {
  margin-top: 10px;
  padding: 12px 14px;
  background: #f0f7f4;
  border-radius: 8px;
  font-size: 12px;
  color: #555;
  line-height: 1.6;
}
.consent-details p { margin: 0 0 6px 0; }
.consent-details p:last-child { margin-bottom: 0; }
.consent-note { font-style: italic; color: #888; }

.submit-btn {
  padding: 11px 20px;
  background: #1D9E75;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s;
  width: 100%;
}
.submit-btn:hover:not(:disabled) { background: #0F6E56; }
.submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.submit-btn.full-width { width: 100%; }

.switch-link,
.back-link {
  display: block;
  width: 100%;
  margin-top: 12px;
  padding: 8px;
  background: none;
  border: none;
  color: #1D9E75;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  text-align: center;
}
.switch-link:hover,
.back-link:hover { text-decoration: underline; }

/* User switcher */
.user-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}
.user-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 12px 14px;
  background: #f8f8f8;
  border: 0.5px solid #e0e0e0;
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  width: 100%;
  text-align: left;
  font-family: inherit;
}
.user-item:hover { border-color: #1D9E75; background: #f0f7f4; }
.user-item.is-current { border-color: #1D9E75; background: #e8f5f0; }
.user-name { font-weight: 500; color: #1a1a1a; font-size: 14px; }
.user-email { font-size: 12px; color: #888; }

.add-user-btn {
  width: 100%;
  padding: 11px;
  background: white;
  border: 1px dashed #ccc;
  border-radius: 8px;
  color: #888;
  font-size: 14px;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.add-user-btn:hover { border-color: #1D9E75; color: #1D9E75; }

/* Recovery */
.recovery-info {
  margin: 20px 0;
  padding: 16px;
  background: #e8f5f0;
  border-radius: 8px;
  color: #0F6E56;
  border-left: 3px solid #1D9E75;
}
.recovery-info p { margin: 0 0 8px 0; font-size: 14px; }
.recovery-info p:last-child { margin-bottom: 0; }
.recovery-note { font-size: 13px; font-style: italic; }
.spam-note { color: var(--text-secondary, #6b7280); }

.code-entry {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 16px 0;
}
.code-entry label { font-size: 12px; font-weight: 500; color: #555; }
.code-input {
  padding: 12px;
  border: 0.5px solid #d0d0d0;
  border-radius: 8px;
  font-size: 28px;
  font-family: 'Courier New', Courier, monospace;
  text-align: center;
  letter-spacing: 8px;
  transition: border-color 0.15s;
}
.code-input:focus { outline: none; border-color: #1D9E75; }
.code-input::placeholder { color: #ccc; letter-spacing: 8px; }

.recovery-error-panel {
  margin: 20px 0;
  padding: 16px;
  background: #ffebee;
  border-radius: 8px;
  border-left: 3px solid #d32f2f;
}
.recovery-error-panel .error-message { margin-bottom: 12px; display: block; }

.loading-spinner { display: flex; justify-content: center; padding: 40px; }
.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid #e0e0e0;
  border-top-color: #1D9E75;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* Preview panel */
.preview-panel {
  background: #f0f7f4;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 40px;
}
.preview-inner {
  max-width: 480px;
  width: 100%;
}
.preview-screenshot {
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
  border: 0.5px solid #d0e8df;
  margin-bottom: 16px;
}
.preview-screenshot img {
  display: block;
  width: 100%;
  height: auto;
}
.preview-caption {
  font-size: 13px;
  color: #555;
  text-align: center;
  line-height: 1.6;
  margin: 0;
}

/* Footer */
.welcome-footer {
  padding: 12px 32px;
  border-top: 0.5px solid #e0e0e0;
  background: white;
  text-align: center;
  flex-shrink: 0;
}
.footer-links {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
.footer-link {
  font-size: 13px;
  color: #888;
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: 5px;
}
.footer-link:hover { color: #1a1a1a; }
.footer-copy {
  font-size: 11px;
  color: #bbb;
}

/* Mobile */
@media (max-width: 768px) {
  .welcome-main { grid-template-columns: 1fr; }
  .preview-panel { display: none; }
  .form-panel { border-right: none; padding: 32px 24px; }
  .form-row { grid-template-columns: 1fr; }
}
</style>

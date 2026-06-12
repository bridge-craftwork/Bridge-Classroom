<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content">
      <!-- Step 1: Overview -->
      <div v-if="step === 1" class="step step-overview">
        <h2>Become a Teacher</h2>
        <p class="step-desc">Unlock classroom management tools to track your students' progress.</p>

        <div class="capabilities">
          <div class="capability">
            <span class="capability-icon">&#x1F3EB;</span>
            <div>
              <strong>Create Classrooms</strong>
              <p>Organize students into classes with invite links.</p>
            </div>
          </div>
          <div class="capability">
            <span class="capability-icon">&#x1F4CB;</span>
            <div>
              <strong>Assign Exercises</strong>
              <p>Assign curated board sets to your class or individual students.</p>
            </div>
          </div>
          <div class="capability">
            <span class="capability-icon">&#x1F4CA;</span>
            <div>
              <strong>Track Progress</strong>
              <p>See which boards students have completed and their accuracy.</p>
            </div>
          </div>
        </div>

        <div class="note-box">
          <strong>Still a Student Too</strong>
          <p>Teachers keep full access to all lessons, exercises, and practice tools.</p>
        </div>

        <div class="step-actions">
          <button class="btn btn-secondary" @click="$emit('close')">Not Now</button>
          <button class="btn btn-primary" @click="step = 2">Continue &rarr;</button>
        </div>
      </div>

      <!-- Step 2: Agreement -->
      <div v-else-if="step === 2" class="step step-agreement">
        <h2>Teacher Agreement</h2>
        <p class="step-desc">Please review and accept the terms below.</p>

        <div class="terms-scroll">
          <h4>Service Availability</h4>
          <p>Bridge Classroom is provided as a free educational tool on an "as-is" basis. There is no guarantee of uptime, availability, or continued operation. The service may be modified or discontinued at any time without notice.</p>

          <h4>Data &amp; Storage</h4>
          <p>While we take reasonable care with data, there is no warranty on data preservation. Teachers are encouraged to export important data regularly. Student observations are encrypted end-to-end.</p>

          <h4>Student Data &amp; Privacy</h4>
          <p>As a teacher, you will be able to see practice observations (which exercises students have completed and their accuracy) for students in your classrooms. You agree to:</p>
          <ul>
            <li>Use student data for educational purposes only</li>
            <li>Not share student data publicly or with unauthorized parties</li>
            <li>Respect that students can leave your classroom at any time, which stops you from seeing their progress on new assignments</li>
          </ul>

          <h4>Your Responsibilities</h4>
          <p>Teachers manage their own classrooms, communication, and student relationships. Bridge Classroom provides the tools but does not mediate teacher-student interactions.</p>

          <h4>No Warranty</h4>
          <p>The service is provided "as is" without warranty of any kind, express or implied. In no event shall the developers be liable for any damages arising from the use of this service.</p>

          <h4>Open Source</h4>
          <p>Bridge Classroom is open source software. The source code is available on GitHub.</p>
        </div>

        <label class="agreement-checkbox">
          <input type="checkbox" v-model="agreed" />
          <span>I have read and agree to the terms above. I understand that Bridge Classroom is a free, as-is service with no guarantees of uptime or data preservation.</span>
        </label>

        <div class="step-actions">
          <button class="btn btn-secondary" @click="step = 1">&larr; Back</button>
          <button class="btn btn-primary" :disabled="!agreed || activating" @click="activateTeacher">
            {{ activating ? 'Activating...' : 'Activate Teacher Account' }}
          </button>
        </div>

        <p v-if="error" class="error-text">{{ error }}</p>
      </div>

      <!-- Step 3: Confirmation -->
      <div v-else-if="step === 3" class="step step-confirmation">
        <div class="success-icon">&#x2705;</div>
        <h2>You're a Teacher!</h2>
        <p class="step-desc">Your account has been upgraded. Here's what to do next:</p>

        <ol class="next-steps">
          <li>Create your first classroom from the teacher dashboard</li>
          <li>Share the invite link with your students</li>
          <li>Browse exercises and assign them to your class</li>
        </ol>

        <div class="step-actions">
          <button class="btn btn-primary" @click="$emit('activated')">Go to Dashboard &rarr;</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useUserStore } from '../composables/useUserStore.js'
import { generateViewerKeyPair } from '../utils/crypto.js'
import { API_URL } from '@/utils/apiUrl.js'

defineEmits(['close', 'activated'])

const API_KEY = import.meta.env.VITE_API_KEY || ''

const userStore = useUserStore()

const step = ref(1)
const agreed = ref(false)
const activating = ref(false)
const error = ref(null)

async function activateTeacher() {
  const user = userStore.currentUser.value
  if (!user) return

  activating.value = true
  error.value = null

  try {
    // 1. Upgrade role on the server
    const response = await fetch(`${API_URL}/users/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY
      },
      body: JSON.stringify({
        user_id: user.id,
        action: 'become_teacher'
      })
    })

    const data = await response.json()
    if (!data.success) {
      error.value = data.error || 'Failed to upgrade account'
      return
    }

    // 2. Update local user store with new role
    userStore.updateUser(user.id, { role: 'teacher' })

    // 3. Create a viewer record so the teacher can receive sharing grants
    // Generate RSA keypair client-side
    try {
      const { publicKey, privateKey } = await generateViewerKeyPair()

      // Create viewer record (includes private key for server-side encrypted backup)
      await fetch(`${API_URL}/viewers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY
        },
        body: JSON.stringify({
          name: `${user.firstName} ${user.lastName}`,
          email: user.email,
          public_key: publicKey,
          private_key: privateKey,
          role: 'teacher'
        })
      })

      // Persist private key in localStorage user object
      userStore.updateUser(user.id, { viewerPrivateKey: privateKey })

      // Also store in sessionStorage for fast access this session
      sessionStorage.setItem('bridgeTeacherSession', JSON.stringify({
        privateKeyBase64: privateKey,
        expiry: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()
      }))
    } catch (keyErr) {
      // Viewer creation is non-fatal - teacher can still use classrooms
      console.warn('Failed to create viewer record:', keyErr)
    }

    // Move to confirmation step
    step.value = 3
  } catch (err) {
    console.error('Teacher activation failed:', err)
    error.value = 'Unable to connect to server. Please try again.'
  } finally {
    activating.value = false
  }
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
  align-items: center;
  justify-content: center;
  z-index: 2000;
  padding: 20px;
}

.modal-content {
  background: white;
  border-radius: var(--radius-card, 10px);
  max-width: 560px;
  width: 100%;
  max-height: 90vh;
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

/* Step 1: Overview */
.capabilities {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 20px;
}

.capability {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.capability-icon {
  font-size: 28px;
  line-height: 1;
  flex-shrink: 0;
}

.capability strong {
  display: block;
  color: var(--text-primary, #1a1a1a);
  margin-bottom: 2px;
}

.capability p {
  color: var(--text-secondary, #6b7280);
  font-size: 14px;
  margin: 0;
}

.note-box {
  background: var(--green-pale, #d8f3dc);
  border-radius: var(--radius-button, 6px);
  padding: 12px 16px;
  margin-bottom: 24px;
}

.note-box strong {
  color: var(--green-dark, #2d6a4f);
  display: block;
  margin-bottom: 4px;
}

.note-box p {
  color: var(--green-dark, #2d6a4f);
  font-size: 14px;
  margin: 0;
  opacity: 0.8;
}

/* Step 2: Agreement */
.terms-scroll {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--card-border, #e0ddd7);
  border-radius: var(--radius-button, 6px);
  padding: 16px;
  margin-bottom: 16px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary, #1a1a1a);
}

.terms-scroll h4 {
  margin: 16px 0 6px 0;
  font-size: 15px;
  color: var(--green-dark, #2d6a4f);
}

.terms-scroll h4:first-child {
  margin-top: 0;
}

.terms-scroll p {
  margin: 0 0 8px 0;
}

.terms-scroll ul {
  margin: 0 0 8px 20px;
}

.terms-scroll li {
  margin-bottom: 4px;
}

.agreement-checkbox {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin-bottom: 20px;
  cursor: pointer;
  font-size: 14px;
  color: var(--text-primary, #1a1a1a);
  line-height: 1.5;
}

.agreement-checkbox input[type="checkbox"] {
  margin-top: 4px;
  flex-shrink: 0;
}

/* Step 3: Confirmation */
.success-icon {
  font-size: 48px;
  text-align: center;
  margin-bottom: 12px;
}

.step-confirmation h2 {
  text-align: center;
}

.step-confirmation .step-desc {
  text-align: center;
}

.next-steps {
  text-align: left;
  padding-left: 20px;
  margin-bottom: 24px;
  color: var(--text-primary, #1a1a1a);
}

.next-steps li {
  margin-bottom: 8px;
  line-height: 1.5;
}

/* Shared button styles */
.step-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
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
  margin-top: 8px;
  text-align: center;
}
</style>

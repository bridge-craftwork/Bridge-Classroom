<script setup>
import { computed } from 'vue'
import { useUserStore } from '../composables/useUserStore.js'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close'])

const userStore = useUserStore()

// Computed
const userName = computed(() => {
  const user = userStore.currentUser.value
  return user ? `${user.firstName} ${user.lastName}` : ''
})

const userEmail = computed(() => {
  const user = userStore.currentUser.value
  return user ? user.email : ''
})

// Methods
function handleContinue() {
  userStore.dismissKeyBackupModal()
  emit('close')
}
</script>

<template>
  <div v-if="visible" class="modal-overlay">
    <div class="modal-content">
      <div class="modal-header">
        <div class="key-icon">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <h2>Account Created</h2>
      </div>

      <div class="modal-body">
        <p class="intro">
          Welcome, <strong>{{ userName }}</strong>! Your account has been set up
          with a personal encryption key that protects your practice data.
        </p>

        <div class="info-box">
          <span class="info-icon">&#9993;</span>
          <p>
            If you ever need to access your account from a new device or browser,
            we'll send a recovery link to <strong>{{ userEmail }}</strong>.
          </p>
        </div>

        <div class="actions">
          <button
            class="continue-btn primary"
            @click="handleContinue"
          >
            Start Practicing
          </button>
        </div>

        <div class="tip">
          <strong>Tip:</strong> Make sure you have access to your email address
          in case you need to recover your account later.
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  overflow-y: auto;
  z-index: 2000;
  padding: 20px;
}

.modal-content {
  background: white;
  border-radius: 16px;
  max-width: 480px;
  width: 100%;
  margin: auto;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.modal-header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 32px 24px;
  text-align: center;
}

.key-icon {
  margin-bottom: 12px;
  opacity: 0.9;
}

.key-icon svg {
  stroke: currentColor;
}

.modal-header h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}

.modal-body {
  padding: 28px 24px;
}

.intro {
  font-size: 15px;
  line-height: 1.6;
  color: #444;
  margin: 0 0 20px 0;
}

.info-box {
  display: flex;
  gap: 12px;
  padding: 16px;
  background: #e3f2fd;
  border: 1px solid #90caf9;
  border-radius: 8px;
  margin-bottom: 24px;
}

.info-icon {
  font-size: 24px;
  color: #1565c0;
  flex-shrink: 0;
}

.info-box p {
  margin: 0;
  font-size: 14px;
  color: #1565c0;
  line-height: 1.5;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
}

.continue-btn {
  padding: 14px 24px;
  background: white;
  color: #666;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.continue-btn:hover {
  background: #f5f5f5;
  color: #333;
}

.continue-btn.primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
}

.continue-btn.primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.tip {
  font-size: 13px;
  color: #666;
  background: #f8f9fa;
  padding: 12px 16px;
  border-radius: 8px;
  line-height: 1.5;
}

.tip strong {
  color: #444;
}

@media (max-width: 480px) {
  .modal-content {
    border-radius: 12px;
  }

  .modal-header {
    padding: 24px 20px;
  }

  .modal-body {
    padding: 20px;
  }
}
</style>

<template>
  <div class="progress-dashboard">
    <header class="dashboard-header">
      <h2>Student Progress</h2>
      <button class="close-btn" @click="$emit('close')">&times;</button>
    </header>

    <!-- Loading state -->
    <div v-if="progress.isLoading.value" class="loading">
      <div class="spinner"></div>
      <p>Loading your progress...</p>
    </div>

    <!-- Error state -->
    <div v-else-if="progress.hasError.value" class="error-state">
      <p>Failed to load progress: {{ progress.error.value }}</p>
      <button @click="refresh">Try Again</button>
    </div>

    <!-- Empty state -->
    <div v-else-if="!hasData" class="empty-state">
      <h3>No Practice Data Yet</h3>
      <p>Complete some practice deals to see your progress here!</p>
      <button class="primary-btn" @click="$emit('close')">Start Practicing</button>
    </div>

    <!-- Progress content -->
    <div v-else class="dashboard-content">
      <StudentProgressPanel
        :observations="observations"
        :studentName="studentName"
      />
      <div class="dashboard-actions">
        <button class="secondary-btn" @click="refresh">Refresh Data</button>
        <button class="primary-btn" @click="$emit('close')">Continue Practicing</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useStudentProgress } from '../composables/useStudentProgress.js'
import { useUserStore } from '../composables/useUserStore.js'
import StudentProgressPanel from './StudentProgressPanel.vue'

defineEmits(['close'])

const progress = useStudentProgress()
const userStore = useUserStore()

const observations = computed(() => progress.decryptedObservations.value)
const hasData = computed(() => observations.value.length > 0)
const studentName = computed(() => {
  const user = userStore.currentUser.value
  return user ? `${user.firstName} ${user.lastName}` : ''
})

onMounted(async () => {
  await progress.fetchProgress()
})

async function refresh() {
  await progress.fetchProgress(true)
}
</script>

<style scoped>
.progress-dashboard {
  background: white;
  border-radius: 12px;
  max-width: 900px;
  width: 100%;
  margin: auto;
  max-height: 90dvh;
  overflow-y: auto;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.dashboard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #eee;
  position: sticky;
  top: 0;
  background: white;
  z-index: 10;
  border-radius: 12px 12px 0 0;
}

.dashboard-header h2 {
  margin: 0;
  font-size: 20px;
  color: #333;
}

.close-btn {
  background: none;
  border: none;
  font-size: 28px;
  color: #999;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.close-btn:hover {
  color: #333;
}

.dashboard-content {
  padding: 16px 20px;
}

.loading,
.error-state,
.empty-state {
  padding: 40px 20px;
  text-align: center;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #e0e0e0;
  border-top-color: #667eea;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-state { color: #d32f2f; }
.error-state button {
  margin-top: 16px;
  padding: 8px 16px;
  background: #d32f2f;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.empty-state h3 { color: #666; margin-bottom: 8px; }
.empty-state p { color: #999; margin-bottom: 8px; }

.dashboard-actions {
  display: flex;
  gap: 12px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #eee;
}

.primary-btn,
.secondary-btn {
  flex: 1;
  padding: 12px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.primary-btn {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
}

.primary-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.secondary-btn {
  background: white;
  color: #667eea;
  border: 1px solid #667eea;
}

.secondary-btn:hover {
  background: #f5f7ff;
}
</style>

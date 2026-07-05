<template>
  <div class="teacher-lobby">
    <!-- Summary stats -->
    <div v-if="dashboard.lobbyClassrooms.value.length" class="summary-row">
      <span class="stat"><strong>{{ stats.classroomCount }}</strong> {{ stats.classroomCount === 1 ? 'classroom' : 'classrooms' }}</span>
      <span class="stat"><strong>{{ stats.studentCount }}</strong> {{ stats.studentCount === 1 ? 'student' : 'students' }}</span>
      <span class="stat"><strong>{{ stats.openAssignmentCount }}</strong> open {{ stats.openAssignmentCount === 1 ? 'assignment' : 'assignments' }}</span>
    </div>

    <!-- Loading -->
    <div v-if="dashboard.lobbyLoading.value && !dashboard.lobbyClassrooms.value.length" class="loading-state">
      <div class="spinner"></div>
      <p>Loading dashboard...</p>
    </div>

    <!-- Two-column layout -->
    <div v-else class="dashboard-grid">
      <!-- Left column: Classrooms -->
      <div class="left-column">
        <div v-if="dashboard.lobbyClassrooms.value.length" class="classrooms-section">
          <div class="section-header">
            <h3 class="section-title">My Classrooms</h3>
            <div class="section-actions">
              <a
                class="action-btn tables-link"
                href="#/tables/console"
                title="Host live multiplayer tables — students join via your permanent /play link"
              >
                ♠ Table Console
              </a>
              <button class="action-btn create" @click="showCreateModal = true">
                + New Classroom
              </button>
            </div>
          </div>
          <div class="classroom-cards">
            <ClassroomCard
              v-for="classroom in dashboard.lobbyClassrooms.value"
              :key="classroom.id"
              :classroom="classroom"
              :expanded="expandedId === classroom.id"
              @toggle="toggleExpand(classroom.id)"
              @member-removed="refreshData"
              @view-assignment="selectedAssignmentId = $event"
            />
          </div>
        </div>

        <div v-else class="empty-state">
          <p class="empty-title">No classrooms yet</p>
          <p class="empty-desc">Create a classroom and share the invite link with your students.</p>
          <button class="action-btn create" @click="showCreateModal = true">
            + New Classroom
          </button>
        </div>
      </div>

      <!-- Right column: Attention + Activity -->
      <div class="right-column">
        <NeedsAttention :items="dashboard.needsAttention.value" @clear="handleClear('attention')" />
        <RecentActivity :events="dashboard.recentActivity.value" @clear="handleClear('activity')" />
      </div>
    </div>

    <!-- Create classroom modal -->
    <ClassroomCreateModal
      v-if="showCreateModal"
      @close="showCreateModal = false"
      @classroom-created="handleClassroomCreated"
    />

    <!-- Assignment detail modal -->
    <AssignmentDetailModal
      v-if="selectedAssignmentId"
      :assignment-id="selectedAssignmentId"
      @close="selectedAssignmentId = null"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useUserStore } from '../../composables/useUserStore.js'
import { useTeacherDashboard } from '../../composables/useTeacherDashboard.js'
import ClassroomCard from './ClassroomCard.vue'
import ClassroomCreateModal from './ClassroomCreateModal.vue'
import AssignmentDetailModal from './AssignmentDetailModal.vue'
import NeedsAttention from './NeedsAttention.vue'
import RecentActivity from './RecentActivity.vue'

defineEmits([])

const userStore = useUserStore()
const dashboard = useTeacherDashboard()

const showCreateModal = ref(false)
const selectedAssignmentId = ref(null)
const expandedId = ref(null)

const stats = computed(() => dashboard.summaryStats.value)

function toggleExpand(classroomId) {
  expandedId.value = expandedId.value === classroomId ? null : classroomId
}

function handleClassroomCreated(classroom) {
  showCreateModal.value = false
  expandedId.value = classroom.id
  refreshData()
}

function handleClear(panel) {
  const user = userStore.currentUser.value
  if (user) {
    dashboard.clearPanel(user.id, panel)
  }
}

function refreshData() {
  const user = userStore.currentUser.value
  if (user) {
    dashboard.loadTeacherLobbyData(user.id, true)
  }
}

onMounted(() => {
  const user = userStore.currentUser.value
  if (user) {
    dashboard.loadTeacherLobbyData(user.id)
  }
})
</script>

<style scoped>
.teacher-lobby {
  padding: 20px 0;
}

.summary-row {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  padding: 12px 20px;
  background: white;
  border-radius: var(--radius-card, 10px);
  border: 1px solid var(--card-border, #e0ddd7);
  margin-bottom: 20px;
  font-size: 14px;
  color: var(--text-secondary, #6b7280);
}

.summary-row .stat strong {
  color: var(--green-dark, #2d6a4f);
  font-weight: 600;
  margin-right: 4px;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  border-radius: var(--radius-button, 6px);
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
  font-family: var(--font-body, 'DM Sans', sans-serif);
}

.action-btn.create {
  background: var(--green-mid, #40916c);
  color: white;
}

.action-btn.create:hover {
  background: var(--green-dark, #2d6a4f);
}

.section-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

.action-btn.tables-link {
  background: white;
  color: var(--green-dark, #2d6a4f);
  border: 1px solid var(--green-mid, #40916c);
}

.action-btn.tables-link:hover {
  background: var(--green-pale, #eef7f2);
}

/* Two-column dashboard grid */
.dashboard-grid {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: 24px;
  margin-bottom: 32px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  gap: 12px;
}

.section-title {
  font-family: var(--font-heading, 'Source Serif 4', serif);
  font-size: 20px;
  color: var(--green-dark, #2d6a4f);
  margin: 0;
}

.classrooms-section {
  margin-bottom: 0;
}

.classroom-cards {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.right-column {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.loading-state {
  text-align: center;
  padding: 60px 20px;
  grid-column: 1 / -1;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #e0e0e0;
  border-top-color: #2d6a4f;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.empty-state {
  text-align: center;
  padding: 32px;
  background: white;
  border-radius: var(--radius-card, 10px);
  border: 1px dashed var(--card-border, #e0ddd7);
}

.empty-title {
  font-weight: 500;
  color: var(--text-primary, #1a1a1a);
  margin-bottom: 4px;
}

.empty-desc {
  color: var(--text-secondary, #6b7280);
  font-size: 14px;
  margin-bottom: 16px;
}

/* Responsive: collapse to single column on mobile */
@media (max-width: 768px) {
  .dashboard-grid {
    grid-template-columns: 1fr;
  }
}
</style>

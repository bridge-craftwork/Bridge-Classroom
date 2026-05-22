<template>
  <div class="lobby-view">
    <LobbyTabs
      v-if="visibleTabs.length > 1"
      :tabs="visibleTabs"
      :active="activeTab"
      @update:active="activeTab = $event"
    />

    <LessonsTab
      v-if="activeTab === 'lessons'"
      :read-only="isViewingAs"
      @select-collection="$emit('select-collection', $event)"
      @select-assignment="$emit('select-assignment', $event)"
      @resume-lesson="$emit('resume-lesson', $event)"
      @show-progress="$emit('show-progress')"
      @load-file="$emit('load-file', $event)"
    />
    <StudentsTab
      v-else-if="activeTab === 'students'"
      @navigate-to-lesson="(subfolder, boardNumber) => $emit('navigate-to-lesson', subfolder, boardNumber)"
    />
    <TeacherLobby
      v-else-if="activeTab === 'classrooms'"
    />
    <AssignmentsTab v-else-if="activeTab === 'assignments'" />
    <ComingSoon v-else-if="activeTab === 'exercises'" title="Exercises" />
    <ConventionCardView v-else-if="activeTab === 'conventionCard'" embedded />
    <AdminLobby v-else-if="activeTab === 'admin'" />
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useUserStore } from '../composables/useUserStore.js'
import LobbyTabs from '../components/lobby/LobbyTabs.vue'
import LessonsTab from '../components/lobby/tabs/LessonsTab.vue'
import StudentsTab from '../components/lobby/tabs/StudentsTab.vue'
import AssignmentsTab from '../components/lobby/tabs/AssignmentsTab.vue'
import ComingSoon from '../components/lobby/tabs/ComingSoon.vue'
import TeacherLobby from '../components/lobby/TeacherLobby.vue'
import AdminLobby from '../components/lobby/AdminLobby.vue'
import ConventionCardView from './ConventionCardView.vue'

defineEmits([
  'select-collection',
  'select-assignment',
  'resume-lesson',
  'show-become-teacher',
  'load-file',
  'show-progress',
  'navigate-to-lesson'
])

const userStore = useUserStore()

const userRole = computed(() => userStore.currentUser.value?.role || 'student')
const isViewingAs = computed(() => userStore.isViewingAs.value)

const visibleTabs = computed(() => {
  if (userRole.value === 'admin') {
    return ['lessons', 'students', 'classrooms', 'assignments', 'exercises', 'conventionCard', 'admin']
  }
  if (userRole.value === 'teacher') {
    return ['lessons', 'students', 'classrooms', 'assignments', 'exercises', 'conventionCard']
  }
  return ['lessons', 'conventionCard']
})

function defaultTabForRole(role) {
  return role === 'teacher' || role === 'admin' ? 'classrooms' : 'lessons'
}

const activeTab = ref(defaultTabForRole(userRole.value))

// Snap to a valid default tab whenever the effective role changes — covers both
// entering view-as (admin → student tabs) and exiting back to admin.
watch(userRole, (newRole) => {
  activeTab.value = defaultTabForRole(newRole)
})
</script>

<style scoped>
.lobby-view {
  flex: 1;
}
</style>

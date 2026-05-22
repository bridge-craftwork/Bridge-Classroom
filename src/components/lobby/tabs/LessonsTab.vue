<template>
  <div class="lessons-tab">
    <AssignmentPanel
      v-if="isStudent && (hasAssignments || assignmentsLoading)"
      :assignments="assignmentStore.studentAssignments.value"
      :loading="assignmentsLoading"
      @select-assignment="onSelectAssignment"
    />
    <RecentLessons
      v-if="isStudent"
      @resume-lesson="onResumeLesson"
      @show-progress="$emit('show-progress')"
    />
    <CollectionGrid
      @select-collection="onSelectCollection"
      @load-file="onLoadFile"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, watch } from 'vue'
import { useUserStore } from '../../../composables/useUserStore.js'
import { useAssignments } from '../../../composables/useAssignments.js'
import AssignmentPanel from '../AssignmentPanel.vue'
import RecentLessons from '../RecentLessons.vue'
import CollectionGrid from '../CollectionGrid.vue'

const props = defineProps({
  readOnly: { type: Boolean, default: false }
})

const emit = defineEmits(['select-collection', 'select-assignment', 'resume-lesson', 'show-progress', 'load-file'])

const userStore = useUserStore()
const assignmentStore = useAssignments()

const isStudent = computed(() => (userStore.currentUser.value?.role || 'student') === 'student')
const hasAssignments = computed(() => assignmentStore.studentAssignments.value.length > 0)
const assignmentsLoading = computed(() => assignmentStore.loading.value)

function fetchAssignmentsForCurrentUser() {
  const user = userStore.currentUser.value
  if (user && isStudent.value) {
    assignmentStore.fetchStudentAssignments(user.id)
  }
}

onMounted(fetchAssignmentsForCurrentUser)

// Re-fetch when the effective user changes (e.g. admin enters/leaves view-as mode).
watch(() => userStore.currentUser.value?.id, fetchAssignmentsForCurrentUser)

// Read-only emit gates — neutralize lesson/practice entry while in view-as mode.
function onSelectAssignment(payload) { if (!props.readOnly) emit('select-assignment', payload) }
function onResumeLesson(payload) { if (!props.readOnly) emit('resume-lesson', payload) }
function onSelectCollection(payload) { if (!props.readOnly) emit('select-collection', payload) }
function onLoadFile(payload) { if (!props.readOnly) emit('load-file', payload) }
</script>

<style scoped>
.lessons-tab {
  padding: 8px 0;
}
</style>

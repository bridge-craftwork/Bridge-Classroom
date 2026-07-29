<template>
  <div class="teacher-student-list">
    <header class="teacher-header">
      <h2>My Students</h2>
      <div class="header-actions">
        <select v-if="classrooms.teacherClassrooms.value.length" v-model="selectedFilter" class="filter-select">
          <option value="all">All Students</option>
          <option v-for="c in classrooms.teacherClassrooms.value" :key="c.id" :value="c.id">{{ c.name }}</option>
          <option value="none">No Classroom</option>
        </select>
        <button class="secondary-btn" @click="refresh">Refresh</button>
        <button v-if="!embedded" class="secondary-btn" @click="$emit('close')">Back</button>
      </div>
    </header>

    <!-- Loading -->
    <div v-if="teacherRole.loading.value" class="loading-state">
      <div class="spinner"></div>
      <p>Loading student data...</p>
    </div>

    <!-- Error -->
    <div v-else-if="teacherRole.error.value" class="error-state">
      <p>Failed to load: {{ teacherRole.error.value }}</p>
      <button @click="refresh">Try Again</button>
    </div>

    <!-- Empty (no students at all) -->
    <div v-else-if="teacherRole.students.value.length === 0" class="empty-state">
      <h3>No Students Yet</h3>
      <p>Students will appear here once they register and grant you access.</p>
    </div>

    <!-- Empty (filter matched nothing) -->
    <div v-else-if="sortedStudents.length === 0" class="empty-state">
      <h3>No Matching Students</h3>
      <p>No students match the selected filter.</p>
    </div>

    <!-- Student table -->
    <div v-else class="student-table-wrap">
      <table class="student-table">
        <thead>
          <tr>
            <th class="col-name sortable" :class="sortClass('name')" :aria-sort="ariaSort('name')" @click="setSort('name')">
              Student <span class="sort-arrow">{{ sortArrow('name') }}</span>
            </th>
            <th class="col-mastery sortable" :class="sortClass('mastery')" :aria-sort="ariaSort('mastery')" @click="setSort('mastery')">
              Mastery <span class="sort-arrow">{{ sortArrow('mastery') }}</span>
            </th>
            <th class="col-active sortable" :class="sortClass('active')" :aria-sort="ariaSort('active')" @click="setSort('active')">
              Last Active <span class="sort-arrow">{{ sortArrow('active') }}</span>
            </th>
            <th class="col-lessons sortable" :class="sortClass('lessons')" :aria-sort="ariaSort('lessons')" @click="setSort('lessons')">
              Recent Lessons <span class="sort-arrow">{{ sortArrow('lessons') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="student in sortedStudents"
            :key="student.id"
            class="student-row"
            @click="$emit('select-student', student.id, studentName(student))"
          >
            <td class="col-name">
              <div class="student-name-cell">
                <div class="avatar">{{ initials(student) }}</div>
                <span>{{ studentName(student) }}</span>
              </div>
            </td>
            <td class="col-mastery">
              <div class="mastery-pills">
                <span v-if="summaries[student.id]?.green" class="pill pill-green">{{ summaries[student.id].green }}</span>
                <span v-if="summaries[student.id]?.orange" class="pill pill-orange">{{ summaries[student.id].orange }}</span>
                <span v-if="summaries[student.id]?.yellow" class="pill pill-yellow">{{ summaries[student.id].yellow }}</span>
                <span v-if="summaries[student.id]?.red" class="pill pill-red">{{ summaries[student.id].red }}</span>
                <span v-if="!summaries[student.id]?.total" class="no-data-label">No data</span>
              </div>
            </td>
            <td class="col-active">
              {{ teacherRole.formatTimeSince(summaries[student.id]?.lastObservationTime) }}
            </td>
            <td class="col-lessons">
              <div class="recent-lessons">
                <span
                  v-for="(lesson, i) in recentLessons[student.id]"
                  :key="i"
                  class="lesson-tag"
                >{{ lesson.name }}<span
                    v-if="lesson.status === 'beta'"
                    class="lesson-badge beta"
                    title="Beta lesson — not counted toward mastery"
                  >beta</span><span
                    v-else-if="lesson.status === 'mixed'"
                    class="lesson-badge mixed"
                    title="Mixed — includes beta boards not counted toward mastery"
                  >mixed</span></span>
                <span v-if="!recentLessons[student.id]?.length" class="no-data-label">-</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script>
// Module-level state: this <script> block runs once per module load,
// not per component-instance mount. Both `selectedFilter` and
// `classroomMembers` survive navigating into a student detail and
// back (the v-if in MainLayout unmounts the list). Without
// `classroomMembers` persisting, on remount the filter computed
// briefly sees an empty member-set, falls through to "return all",
// and flashes the unfiltered list for one tick before the async
// fetch in onMounted lands.
import { ref, computed, onMounted } from 'vue'
const selectedFilter = ref('all')
// Map of classroomId -> Set of student IDs.
const classroomMembers = ref({})
// Column sort state. Module-level (like selectedFilter) so it survives
// navigating into a student detail and back. Default: Last Active, most
// recent first — matches the prior implicit sort.
const sortKey = ref('active')
const sortDir = ref('desc')
</script>

<script setup>
import { useTeacherRole } from '../composables/useTeacherRole.js'
import { useClassrooms } from '../composables/useClassrooms.js'
import { useUserStore } from '../composables/useUserStore.js'
import { useAnonymizer } from '../composables/useAnonymizer.js'

defineProps({
  embedded: { type: Boolean, default: false }
})

const emit = defineEmits(['close', 'select-student'])

const teacherRole = useTeacherRole()
const classrooms = useClassrooms()
const userStore = useUserStore()
const anon = useAnonymizer()

onMounted(async () => {
  await teacherRole.loadAllStudentSummaries()
  await loadClassroomMembers()
})

async function loadClassroomMembers() {
  const user = userStore.currentUser.value
  if (!user) return

  // Ensure classrooms are loaded
  if (!classrooms.teacherClassrooms.value.length) {
    await classrooms.fetchTeacherClassrooms(user.id)
  }

  // Fetch details for each classroom to get member lists
  const members = {}
  await Promise.all(
    classrooms.teacherClassrooms.value.map(async (c) => {
      const result = await classrooms.fetchClassroomDetail(c.id)
      if (result?.success) {
        members[c.id] = new Set(result.classroom.members.map(m => m.student_id))
      }
    })
  )
  classroomMembers.value = members
}

async function refresh() {
  // Clear cache timestamps to force refetch
  teacherRole.studentObservations.value = {}
  await teacherRole.loadAllStudentSummaries()
  await loadClassroomMembers()
}

// Set of all student IDs who are in at least one classroom
const studentsInAnyClassroom = computed(() => {
  const ids = new Set()
  for (const memberSet of Object.values(classroomMembers.value)) {
    for (const id of memberSet) ids.add(id)
  }
  return ids
})

const filteredStudents = computed(() => {
  const all = teacherRole.students.value
  if (selectedFilter.value === 'all') return all
  if (selectedFilter.value === 'none') {
    return all.filter(s => !studentsInAnyClassroom.value.has(s.id))
  }
  // Filter by specific classroom
  const memberSet = classroomMembers.value[selectedFilter.value]
  if (!memberSet) return all
  return all.filter(s => memberSet.has(s.id))
})

// Value a student sorts by for a given column. Numbers sort numerically,
// strings lexically. Mastery sorts by proficient (green) count.
function sortValue(student, key) {
  const s = summaries.value[student.id]
  switch (key) {
    case 'name': return studentName(student).toLowerCase()
    case 'mastery': return s?.green || 0
    case 'lessons': return recentLessons.value[student.id]?.length || 0
    case 'active':
    default: return s?.lastObservationTime || ''
  }
}

const sortedStudents = computed(() => {
  const key = sortKey.value
  const dir = sortDir.value === 'asc' ? 1 : -1
  return [...filteredStudents.value].sort((a, b) => {
    const av = sortValue(a, key)
    const bv = sortValue(b, key)
    let cmp
    if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv
    else cmp = String(av).localeCompare(String(bv))
    if (cmp !== 0) return cmp * dir
    // Stable, intuitive tiebreaker: name A→Z
    return studentName(a).localeCompare(studentName(b))
  })
})

// New column starts at its natural direction (names A→Z; everything else
// highest/most-recent first); clicking the active column toggles direction.
function setSort(key) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = key === 'name' ? 'asc' : 'desc'
  }
}

function sortArrow(key) {
  if (sortKey.value !== key) return ''
  return sortDir.value === 'asc' ? '▲' : '▼'
}

function sortClass(key) {
  return { 'sort-active': sortKey.value === key }
}

function ariaSort(key) {
  if (sortKey.value !== key) return 'none'
  return sortDir.value === 'asc' ? 'ascending' : 'descending'
}

const summaries = computed(() => {
  const result = {}
  for (const student of teacherRole.students.value) {
    result[student.id] = teacherRole.getStudentMasterySummary(student.id)
  }
  return result
})

const recentLessons = computed(() => {
  const result = {}
  for (const student of teacherRole.students.value) {
    result[student.id] = teacherRole.getStudentRecentLessons(student.id)
  }
  return result
})

function studentName(student) {
  return anon.displayFullName(student)
}

function initials(student) {
  return anon.displayInitials(student)
}
</script>

<style scoped>
.teacher-student-list {
  max-width: 900px;
  margin: 0 auto;
  padding: 0 20px;
}

.teacher-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.teacher-header h2 {
  margin: 0;
  font-size: 20px;
  color: #333;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.loading-state,
.error-state,
.empty-state {
  padding: 60px 20px;
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

.error-state {
  color: #d32f2f;
}

.error-state button {
  margin-top: 16px;
  padding: 8px 16px;
  background: #d32f2f;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.empty-state h3 {
  color: #666;
  margin-bottom: 8px;
}

.empty-state p {
  color: #999;
}

/* Table */
.student-table-wrap {
  overflow-x: auto;
}

.student-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.student-table thead th {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 2px solid #eee;
  font-size: 12px;
  text-transform: uppercase;
  color: #999;
  letter-spacing: 0.3px;
  font-weight: 600;
}

.student-table thead th.sortable {
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  transition: color 0.15s;
}

.student-table thead th.sortable:hover {
  color: #667eea;
}

.student-table thead th.sort-active {
  color: #667eea;
}

.sort-arrow {
  font-size: 10px;
  margin-left: 2px;
}

.student-row {
  cursor: pointer;
  transition: background 0.15s;
}

.student-row:hover {
  background: #f5f7ff;
}

.student-row td {
  padding: 12px;
  border-bottom: 1px solid #f0f0f0;
  vertical-align: middle;
}

.col-name { min-width: 160px; }
.col-mastery { min-width: 140px; }
.col-active { min-width: 100px; white-space: nowrap; color: #666; font-size: 13px; }
.col-lessons { min-width: 180px; }

/* Student name cell */
.student-name-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}

/* Mastery pills */
.mastery-pills {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 22px;
  padding: 0 6px;
  border-radius: 11px;
  font-size: 12px;
  font-weight: 600;
  color: white;
}

.pill-green { background: #4caf50; }
.pill-orange { background: #ff9800; }
.pill-yellow { background: #ffeb3b; color: #333; }
.pill-red { background: #ef5350; }

.no-data-label {
  font-size: 12px;
  color: #ccc;
}

/* Recent lessons */
.recent-lessons {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.lesson-tag {
  display: inline-block;
  padding: 2px 8px;
  background: #f0f0f0;
  border-radius: 10px;
  font-size: 12px;
  color: #555;
  white-space: nowrap;
}

/* Release-status badge on a recent lesson (ADR-0001): beta / mixed. */
.lesson-badge {
  display: inline-block;
  margin-left: 4px;
  padding: 0 5px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  vertical-align: middle;
}
.lesson-badge.beta {
  background: #ff9800;
  color: #fff;
}
.lesson-badge.mixed {
  background: #ffe0b2;
  color: #8a5a00;
}

/* Buttons */
.filter-select {
  padding: 7px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  border: 1px solid #ddd;
  background: white;
  color: #333;
  cursor: pointer;
  font-family: inherit;
}

.filter-select:focus {
  outline: none;
  border-color: #667eea;
}

.secondary-btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  background: white;
  color: #667eea;
  border: 1px solid #667eea;
  transition: all 0.2s;
}

.secondary-btn:hover {
  background: #f5f7ff;
}

/* Responsive */
@media (max-width: 600px) {
  .teacher-student-list {
    padding: 0 12px;
  }

  .teacher-header {
    flex-direction: column;
    gap: 12px;
    align-items: flex-start;
  }

  .col-lessons {
    display: none;
  }
}
</style>

import { ref } from 'vue'
import { API_URL } from '@/utils/apiUrl.js'
import { apiFetch } from '@/utils/apiFetch.js'

/**
 * Collapse the duplicate a student sees when ONE exercise reaches them through more
 * than one classroom they belong to. That is the only duplicate worth hiding.
 *
 * It must not collapse a re-assignment. Teachers repeat an exercise across terms, and
 * each assignment is its own piece of work — progress is stored per assignment_id, not
 * per exercise — so a fresh assignment of an exercise the class did months ago is a new
 * thing to do, not a duplicate of the old one.
 *
 * Two rules keep those apart:
 *
 *  - A CLOSED assignment never takes part. It is history: it shows in the review list
 *    tagged "Closed" and is filtered out of the active list. Letting it compete used to
 *    make a repeat vanish outright — the old (worked-through) row won on progress, then
 *    the active list dropped it for being closed, so the student saw nothing at all.
 *    That hit the students who had actually done the earlier assignment, and only them,
 *    which is what made it look arbitrary.
 *  - Among OPEN assignments, the most recently assigned wins; progress breaks a tie.
 *    A newly-set assignment is what the student is being asked to do now.
 */
export function dedupeStudentAssignments(assignments) {
  const out = []
  const openByExercise = new Map()

  for (const a of assignments || []) {
    if (a.closed_at) {
      out.push(a)
      continue
    }
    const existing = openByExercise.get(a.exercise_id)
    if (!existing || beatsForDisplay(a, existing)) {
      openByExercise.set(a.exercise_id, a)
    }
  }
  return [...openByExercise.values(), ...out]
}

function beatsForDisplay(candidate, incumbent) {
  const at = (a) => {
    const t = Date.parse(a.assigned_at || '')
    return Number.isNaN(t) ? 0 : t
  }
  if (at(candidate) !== at(incumbent)) return at(candidate) > at(incumbent)
  return (candidate.attempted_boards || 0) > (incumbent.attempted_boards || 0)
}

// Singleton reactive state
const studentAssignments = ref([])
const teacherAssignments = ref([])
const currentAssignment = ref(null)
const loading = ref(false)
const error = ref(null)

export function useAssignments() {
  // ---- Student methods ----

  /** Fetch assignments for a student (direct + via classroom membership) */
  async function fetchStudentAssignments(studentId) {
    loading.value = true
    error.value = null
    try {
      const response = await apiFetch(
        `${API_URL}/assignments?student_id=${encodeURIComponent(studentId)}`
      )
      if (!response.ok) {
        const text = await response.text()
        error.value = text || `Server error (${response.status})`
        return null
      }
      const data = await response.json()
      if (data.success) {
        studentAssignments.value = dedupeStudentAssignments(data.assignments)
      } else {
        error.value = data.error || 'Failed to fetch assignments'
      }
      return data
    } catch (err) {
      console.error('Failed to fetch student assignments:', err)
      error.value = 'Unable to connect to server'
      return null
    } finally {
      loading.value = false
    }
  }

  // ---- Teacher methods ----

  /** Fetch assignments created by a teacher */
  async function fetchTeacherAssignments(teacherId) {
    loading.value = true
    error.value = null
    try {
      const response = await apiFetch(
        `${API_URL}/assignments?assigned_by=${encodeURIComponent(teacherId)}`
      )
      if (!response.ok) {
        const text = await response.text()
        error.value = text || `Server error (${response.status})`
        return null
      }
      const data = await response.json()
      if (data.success) {
        teacherAssignments.value = data.assignments
      } else {
        error.value = data.error || 'Failed to fetch assignments'
      }
      return data
    } catch (err) {
      console.error('Failed to fetch teacher assignments:', err)
      error.value = 'Unable to connect to server'
      return null
    } finally {
      loading.value = false
    }
  }

  /** Fetch assignments for a specific classroom */
  async function fetchClassroomAssignments(classroomId) {
    loading.value = true
    error.value = null
    try {
      const response = await apiFetch(
        `${API_URL}/assignments?classroom_id=${encodeURIComponent(classroomId)}`
      )
      if (!response.ok) {
        const text = await response.text()
        error.value = text || `Server error (${response.status})`
        return null
      }
      const data = await response.json()
      if (data.success) {
        return data.assignments
      } else {
        error.value = data.error || 'Failed to fetch assignments'
        return []
      }
    } catch (err) {
      console.error('Failed to fetch classroom assignments:', err)
      error.value = 'Unable to connect to server'
      return []
    } finally {
      loading.value = false
    }
  }

  /** Fetch assignment detail with per-student progress */
  async function fetchAssignmentDetail(assignmentId) {
    loading.value = true
    error.value = null
    try {
      const response = await apiFetch(
        `${API_URL}/assignments/${encodeURIComponent(assignmentId)}`
      )
      if (!response.ok) {
        const text = await response.text()
        error.value = text || `Server error (${response.status})`
        return null
      }
      const data = await response.json()
      if (data.success) {
        currentAssignment.value = data.assignment
      } else {
        error.value = data.error || 'Failed to fetch assignment'
      }
      return data
    } catch (err) {
      console.error('Failed to fetch assignment detail:', err)
      error.value = 'Unable to connect to server'
      return null
    } finally {
      loading.value = false
    }
  }

  /** Create a new assignment */
  async function createAssignment({ exercise_id, classroom_id, student_id, assigned_by, due_at, sort_order }) {
    loading.value = true
    error.value = null
    try {
      const response = await apiFetch(`${API_URL}/assignments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          exercise_id,
          classroom_id: classroom_id || null,
          student_id: student_id || null,
          assigned_by,
          due_at: due_at || null,
          sort_order: sort_order ?? null
        })
      })
      if (!response.ok) {
        const text = await response.text()
        error.value = text || `Server error (${response.status})`
        return { success: false, error: error.value }
      }
      const data = await response.json()
      if (data.success) {
        teacherAssignments.value = [data.assignment, ...teacherAssignments.value]
      } else {
        error.value = data.error || 'Failed to create assignment'
      }
      return data
    } catch (err) {
      console.error('Failed to create assignment:', err)
      error.value = 'Unable to connect to server'
      return { success: false, error: 'Unable to connect to server' }
    } finally {
      loading.value = false
    }
  }

  /** Delete an assignment */
  async function deleteAssignment(assignmentId) {
    try {
      const response = await apiFetch(
        `${API_URL}/assignments/${encodeURIComponent(assignmentId)}`,
        {
          method: 'DELETE'
        }
      )
      if (!response.ok) {
        const text = await response.text()
        error.value = text || `Server error (${response.status})`
        return { success: false, error: error.value }
      }
      const data = await response.json()
      if (data.success) {
        teacherAssignments.value = teacherAssignments.value.filter(a => a.id !== assignmentId)
        studentAssignments.value = studentAssignments.value.filter(a => a.id !== assignmentId)
      }
      return data
    } catch (err) {
      console.error('Failed to delete assignment:', err)
      return { success: false, error: 'Unable to connect to server' }
    }
  }

  /**
   * Close (archive) or reopen an assignment. Non-destructive: the record and
   * its results are kept — closing just marks it review-only (drops off the
   * open count / dashboard cards; shows as "Closed" in the student panel).
   * Updates the matching row's closed_at in place so the UI reflects it
   * without a refetch.
   */
  async function setAssignmentClosed(assignmentId, closed) {
    try {
      const response = await apiFetch(
        `${API_URL}/assignments/${encodeURIComponent(assignmentId)}/closed`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ closed })
        }
      )
      if (!response.ok) {
        const text = await response.text()
        error.value = text || `Server error (${response.status})`
        return { success: false, error: error.value }
      }
      const data = await response.json()
      if (data.success) {
        const closedAt = closed ? new Date().toISOString() : null
        const apply = (list) => {
          const a = list.value.find(x => x.id === assignmentId)
          if (a) a.closed_at = closedAt
        }
        apply(teacherAssignments)
        apply(studentAssignments)
      }
      return data
    } catch (err) {
      console.error('Failed to update assignment closed state:', err)
      return { success: false, error: 'Unable to connect to server' }
    }
  }

  /** Fetch exercise boards for loading into practice mode */
  async function fetchExerciseBoards(exerciseId) {
    try {
      const response = await apiFetch(
        `${API_URL}/exercises/${encodeURIComponent(exerciseId)}`
      )
      if (!response.ok) return null
      const data = await response.json()
      if (data.success) {
        return data.exercise.boards // [{ deal_subfolder, deal_number, sort_order }]
      }
      return null
    } catch (err) {
      console.error('Failed to fetch exercise boards:', err)
      return null
    }
  }

  /** Reset all state */
  function reset() {
    studentAssignments.value = []
    teacherAssignments.value = []
    currentAssignment.value = null
    loading.value = false
    error.value = null
  }

  return {
    studentAssignments,
    teacherAssignments,
    currentAssignment,
    loading,
    error,
    fetchStudentAssignments,
    fetchTeacherAssignments,
    fetchClassroomAssignments,
    fetchAssignmentDetail,
    createAssignment,
    deleteAssignment,
    setAssignmentClosed,
    fetchExerciseBoards,
    reset
  }
}

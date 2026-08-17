import { ref } from 'vue'
import { API_URL } from '@/utils/apiUrl.js'
import { apiFetch } from '@/utils/apiFetch.js'

/**
 * The student's list is per ASSIGNMENT, not per exercise.
 *
 * It used to collapse by `exercise_id`, keeping whichever row had the most attempted
 * boards. That threw away real work. Re-assigning an exercise a class did last term is
 * new work, and an exercise reaching a student through two classrooms they both belong
 * to is two pieces of work — progress is stored per assignment_id, so each row carries
 * its own. Worse, when the surviving row was a CLOSED one (the teacher had archived the
 * earlier assignment) the panel then filtered it out for being closed and the student
 * was left with nothing at all, which is how a repeat went missing entirely.
 *
 * What remains is a guard against the same assignment arriving twice. The server cannot
 * currently produce that — /api/assignments selects from `assignments` with only 1:1
 * joins, and the classroom-membership test is an `IN` subquery, which does not fan out —
 * so this is insurance against a future join, not a workaround for anything today.
 */
export function dedupeStudentAssignments(assignments) {
  const seen = new Set()
  const out = []
  for (const a of assignments || []) {
    // A row with no id cannot be de-duplicated; keep it rather than collapse them all.
    if (a?.id != null) {
      if (seen.has(a.id)) continue
      seen.add(a.id)
    }
    out.push(a)
  }
  return out
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

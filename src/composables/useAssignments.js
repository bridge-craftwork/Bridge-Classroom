import { ref } from 'vue'
import { API_URL } from '@/utils/apiUrl.js'
import { apiFetch } from '@/utils/apiFetch.js'

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
        // Deduplicate by exercise_id — when the same exercise is assigned
        // through multiple classrooms, keep only one entry with best progress
        const byExercise = new Map()
        for (const a of data.assignments) {
          const existing = byExercise.get(a.exercise_id)
          if (!existing || a.attempted_boards > existing.attempted_boards) {
            byExercise.set(a.exercise_id, a)
          }
        }
        studentAssignments.value = Array.from(byExercise.values())
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
    fetchExerciseBoards,
    reset
  }
}

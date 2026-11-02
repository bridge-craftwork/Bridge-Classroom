import { ref } from 'vue'
import { API_URL } from '@/utils/apiUrl.js'
import { apiFetch } from '@/utils/apiFetch.js'

// Singleton reactive state
const teacherClassrooms = ref([])
const currentClassroom = ref(null)
const loading = ref(false)
const error = ref(null)

export function useClassrooms() {
  // ---- Teacher methods ----

  /** Fetch all classrooms for a teacher (with member counts) */
  async function fetchTeacherClassrooms(teacherId) {
    loading.value = true
    error.value = null
    try {
      const response = await apiFetch(
        `${API_URL}/classrooms?teacher_id=${encodeURIComponent(teacherId)}`
      )
      const data = await response.json()
      if (data.success) {
        teacherClassrooms.value = data.classrooms
      } else {
        error.value = data.error || 'Failed to fetch classrooms'
      }
      return data
    } catch (err) {
      console.error('Failed to fetch classrooms:', err)
      error.value = 'Unable to connect to server'
      return null
    } finally {
      loading.value = false
    }
  }

  /** Create a new classroom */
  async function createClassroom(teacherId, name, description) {
    loading.value = true
    error.value = null
    try {
      const response = await apiFetch(`${API_URL}/classrooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          teacher_id: teacherId,
          name,
          description: description || null
        })
      })
      if (!response.ok) {
        const text = await response.text()
        error.value = text || `Server error (${response.status})`
        return { success: false, error: error.value }
      }
      const data = await response.json()
      if (data.success) {
        teacherClassrooms.value = [data.classroom, ...teacherClassrooms.value]
      } else {
        error.value = data.error || 'Failed to create classroom'
      }
      return data
    } catch (err) {
      console.error('Failed to create classroom:', err)
      error.value = 'Unable to connect to server'
      return { success: false, error: 'Unable to connect to server' }
    } finally {
      loading.value = false
    }
  }

  /** Fetch classroom detail with member roster */
  async function fetchClassroomDetail(classroomId) {
    loading.value = true
    error.value = null
    try {
      const response = await apiFetch(
        `${API_URL}/classrooms/${encodeURIComponent(classroomId)}`
      )
      const data = await response.json()
      if (data.success) {
        currentClassroom.value = data.classroom
      } else {
        error.value = data.error || 'Failed to fetch classroom'
      }
      return data
    } catch (err) {
      console.error('Failed to fetch classroom detail:', err)
      error.value = 'Unable to connect to server'
      return null
    } finally {
      loading.value = false
    }
  }

  /** Remove a member from a classroom (teacher action) */
  async function removeMember(classroomId, studentId) {
    try {
      const response = await apiFetch(
        `${API_URL}/classrooms/${encodeURIComponent(classroomId)}/members/${encodeURIComponent(studentId)}`,
        {
          method: 'DELETE'
        }
      )
      const data = await response.json()
      if (data.success && currentClassroom.value) {
        // Update local state
        currentClassroom.value.members = currentClassroom.value.members.filter(
          m => m.student_id !== studentId
        )
        // Update member count in list
        const idx = teacherClassrooms.value.findIndex(c => c.id === classroomId)
        if (idx !== -1) {
          teacherClassrooms.value[idx].member_count--
        }
      }
      return data
    } catch (err) {
      console.error('Failed to remove member:', err)
      return { success: false, error: 'Unable to connect to server' }
    }
  }

  // ---- Student methods ----

  /** Fetch public join info for a classroom (no auth required) */
  async function fetchJoinInfo(joinCode) {
    loading.value = true
    error.value = null
    try {
      const response = await apiFetch(
        `${API_URL}/join/${encodeURIComponent(joinCode)}`
        // Public endpoint (API key not required); apiFetch attaches it harmlessly
      )
      if (response.status === 404) {
        error.value = 'Classroom not found'
        return null
      }
      const data = await response.json()
      return data
    } catch (err) {
      console.error('Failed to fetch join info:', err)
      error.value = 'Unable to connect to server'
      return null
    } finally {
      loading.value = false
    }
  }

  /** Join a classroom (creates membership + sharing grant) */
  async function joinClassroom(joinCode, studentId, encryptedGrantPayload) {
    loading.value = true
    error.value = null
    try {
      const response = await apiFetch(
        `${API_URL}/join/${encodeURIComponent(joinCode)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            student_id: studentId,
            encrypted_grant_payload: encryptedGrantPayload
          })
        }
      )
      const data = await response.json()
      if (!data.success) {
        error.value = data.error || 'Failed to join classroom'
      }
      return data
    } catch (err) {
      console.error('Failed to join classroom:', err)
      error.value = 'Unable to connect to server'
      return { success: false, error: 'Unable to connect to server' }
    } finally {
      loading.value = false
    }
  }

  /** Student leaves a classroom */
  async function leaveClassroom(classroomId, studentId) {
    try {
      const response = await apiFetch(
        `${API_URL}/classrooms/${encodeURIComponent(classroomId)}/members/leave`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ student_id: studentId })
        }
      )
      return await response.json()
    } catch (err) {
      console.error('Failed to leave classroom:', err)
      return { success: false, error: 'Unable to connect to server' }
    }
  }

  /**
   * The teachers a student is sharing with, as { success, grants }. Leaves out
   * the admin grant every account gets at sign-up: it isn't a teacher's access.
   */
  async function fetchTeacherGrants(studentId) {
    try {
      const [grantsRes, adminRes] = await Promise.all([
        apiFetch(`${API_URL}/grants?grantor_id=${encodeURIComponent(studentId)}`),
        apiFetch(`${API_URL}/keys/admin`) // 404 just means no admin is configured
      ])
      if (!grantsRes.ok || (!adminRes.ok && adminRes.status !== 404)) {
        return { success: false, error: 'Unable to load sharing details' }
      }
      const { grants } = await grantsRes.json()
      const adminViewerId = adminRes.ok ? (await adminRes.json()).viewer_id : null
      return { success: true, grants: grants.filter(g => g.grantee_id !== adminViewerId) }
    } catch (err) {
      console.error('Failed to fetch sharing grants:', err)
      return { success: false, error: 'Unable to connect to server' }
    }
  }

  /** Revoke a sharing grant (forward-looking: sets revoked on the server) */
  async function revokeGrant(grantId) {
    try {
      const response = await apiFetch(`${API_URL}/grants/${encodeURIComponent(grantId)}`, {
        method: 'DELETE'
      })
      if (!response.ok) return { success: false, error: `Server error ${response.status}` }
      return await response.json()
    } catch (err) {
      console.error('Failed to revoke grant:', err)
      return { success: false, error: 'Unable to connect to server' }
    }
  }

  /** Reset all state */
  function reset() {
    teacherClassrooms.value = []
    currentClassroom.value = null
    loading.value = false
    error.value = null
  }

  return {
    teacherClassrooms,
    currentClassroom,
    loading,
    error,
    fetchTeacherClassrooms,
    createClassroom,
    fetchClassroomDetail,
    removeMember,
    fetchJoinInfo,
    joinClassroom,
    leaveClassroom,
    fetchTeacherGrants,
    revokeGrant,
    reset
  }
}

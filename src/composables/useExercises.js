import { ref } from 'vue'
import { API_URL } from '@/utils/apiUrl.js'
import { apiFetch } from '@/utils/apiFetch.js'

// Singleton reactive state
const exercises = ref([])
const currentExercise = ref(null)
const loading = ref(false)
const error = ref(null)

export function useExercises() {
  /** Fetch exercises with optional filters */
  async function fetchExercises(filters = {}) {
    loading.value = true
    error.value = null
    try {
      const params = new URLSearchParams()
      if (filters.created_by) params.set('created_by', filters.created_by)
      if (filters.curriculum_path) params.set('curriculum_path', filters.curriculum_path)
      if (filters.visibility) params.set('visibility', filters.visibility)

      const qs = params.toString()
      const url = `${API_URL}/exercises${qs ? '?' + qs : ''}`

      const response = await apiFetch(url)
      if (!response.ok) {
        const text = await response.text()
        error.value = text || `Server error (${response.status})`
        return null
      }
      const data = await response.json()
      if (data.success) {
        exercises.value = data.exercises
      } else {
        error.value = data.error || 'Failed to fetch exercises'
      }
      return data
    } catch (err) {
      console.error('Failed to fetch exercises:', err)
      error.value = 'Unable to connect to server'
      return null
    } finally {
      loading.value = false
    }
  }

  /** Fetch exercise detail with board list */
  async function fetchExerciseDetail(exerciseId) {
    loading.value = true
    error.value = null
    try {
      const response = await apiFetch(
        `${API_URL}/exercises/${encodeURIComponent(exerciseId)}`
      )
      if (!response.ok) {
        const text = await response.text()
        error.value = text || `Server error (${response.status})`
        return null
      }
      const data = await response.json()
      if (data.success) {
        currentExercise.value = data.exercise
      } else {
        error.value = data.error || 'Failed to fetch exercise'
      }
      return data
    } catch (err) {
      console.error('Failed to fetch exercise detail:', err)
      error.value = 'Unable to connect to server'
      return null
    } finally {
      loading.value = false
    }
  }

  /** Create a new exercise with boards */
  async function createExercise({ name, description, created_by, curriculum_path, visibility, boards }) {
    loading.value = true
    error.value = null
    try {
      const response = await apiFetch(`${API_URL}/exercises`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name,
          description: description || null,
          created_by: created_by || null,
          curriculum_path: curriculum_path || null,
          visibility: visibility || 'public',
          boards
        })
      })
      if (!response.ok) {
        const text = await response.text()
        error.value = text || `Server error (${response.status})`
        return { success: false, error: error.value }
      }
      const data = await response.json()
      if (data.success) {
        exercises.value = [data.exercise, ...exercises.value]
      } else {
        error.value = data.error || 'Failed to create exercise'
      }
      return data
    } catch (err) {
      console.error('Failed to create exercise:', err)
      error.value = 'Unable to connect to server'
      return { success: false, error: 'Unable to connect to server' }
    } finally {
      loading.value = false
    }
  }

  /**
   * Update an existing exercise. Pass `updates.actor_user_id` so the
   * backend can enforce per-creator ownership (issue #15).
   */
  async function updateExercise(exerciseId, updates) {
    loading.value = true
    error.value = null
    try {
      const response = await apiFetch(
        `${API_URL}/exercises/${encodeURIComponent(exerciseId)}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(updates)
        }
      )
      if (!response.ok) {
        const text = await response.text()
        error.value = text || `Server error (${response.status})`
        return { success: false, error: error.value }
      }
      const data = await response.json()
      if (!data.success) {
        error.value = data.error || 'Failed to update exercise'
      }
      return data
    } catch (err) {
      console.error('Failed to update exercise:', err)
      error.value = 'Unable to connect to server'
      return { success: false, error: 'Unable to connect to server' }
    } finally {
      loading.value = false
    }
  }

  /**
   * Soft-delete an exercise (issue #15). Pass `actorUserId` so the
   * backend can enforce ownership. The row is tombstoned, not removed,
   * so observation history keeps resolving against the exercise_id.
   */
  async function deleteExercise(exerciseId, actorUserId = null) {
    try {
      const params = new URLSearchParams()
      if (actorUserId) params.set('actor_user_id', actorUserId)
      const qs = params.toString()
      const response = await apiFetch(
        `${API_URL}/exercises/${encodeURIComponent(exerciseId)}${qs ? '?' + qs : ''}`,
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
        exercises.value = exercises.value.filter(e => e.id !== exerciseId)
      }
      return data
    } catch (err) {
      console.error('Failed to delete exercise:', err)
      return { success: false, error: 'Unable to connect to server' }
    }
  }

  /** Reset all state */
  function reset() {
    exercises.value = []
    currentExercise.value = null
    loading.value = false
    error.value = null
  }

  return {
    exercises,
    currentExercise,
    loading,
    error,
    fetchExercises,
    fetchExerciseDetail,
    createExercise,
    updateExercise,
    deleteExercise,
    reset
  }
}

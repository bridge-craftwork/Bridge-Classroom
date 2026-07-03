// Teacher deal library (roadmap Phase 2.5, step 2). Owner-scoped CRUD over
// the Mac API's `deal_library` table — a per-teacher hierarchy of folders,
// materialized PBN files (uploads + playlists), and link references
// (favorites that track an evolving source). Mirrors useExercises.js.
//
// The list endpoint returns metadata only (no payload) — `has_payload` /
// `payload_bytes` are inlined so the UI can show "24 boards ≈ 4KB" without
// shipping the text. Fetch a single entry to get its `payload` (PBN text
// for files, JSON descriptor for links). `settings` is a raw JSON string
// (rotate / mode / bot); use parseSettings() to read it.
//
// Singleton pattern (module-level state) per project convention.
import { ref } from 'vue'
import { API_URL } from '@/utils/apiUrl.js'

const API_KEY = import.meta.env.VITE_API_KEY || ''

const entries = ref([]) // metadata list for the last-fetched owner/folder
const loading = ref(false)
const error = ref(null)

/** Parse an entry's `settings` JSON string into an object ({} on absent/bad). */
export function parseSettings(entry) {
  if (!entry || !entry.settings) return {}
  try {
    return JSON.parse(entry.settings)
  } catch {
    return {}
  }
}

export function useDealLibrary() {
  /**
   * List a teacher's entries (metadata only). Pass `parentId` to fetch a
   * single folder's children, or the sentinel `'root'` for top-level
   * entries; omit for the whole flat tree (the client assembles it).
   */
  async function fetchLibrary(owner, { parentId } = {}) {
    if (!owner) {
      error.value = 'No owner given'
      return null
    }
    loading.value = true
    error.value = null
    try {
      const params = new URLSearchParams({ owner })
      if (parentId) params.set('parent_id', parentId)
      const response = await fetch(`${API_URL}/deal-library?${params.toString()}`, {
        headers: { 'x-api-key': API_KEY },
      })
      if (!response.ok) {
        error.value = (await response.text()) || `Server error (${response.status})`
        return null
      }
      const data = await response.json()
      if (data.success) {
        entries.value = data.entries
      } else {
        error.value = data.error || 'Failed to fetch library'
      }
      return data
    } catch (err) {
      console.error('Failed to fetch deal library:', err)
      error.value = 'Unable to connect to server'
      return null
    } finally {
      loading.value = false
    }
  }

  /** Fetch a single entry WITH its payload (PBN text or JSON descriptor). */
  async function fetchEntry(id) {
    try {
      const response = await fetch(`${API_URL}/deal-library/${encodeURIComponent(id)}`, {
        headers: { 'x-api-key': API_KEY },
      })
      if (!response.ok) {
        error.value = (await response.text()) || `Server error (${response.status})`
        return null
      }
      const data = await response.json()
      if (!data.success) {
        error.value = data.error || 'Failed to fetch entry'
        return null
      }
      return data.entry
    } catch (err) {
      console.error('Failed to fetch library entry:', err)
      error.value = 'Unable to connect to server'
      return null
    }
  }

  /**
   * Create a folder / file / link. `payload` is PBN text (file) or a JSON
   * descriptor string (link); folders take none. `settings` is a JSON
   * string. Returns the create response ({ success, entry }).
   */
  async function createEntry({ owner, parent_id, kind, name, payload, settings, sort_order }) {
    loading.value = true
    error.value = null
    try {
      const response = await fetch(`${API_URL}/deal-library`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
        body: JSON.stringify({
          owner,
          parent_id: parent_id || null,
          kind,
          name,
          payload: payload ?? null,
          settings: settings ?? null,
          sort_order: sort_order ?? 0,
        }),
      })
      if (!response.ok) {
        error.value = (await response.text()) || `Server error (${response.status})`
        return { success: false, error: error.value }
      }
      const data = await response.json()
      if (!data.success) error.value = data.error || 'Failed to create entry'
      return data
    } catch (err) {
      console.error('Failed to create library entry:', err)
      error.value = 'Unable to connect to server'
      return { success: false, error: 'Unable to connect to server' }
    } finally {
      loading.value = false
    }
  }

  /**
   * Update an entry (owner-checked). `updates` must include
   * `actor_user_id`. To move to the root pass `parent_id: null`; to clear
   * settings pass `settings: null`.
   */
  async function updateEntry(id, updates) {
    loading.value = true
    error.value = null
    try {
      const response = await fetch(`${API_URL}/deal-library/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
        body: JSON.stringify(updates),
      })
      if (!response.ok) {
        error.value = (await response.text()) || `Server error (${response.status})`
        return { success: false, error: error.value }
      }
      const data = await response.json()
      if (!data.success) error.value = data.error || 'Failed to update entry'
      return data
    } catch (err) {
      console.error('Failed to update library entry:', err)
      error.value = 'Unable to connect to server'
      return { success: false, error: 'Unable to connect to server' }
    } finally {
      loading.value = false
    }
  }

  /**
   * Soft-delete an entry (owner-checked). Deleting a folder cascades to its
   * whole subtree server-side. `actorUserId` must own the entry.
   */
  async function deleteEntry(id, actorUserId) {
    try {
      const params = new URLSearchParams()
      if (actorUserId) params.set('actor_user_id', actorUserId)
      const qs = params.toString()
      const response = await fetch(
        `${API_URL}/deal-library/${encodeURIComponent(id)}${qs ? '?' + qs : ''}`,
        { method: 'DELETE', headers: { 'x-api-key': API_KEY } }
      )
      if (!response.ok) {
        error.value = (await response.text()) || `Server error (${response.status})`
        return { success: false, error: error.value }
      }
      const data = await response.json()
      if (data.success) {
        entries.value = entries.value.filter((e) => e.id !== id)
      }
      return data
    } catch (err) {
      console.error('Failed to delete library entry:', err)
      return { success: false, error: 'Unable to connect to server' }
    }
  }

  function reset() {
    entries.value = []
    loading.value = false
    error.value = null
  }

  return {
    entries,
    loading,
    error,
    fetchLibrary,
    fetchEntry,
    createEntry,
    updateEntry,
    deleteEntry,
    reset,
  }
}

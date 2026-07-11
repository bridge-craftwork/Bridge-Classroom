import { ref } from 'vue'
import { API_URL } from '@/utils/apiUrl.js'
import { apiFetch } from '@/utils/apiFetch.js'

// Singleton state
const announcement = ref(null)
const loading = ref(false)
const dismissed = ref(null) // stores the dismissed announcement ID (session-only)

async function loadAnnouncement() {
  loading.value = true
  try {
    const res = await apiFetch(`${API_URL}/announcements/active`)
    if (!res.ok) return
    const data = await res.json()
    const prev = announcement.value
    announcement.value = data.announcement || null

    // Reset dismissed state if the announcement changed
    if (announcement.value && (!prev || prev.id !== announcement.value.id)) {
      dismissed.value = null
    }
  } catch {
    // Best-effort — don't block the app
  } finally {
    loading.value = false
  }
}

async function setAnnouncement(message, type = 'info', expiresAt = null) {
  const body = { message, type }
  if (expiresAt) body.expires_at = expiresAt

  const res = await apiFetch(`${API_URL}/admin/announcement`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`Failed to set announcement: ${res.status}`)
  const data = await res.json()
  announcement.value = data.announcement || null
  dismissed.value = null
  return data
}

async function clearAnnouncement() {
  const res = await apiFetch(`${API_URL}/admin/announcement`, {
    method: 'DELETE'
  })
  if (!res.ok) throw new Error(`Failed to clear announcement: ${res.status}`)
  announcement.value = null
  dismissed.value = null
}

function dismiss() {
  if (announcement.value) {
    dismissed.value = announcement.value.id
  }
}

export function useAnnouncement() {
  return {
    announcement,
    loading,
    dismissed,
    loadAnnouncement,
    setAnnouncement,
    clearAnnouncement,
    dismiss
  }
}

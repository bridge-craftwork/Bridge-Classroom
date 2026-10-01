// Bridge Classroom's adapters for the convention card editor
// (github.com/bridge-craftwork/convention-card, web/src/editor/useCardEditor.js
// describes their shape). The editor moved there in its Phase 3; where cards
// live (this API, linked to users) and the lesson-mastery overlay stay here.
// The calls are the ones useConventionCard.js made.

import { API_URL } from '@/utils/apiUrl.js'
import { apiFetch } from '@/utils/apiFetch.js'
import { useUserStore } from '../composables/useUserStore.js'
import { useBoardStatus } from '../composables/useBoardStatus.js'
import { BAKER_BRIDGE_TAXONOMY, getTaxonomyEntry, getSubfolderForSkill } from './bakerBridgeTaxonomy.js'

const userStore = useUserStore()
const currentUserId = () => userStore.currentUser.value?.id

async function fail(res, what) {
  const text = await res.text().catch(() => '')
  throw new Error(text || `${what} failed (${res.status})`)
}

async function fetchCardById(cardId) {
  const viewerId = currentUserId()
  const url = viewerId
    ? `${API_URL}/cards/${encodeURIComponent(cardId)}?viewer_id=${encodeURIComponent(viewerId)}`
    : `${API_URL}/cards/${encodeURIComponent(cardId)}`
  const res = await apiFetch(url)
  if (!res.ok) throw new Error(`Failed to load card ${cardId}: ${res.status}`)
  const data = await res.json()
  const card = data.card || data
  if (typeof card.card_data === 'string') {
    try { card.card_data = JSON.parse(card.card_data) } catch { /* leave as-is */ }
  }
  return card
}

async function fetchPublicSystemCard() {
  const res = await apiFetch(`${API_URL}/cards?visibility=public`)
  if (!res.ok) throw new Error(`Failed to list public cards: ${res.status}`)
  const data = await res.json()
  const list = data.cards || data || []
  const card = list.find(c => c.owner_id === null) || list[0]
  if (!card) throw new Error('No public convention card available')
  return fetchCardById(card.id)
}

async function fetchLinks(userId) {
  const res = await apiFetch(`${API_URL}/users/${encodeURIComponent(userId)}/cards`)
  if (!res.ok) return []
  const data = await res.json()
  return data.cards || data || []
}

/** Cards live in Bridge Classroom's API, linked to the signed-in user. */
export const bridgeClassroomStorage = {
  user: userStore.currentUser,

  async loadDefault() {
    const userId = currentUserId()
    if (userId) {
      try {
        const links = await fetchLinks(userId)
        const primary = links.find(c => c.is_primary) || links[0]
        if (primary) return await fetchCardById(primary.card_id || primary.id)
      } catch { /* fall through to the system card */ }
    }
    return fetchPublicSystemCard()
  },

  load: fetchCardById,

  async listLinks() {
    const userId = currentUserId()
    return userId ? fetchLinks(userId) : []
  },

  async save(card, cardData) {
    const res = await apiFetch(`${API_URL}/cards/${encodeURIComponent(card.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acting_user_id: currentUserId(), card_data: cardData })
    })
    if (!res.ok) await fail(res, 'Save')
  },

  async overwrite(cardId, { name, description, cardData }) {
    const res = await apiFetch(`${API_URL}/cards/${encodeURIComponent(cardId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        acting_user_id: currentUserId(),
        name: name ?? undefined,
        description: description ?? undefined,
        card_data: cardData
      })
    })
    if (!res.ok) await fail(res, 'Overwrite')
  },

  async create({ name, description = null, cardData = {}, visibility = 'private' }) {
    const userId = currentUserId()
    const res = await apiFetch(`${API_URL}/cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acting_user_id: userId, name, description, card_data: cardData, visibility })
    })
    if (!res.ok) await fail(res, 'Create')
    const { card_id } = await res.json()
    // Link as primary, as the lobby tab always has.
    await apiFetch(`${API_URL}/users/${encodeURIComponent(userId)}/cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card_id, is_primary: true, acting_user_id: userId })
    })
    return card_id
  },

  async remove(cardId) {
    const url = `${API_URL}/cards/${encodeURIComponent(cardId)}?acting_user_id=${encodeURIComponent(currentUserId())}`
    const res = await apiFetch(url, { method: 'DELETE' })
    if (!res.ok) await fail(res, 'Delete')
  },

  canEdit(card, user) {
    if (!user || !card) return false
    if (user.role === 'admin') return true
    // Owner of a private card may edit; public cards locked to admins
    return card.visibility !== 'public' && card.owner_id === user.id
  }
}

/** Solo-practice coverage (Baker Bridge deals) and the user's lesson mastery. */
export const bridgeClassroomOverlays = {
  covered: skillPath => !!getTaxonomyEntry(skillPath),

  async mastery(user) {
    const bySubfolder = await useBoardStatus().fetchLessonMastery(user.id)
    const bySkill = {}
    for (const { path } of BAKER_BRIDGE_TAXONOMY) {
      const tier = bySubfolder[getSubfolderForSkill(path)]
      if (tier) bySkill[path] = tier
    }
    return bySkill
  }
}

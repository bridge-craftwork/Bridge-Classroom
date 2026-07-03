// Club games — a registered user's analyzed-event archive (app-architecture.md
// M3/M4, table D13). Read-side composable for the table deal-source picker's
// "My club games" pull: list a user's games, then fetch one's native normalized
// JSON to deal boards from. Games are written by the game-analysis app on load
// (see maybeSaveClubGame there); this app only reads them here.
//
// Singleton pattern (module-level state) per project convention.
import { ref } from 'vue'
import { API_URL } from '@/utils/apiUrl.js'

const API_KEY = import.meta.env.VITE_API_KEY || ''

const games = ref([]) // metadata list for the last-fetched owner
const loading = ref(false)
const error = ref(null)

export function useClubGames() {
  /** List a user's games (metadata only, newest first — no payload). */
  async function fetchGames(owner) {
    if (!owner) {
      error.value = 'No owner given'
      return null
    }
    loading.value = true
    error.value = null
    try {
      const response = await fetch(
        `${API_URL}/club-games?owner=${encodeURIComponent(owner)}`,
        { headers: { 'x-api-key': API_KEY } }
      )
      if (!response.ok) {
        error.value = (await response.text()) || `Server error (${response.status})`
        return null
      }
      const data = await response.json()
      if (data.success) {
        games.value = data.games
      } else {
        error.value = data.error || 'Failed to fetch club games'
      }
      return data
    } catch (err) {
      console.error('Failed to fetch club games:', err)
      error.value = 'Unable to connect to server'
      return null
    } finally {
      loading.value = false
    }
  }

  /** Fetch one game WITH its native normalized JSON `payload`. */
  async function fetchGame(id) {
    try {
      const response = await fetch(`${API_URL}/club-games/${encodeURIComponent(id)}`, {
        headers: { 'x-api-key': API_KEY },
      })
      if (!response.ok) {
        error.value = (await response.text()) || `Server error (${response.status})`
        return null
      }
      const data = await response.json()
      if (!data.success) {
        error.value = data.error || 'Failed to fetch game'
        return null
      }
      return data.game
    } catch (err) {
      console.error('Failed to fetch club game:', err)
      error.value = 'Unable to connect to server'
      return null
    }
  }

  function reset() {
    games.value = []
    loading.value = false
    error.value = null
  }

  return { games, loading, error, fetchGames, fetchGame, reset }
}

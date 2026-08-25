// Club games — a registered user's analyzed-event archive (app-architecture.md
// M3/M4, table D13). Read-side composable for the table deal-source picker's
// "My club games" pull: list a user's games, then fetch one's native normalized
// JSON to deal boards from. Games are written by the game-analysis app on load
// (see maybeSaveClubGame there); this app only reads them here.
//
// Singleton pattern (module-level state) per project convention.
import { ref } from 'vue'
import { API_URL } from '@/utils/apiUrl.js'
import { apiFetch } from '@/utils/apiFetch.js'
import { needsEwSeatFix, fixEwSeatOrder } from '@/utils/seatOrder.js'

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
      const response = await apiFetch(
        `${API_URL}/club-games?owner=${encodeURIComponent(owner)}`
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
      const response = await apiFetch(`${API_URL}/club-games/${encodeURIComponent(id)}`)
      if (!response.ok) {
        error.value = (await response.text()) || `Server error (${response.status})`
        return null
      }
      const data = await response.json()
      if (!data.success) {
        error.value = data.error || 'Failed to fetch game'
        return null
      }
      return correctSeatOrder(data.game)
    } catch (err) {
      console.error('Failed to fetch club game:', err)
      error.value = 'Unable to connect to server'
      return null
    }
  }

  /** Correct E-W seat order on the way out of the archive.
   *
   *  Captures stored by extension builds below 1.3 are sitting on the server
   *  East-first (seat-order-contract.md § Consumer rule), so a row read back
   *  needs the same correction the ingest page applies at the door. Fixing on
   *  read rather than backfilling the table costs no migration and self-heals:
   *  the rule is version-gated and restamps, so a row written after the ingest
   *  fix is already 1.3 and passes through untouched.
   */
  function correctSeatOrder(game) {
    if (!game?.payload) return game
    let envelope
    try {
      envelope = JSON.parse(game.payload)
    } catch {
      return game // not JSON we can read; the caller reports it
    }
    if (!needsEwSeatFix(envelope)) return game
    return { ...game, payload: JSON.stringify(fixEwSeatOrder(envelope)) }
  }

  function reset() {
    games.value = []
    loading.value = false
    error.value = null
  }

  return { games, loading, error, fetchGames, fetchGame, reset }
}

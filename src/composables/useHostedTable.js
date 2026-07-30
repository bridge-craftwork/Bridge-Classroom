// useHostedTable — the host side of a served table's lifecycle, lifted verbatim
// out of TableHostView so a single unified `/table` view can drive it
// CONDITIONALLY (start solo/local, upgrade to a hosted server session on invite).
// See documentation/design/table-view-unification-plan.md → "Full collapse + one
// route" (Stage A).
//
// Owns: resume-or-create the owner's single adhoc session, connect the socket
// SEATED as the owner, the evergreen invite link, test-player spawn, the
// solo→served handoff apply, dead-session recovery, and teardown. It does NOT
// render anything and takes no view state — navigation is injected via `onExit`
// so the composable stays view-agnostic. Not a module singleton: one hosted
// table per view instance.
//
// The Mac API enforces one open session per owner, so "resume or create" is
// idempotent per user.

import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useUserStore } from './useUserStore.js'
import { useRemoteTable } from './useRemoteTable.js'
import { useTeacherConsole } from './useTeacherConsole.js'
import { useDealSourceResolver } from './useDealSourceResolver.js'
import { useTableHandoff } from './useTableHandoff.js'
import { API_URL } from '../utils/apiUrl.js'
import { testStudentName } from '../utils/testStudents.js'
import { buildInviteUrl } from '../utils/inviteUrl.js'

const API_KEY = import.meta.env.VITE_API_KEY || ''

/**
 * @param {Object} [opts]
 * @param {() => void} [opts.onExit]  Called after teardown when the host leaves
 *   (End table / session-ended exit). The view decides where to go.
 */
export function useHostedTable({ onExit } = {}) {
  const userStore = useUserStore()
  const currentUser = userStore.currentUser

  const table = useRemoteTable()
  // The console composable is used ONLY to send host-control frames (load_boards)
  // — they ride the same useTableSocket singleton the seated-player connection
  // uses, and the server accepts them from the owner sub. The host is a seated
  // PLAYER (as_player), so there's no lobby/deck feed here (that's the teacher
  // console's see-all path).
  const console_ = useTeacherConsole()
  const { materialize } = useDealSourceResolver()
  const handoff = useTableHandoff()

  const { connectionStatus, sessionClosed, dealLoaded } = table

  const connected = computed(() => connectionStatus.value === 'connected')
  const sessionId = ref(null)
  const hasSession = computed(() => !!sessionId.value && !sessionClosed.value)
  // Spotlight the Deal source until a deal is loaded: the table (seats + bots) is
  // up and invitable, but nothing plays until a source is picked.
  const needsDeal = computed(() => connected.value && hasSession.value && !dealLoaded.value)
  const resolving = ref(true)
  const startError = ref('')
  const loadError = ref('')
  const ending = ref(false) // host clicked "End table" (vs an unexpected close)
  let recoveredOnce = false

  // ── Table invite link (evergreen invite_code → /table/:code join URL) ───────
  // The TABLE link, not the class link: invite_code is available to ANY signed-in
  // user (host_code is teacher-only and backs the /play class link → console). So
  // students get a working invite link here too, and it resolves to this casual
  // adhoc table — never a classroom.
  const shareUrl = ref('')
  const copied = ref(false)
  async function fetchInviteCode() {
    if (!currentUser.value) return null
    try {
      const res = await fetch(`${API_URL}/users/${currentUser.value.id}/invite-code`, {
        method: 'POST',
        headers: { 'x-api-key': API_KEY },
      })
      const data = await res.json()
      if (data.code) {
        shareUrl.value = buildInviteUrl(`#/table/${data.code}`)
        return data.code
      }
    } catch {
      /* best-effort; Copy link stays disabled */
    }
    return null
  }
  async function copyShareUrl() {
    if (!shareUrl.value) return
    try {
      await navigator.clipboard.writeText(shareUrl.value)
      copied.value = true
      setTimeout(() => { copied.value = false }, 2000)
    } catch {
      /* clipboard unavailable */
    }
  }

  // ── Testing: spawn a few player tabs ──────────────────────────────────────
  // Each opens the invite link with ?student=<name>, forcing a named-guest
  // (player) join — bypassing the owner/teacher recognition that would otherwise
  // send you to the console. HUMAN seats you drive manually; bots fill the rest.
  const spawnCount = ref(3)
  function spawnPlayers() {
    if (!shareUrl.value) return
    const n = Math.max(1, Math.min(Number(spawnCount.value) || 1, 3))
    for (let i = 1; i <= n; i++) {
      const name = encodeURIComponent(testStudentName(i))
      window.open(`${shareUrl.value}?student=${name}`, `bc-test-player-${i}`)
    }
  }

  // The host table honors the SAME "play the hand after bidding" preference as
  // the solo table (localStorage `bp.playCardplay`), so an in-place solo→served
  // upgrade — and any later host deal-source load — keeps bidding-only vs
  // bid-and-play instead of the served default (always play). Read the persisted
  // key directly: it's the single source of truth the solo Table settings write.
  // Read the persisted key at CALL TIME rather than caching it in a ref. Table
  // settings moved into the table shell (which is the only surface a guest
  // renders), so the writer now lives in ServerEngine.onSetBoardMode — a cached
  // ref here would go stale the moment the host flipped the mode, and the next
  // deal-source load would silently revert it.
  function hostBoardMode() {
    return typeof localStorage !== 'undefined' && localStorage.getItem('bp.playCardplay') === '1'
      ? 'bid-and-play'
      : 'bid-only'
  }

  // ── Deal source → materialize the whole set onto the table ─────────────────
  async function onLoadSource(selection) {
    loadError.value = ''
    try {
      const { boardsPbn, label } = await materialize(selection)
      console_.loadBoards(boardsPbn, label, hostBoardMode())
      return { ok: true }
    } catch (e) {
      loadError.value = e?.message || 'Could not load that source.'
      return { ok: false, reason: loadError.value }
    }
  }

  // ── Session lifecycle ──────────────────────────────────────────────────────
  // Resume the owner's open session if there is one, else create a casual
  // single-table session. `forceCreate` skips the resume (the recovery watcher
  // uses it when a resumed session turns out to be gone — table-service restarted
  // and dropped its in-memory sessions while the DB still lists it open).
  async function ensureSession({ forceCreate = false } = {}) {
    if (!currentUser.value) { resolving.value = false; return }
    resolving.value = true
    startError.value = ''
    try {
      const code = await fetchInviteCode() // also populates the table invite link
      let id = null
      if (!forceCreate && code) {
        try {
          // Resume the owner's open ADHOC table (invite_code → adhoc); a live
          // classroom, if any, is untouched.
          const res = await fetch(`${API_URL}/table/${code}`)
          const data = await res.json()
          if (data?.session?.id) id = data.session.id
        } catch { /* no open table → create one */ }
      }
      if (!id) id = await createSession()
      if (!id) throw new Error('Could not start your table.')
      sessionId.value = id
      // Join SEATED (as_player) so the host plays their own hand — while still
      // holding the host-control frames. First-free seats the host at South.
      table.join({ sessionId: id, userId: currentUser.value.id, asPlayer: true })
    } catch (e) {
      startError.value = e?.message || 'Could not set up your table.'
    } finally {
      resolving.value = false
    }
  }

  async function createSession() {
    const res = await fetch(`${API_URL}/table-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify({
        owner_user_id: currentUser.value.id,
        kind: 'adhoc',
        boards_pbn: '',
        table_count: 1,
        // Auto-fill: bots hold empty seats; an arriving human takes the first
        // free seat (replacing a bot); a 5th+ human kibitzes.
        seat_policy: { mode: 'auto', pattern: 'first_free' },
      }),
    })
    if (!res.ok) throw new Error((await res.text()) || `Failed (${res.status})`)
    const data = await res.json()
    return data?.session?.id || null
  }

  // A resumed session can be dead on the service (restart drops in-memory
  // sessions; the DB still shows it open) → the join returns unknown_session and
  // useRemoteTable flips sessionClosed. A host always wants a table, so instead
  // of the dead "Session ended" screen, silently start a fresh one (once). An
  // explicit End (ending=true) is left alone.
  watch(sessionClosed, (closed) => {
    if (!closed || ending.value || recoveredOnce) return
    recoveredOnce = true
    resolving.value = true
    teardown()
    ensureSession({ forceCreate: true })
  })

  // "Invite friends" hand-off from the solo Practice Table: once connected,
  // materialize the deal source the solo table was using onto it (once). A direct
  // host entry hands off nothing, so this is a no-op there.
  let handoffApplied = false
  watch(connected, (isConnected) => {
    if (!isConnected || handoffApplied) return
    const pending = handoff.takePending()
    if (!pending) return
    handoffApplied = true
    onLoadSource(pending)
  }, { immediate: true })

  async function endSession() {
    if (!window.confirm('End this table for everyone?')) return
    ending.value = true
    try {
      await fetch(
        `${API_URL}/table-sessions/${sessionId.value}?owner_user_id=${encodeURIComponent(currentUser.value.id)}`,
        { method: 'DELETE', headers: { 'x-api-key': API_KEY } }
      )
    } catch { /* best-effort; the closed event tears down the UI */ }
    teardown()
    onExit && onExit()
  }

  function teardown() {
    console_.detach()
    table.leave()
    sessionId.value = null
  }

  // The served table's "back to lobby" (shown when the session ends).
  function exit() {
    teardown()
    onExit && onExit()
  }

  onBeforeUnmount(teardown)

  return {
    // passthrough table state the host UI reads
    table,
    connectionStatus,
    sessionClosed,
    connected,
    // lifecycle state
    sessionId,
    hasSession,
    needsDeal,
    resolving,
    startError,
    loadError,
    // invite + testing
    shareUrl,
    copied,
    spawnCount,
    copyShareUrl,
    spawnPlayers,
    // table settings
    // actions
    ensureSession,
    onLoadSource,
    endSession,
    teardown,
    exit,
  }
}

// useTeacherConsole — the teacher's side of a table session, layered over
// the same socket as useRemoteTable. The server recognizes the session
// owner (or any teacher-role ticket) at hello time and sends `lobby` frames
// (full session state: every table's board/phase/tricks/seats/ready plus
// the kibitzer roster) on join and on every change. This composable folds
// those frames and exposes the teacher control messages; per-table game
// state for the kibitzed table still flows through useRemoteTable (the
// teacher connection receives that table's snapshot + events after a
// {t:"kibitz"} request).
//
// Singleton pattern (module-level state) per project convention.

import { ref, computed } from 'vue'
import { useTableSocket } from './useTableSocket.js'

const socket = useTableSocket()

// The latest lobby frame, parsed:
// { session_id, set_label, loaded, boards: {total, open, index},
//   tables: [{ table_id, board_no, board_index, phase, tricks: {ns, ew},
//              next_to_act, seats, ready: [] }],
//   kibitzers: [{ sub, name, table_id }] }
const lobby = ref(null)

// Loaded-set status for the console header + reconnect: the server carries
// set_label + the lockstep board index/total in every lobby frame, so this
// survives a teacher disconnect/reconnect for free (roadmap §Phase 3.1).
const deck = computed(() => {
  const l = lobby.value
  if (!l) return { loaded: false, label: null, board: 0, total: 0 }
  return {
    loaded: !!l.loaded,
    label: l.set_label || null,
    board: l.boards?.index || 0, // 1-based current board (0 = idle)
    total: l.boards?.total || 0,
  }
})
// The table the console is currently kibitzing (table_id or null).
const kibitzTableId = ref(null)

let unsubscribe = null

function handleMessage(msg) {
  if (msg.t === 'lobby') {
    lobby.value = msg
  } else if (msg.t === 'event' && msg.kind === 'session_closed') {
    lobby.value = null
    kibitzTableId.value = null
  }
}

// Start folding lobby frames (idempotent). Call before/with the socket
// connect; useRemoteTable.join() owns the actual connection.
function attach() {
  if (!unsubscribe) unsubscribe = socket.onMessage(handleMessage)
}

function detach() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null }
  lobby.value = null
  kibitzTableId.value = null
}

// ── Teacher control messages ───────────────────────────────────────────
// All fire-and-forget: state changes come back as lobby frames / events;
// rejections come back as {t:"error"} frames (surfaced by useRemoteTable).

// Widen the open-board window to `count` (absolute; never narrows). Adhoc
// sessions only — teacher_set is lockstep (use load/goto/next/prev below).
function openBoards(count) {
  return socket.send({ t: 'open_boards', count })
}

// ── Runtime deal source + lockstep board navigation (roadmap §Phase 3.1) ──
// All force EVERY table together. The server replies with lobby/board frames.

// Change the deal source: replace the loaded set (materialized PBN) and its
// label; resets all tables to board 1.
function loadBoards(boardsPbn, label) {
  return socket.send({ t: 'load_boards', boards_pbn: boardsPbn, label })
}

// Jump every table to a 1-based board number (Shark "go to").
function gotoBoard(index) {
  return socket.send({ t: 'goto_board', index })
}

// Advance / back up every table one board (Shark "Next Deal" / redo).
function nextBoard() {
  return socket.send({ t: 'next_board' })
}
function prevBoard() {
  return socket.send({ t: 'prev_board' })
}

// ── Dynamic tables + lobby (roadmap §Phase 3.2) ────────────────────────────

// Seat every WAITING (non-parked) lobby member onto tables (auto-creating).
function seatStudents() {
  return socket.send({ t: 'seat_students' })
}

// Zoom-style waiting room: arrivals wait in the lobby until Seat students.
function setWaitToSeat(on) {
  return socket.send({ t: 'wait_to_seat', on: !!on })
}

// Add N empty tables (testing: fill with bots when nobody's connecting).
function addTables(count) {
  return socket.send({ t: 'add_tables', count })
}

// Advance one table to its next board, skipping the ready/open checks.
function forceAdvance(tableId) {
  return socket.send({ t: 'force_advance', table: tableId })
}

// Seat a known participant (seated elsewhere or kibitzing) at table/seat.
function assignSeat(tableId, seat, sub) {
  return socket.send({ t: 'assign_seat', table: tableId, seat, sub })
}

// Vacate a seat (the seat becomes a bot; a live human keeps kibitzing).
function boot(tableId, seat) {
  return socket.send({ t: 'boot', table: tableId, seat })
}

// Watch one table: the server replies with a see-all snapshot and streams
// that table's events until we kibitz another.
function kibitz(tableId) {
  const ok = socket.send({ t: 'kibitz', table: tableId })
  if (ok) kibitzTableId.value = tableId
  return ok
}

function stopKibitz() {
  // Client-side only: the server keeps streaming the last kibitzed table's
  // events, but useRemoteTable drops frames for tables it isn't viewing.
  kibitzTableId.value = null
}

export function useTeacherConsole() {
  return {
    lobby,
    deck,
    kibitzTableId,
    attach,
    detach,
    openBoards,
    loadBoards,
    gotoBoard,
    nextBoard,
    prevBoard,
    seatStudents,
    setWaitToSeat,
    addTables,
    forceAdvance,
    assignSeat,
    boot,
    kibitz,
    stopKibitz,
    // exposed for unit tests
    _handleMessage: handleMessage,
  }
}

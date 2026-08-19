import { describe, it, expect, beforeEach } from 'vitest'
import { useNewAssignmentAlert } from '../useNewAssignmentAlert.js'

const STUDENT = 'terry-lee'
const OTHER = 'joanne-a'

const mk = (id, assignedAt, closedAt = null) => ({
  id, exercise_id: 'ex-' + id, assigned_at: assignedAt, closed_at: closedAt,
})

// Modelled on the real Tuesday Noon Zoom feed.
const EXISTING = [mk('nfm2', '2026-07-26T20:31:56Z'), mk('nmf1', '2026-07-16T04:55:19Z', '2026-07-26T20:29:28Z')]
const WITH_NEW = [mk('weak-two', '2026-08-14T16:28:16Z'), ...EXISTING]

describe('useNewAssignmentAlert', () => {
  let alert
  beforeEach(() => {
    localStorage.clear()
    alert = useNewAssignmentAlert()
    alert.reset()
  })

  it('stays quiet on a student\'s first list — they have not missed anything yet', () => {
    alert.noteAssignments(STUDENT, WITH_NEW)
    expect(alert.hasNewAssignment.value).toBe(false)
  })

  it('raises the mark when an assignment appears after that', () => {
    alert.noteAssignments(STUDENT, EXISTING)
    alert.noteAssignments(STUDENT, WITH_NEW)
    expect(alert.hasNewAssignment.value).toBe(true)
  })

  it('stays quiet when the list has not changed', () => {
    alert.noteAssignments(STUDENT, EXISTING)
    alert.noteAssignments(STUDENT, EXISTING)
    expect(alert.hasNewAssignment.value).toBe(false)
  })

  it('ignores a closed assignment, however recently it was set', () => {
    alert.noteAssignments(STUDENT, EXISTING)
    alert.noteAssignments(STUDENT, [...EXISTING, mk('archived', '2026-08-14T16:28:16Z', '2026-08-15T00:00:00Z')])
    expect(alert.hasNewAssignment.value).toBe(false)
  })

  it('clears once the student is looking at the list, and stays clear', () => {
    alert.noteAssignments(STUDENT, EXISTING)
    alert.noteAssignments(STUDENT, WITH_NEW)
    expect(alert.hasNewAssignment.value).toBe(true)

    alert.markSeen(STUDENT, WITH_NEW)
    expect(alert.hasNewAssignment.value).toBe(false)

    alert.noteAssignments(STUDENT, WITH_NEW)
    expect(alert.hasNewAssignment.value).toBe(false)
  })

  it('survives a reload — the watermark is what persists, not the flag', () => {
    alert.noteAssignments(STUDENT, EXISTING)
    const fresh = useNewAssignmentAlert()
    fresh.reset()
    fresh.noteAssignments(STUDENT, WITH_NEW)
    expect(fresh.hasNewAssignment.value).toBe(true)
  })

  it('keeps a watermark per student, so one is not silenced by another', () => {
    alert.noteAssignments(STUDENT, EXISTING)
    alert.noteAssignments(OTHER, WITH_NEW)   // first list for OTHER — silent
    expect(alert.hasNewAssignment.value).toBe(false)

    alert.noteAssignments(STUDENT, WITH_NEW) // but STUDENT has seen only the older list
    expect(alert.hasNewAssignment.value).toBe(true)
  })

  it('never moves the watermark backwards', () => {
    alert.noteAssignments(STUDENT, WITH_NEW)
    alert.markSeen(STUDENT, WITH_NEW)
    alert.markSeen(STUDENT, EXISTING)        // a stale/partial fetch must not re-arm it
    alert.noteAssignments(STUDENT, WITH_NEW)
    expect(alert.hasNewAssignment.value).toBe(false)
  })

  it('does nothing without a user, and tolerates junk dates', () => {
    alert.noteAssignments(null, WITH_NEW)
    expect(alert.hasNewAssignment.value).toBe(false)
    alert.noteAssignments(STUDENT, [mk('x', 'not-a-date'), mk('y', null)])
    expect(alert.hasNewAssignment.value).toBe(false)
  })
})

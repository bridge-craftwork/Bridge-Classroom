import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// The stream handler is installed on an EventSource inside openStream(), so the
// test drives it the way the server does: stub EventSource, capture the instance,
// and hand it frames.
let instance = null
class FakeEventSource {
  constructor(url) {
    this.url = url
    this.onmessage = null
    this.onopen = null
    this.onerror = null
    instance = this
  }
  close() {}
  send(obj) {
    this.onmessage?.({ data: JSON.stringify(obj) })
  }
}

vi.mock('../../utils/apiFetch.js', () => ({
  apiFetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
  API_URL: 'http://test/api',
}))

let presence
beforeEach(async () => {
  vi.stubGlobal('EventSource', FakeEventSource)
  presence = (await import('../useFriendPresence.js')).useFriendPresence()
  presence.stop()
  presence.start('me')
})
afterEach(() => {
  presence.stop()
  vi.unstubAllGlobals()
})

const ids = () => presence.toasts.value.map((t) => t.id)

// Roadmap 2026-07-30 §4.1. Toast state is per-WINDOW but the server pushes per
// USER, so every window of the invitee pops a toast and only the window that
// answered dismisses it — leaving stale, un-actionable toasts on the rest. The
// server now emits a `resolved` event to the answering user's OWN connections.
describe('useFriendPresence — a resolved invite settles the toast in every window', () => {
  it('drops the invitation toast when the user answers elsewhere', () => {
    instance.send({ invitation: { id: 'i1', session_id: 's1', seat: 'N', from_name: 'David' } })
    expect(ids()).toEqual(['inv:i1'])

    instance.send({ invitation_resolved: { id: 'i1', outcome: 'accepted' } })
    expect(ids()).toEqual([])
  })

  it('drops the friend-request toast when the user answers elsewhere', () => {
    instance.send({ friend_request: { id: 'r1', from_name: 'David' } })
    expect(ids()).toEqual(['r1'])

    instance.send({ friend_request_resolved: { id: 'r1', outcome: 'declined' } })
    expect(ids()).toEqual([])
  })

  it('settles only the invitation named, leaving others actionable', () => {
    instance.send({ invitation: { id: 'i1', session_id: 's1', seat: 'N', from_name: 'David' } })
    instance.send({ invitation: { id: 'i2', session_id: 's2', seat: 'E', from_name: 'Ann' } })
    instance.send({ friend_request: { id: 'r1', from_name: 'Bob' } })
    expect(ids()).toEqual(['inv:i1', 'inv:i2', 'r1'])

    instance.send({ invitation_resolved: { id: 'i1', outcome: 'declined' } })
    expect(ids()).toEqual(['inv:i2', 'r1'])
  })

  // The window that DID the answering has already dismissed locally; it receives
  // the same broadcast, and must not throw or resurrect anything.
  it('is a no-op in the window that already dismissed', () => {
    instance.send({ invitation: { id: 'i1', session_id: 's1', seat: 'N', from_name: 'David' } })
    presence.dismissToast('inv:i1')
    expect(ids()).toEqual([])

    instance.send({ invitation_resolved: { id: 'i1', outcome: 'accepted' } })
    expect(ids()).toEqual([])
  })

  // A resolved frame must never be mistaken for a new invitation.
  it('never creates a toast from a resolved frame', () => {
    instance.send({ invitation_resolved: { id: 'ghost', outcome: 'accepted' } })
    instance.send({ friend_request_resolved: { id: 'ghost2', outcome: 'accepted' } })
    expect(ids()).toEqual([])
  })

  it('ignores a resolved frame with no id', () => {
    instance.send({ invitation: { id: 'i1', session_id: 's1', seat: 'N', from_name: 'David' } })
    instance.send({ invitation_resolved: { outcome: 'accepted' } })
    expect(ids()).toEqual(['inv:i1'])
  })
})

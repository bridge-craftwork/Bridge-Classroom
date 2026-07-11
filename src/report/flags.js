// Beetle flags. The bug icon + GitHub-issue path are public (all users). The
// LOCAL dev-sink path is gated behind a hand-inserted localStorage flag so only
// Rick + David see it — it protects nothing (a spoofer's "local" report writes to
// their own disk, no use to them, no harm to us), it just keeps the extra option
// out of normal users' way. In dev builds it's on by default.

const LOCAL_FLAG = 'bcLocalReports' // set to '1' in the browser to reveal the Local option
const SINK_KEY = 'bcBugSink' // remembered toggle choice: 'local' | 'issue'

export function localReportsEnabled() {
  try {
    return import.meta.env.DEV || localStorage.getItem(LOCAL_FLAG) === '1'
  } catch {
    return import.meta.env.DEV
  }
}

export function loadSink() {
  try {
    const s = localStorage.getItem(SINK_KEY)
    if (s === 'local' || s === 'issue') return s
  } catch { /* private mode */ }
  return import.meta.env.DEV ? 'local' : 'issue'
}

export function saveSink(sink) {
  try {
    localStorage.setItem(SINK_KEY, sink)
  } catch { /* private mode */ }
}

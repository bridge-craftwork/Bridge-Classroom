// GitHub sink (Slice 1) — the *issue* path, available to every user. POSTs the
// report to the backend, which commits the bundle to the private artifacts repo
// and files an issue there. Sanitization/consent are properties of THIS sink;
// the dev sink deliberately omits them.
//
// The screenshot goes as raw base64 (no data: prefix). Email is passed separately
// (issue body only) and never embedded in the committed context.

import { API_URL } from '@/utils/apiUrl.js'

const API_KEY = import.meta.env.VITE_API_KEY || ''

/**
 * @param {object} args
 * @param {object} args.context        context.json (env + note + display name; NO email)
 * @param {object} args.fixture        fixture.json (stub until Slice 3/4)
 * @param {Blob|null} args.screenshotBlob
 * @param {string} args.note
 * @param {'bug'|'feature'} [args.kind='bug']  bug report or feature request (title/label)
 * @param {string|null} args.reporterName   display name, or null when anonymous
 * @param {string|null} args.contactEmail   email for the issue body, or null
 * @returns {Promise<{ok:boolean, issueUrl?:string, issueNumber?:number, bundlePath?:string, reason?:string}>}
 */
export async function fileGithubIssue({ context, fixture, screenshotBlob, note, kind = 'bug', reporterName, contactEmail }) {
  try {
    const screenshot_base64 = screenshotBlob ? await blobToBase64(screenshotBlob) : null
    const resp = await fetch(`${API_URL}/bug-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify({
        note,
        kind,
        context,
        fixture,
        screenshot_base64,
        reporter_name: reporterName || null,
        contact_email: contactEmail || null
      })
    })
    if (resp.status === 503) return { ok: false, reason: 'not_configured' }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      return { ok: false, reason: text || `Server error ${resp.status}` }
    }
    const r = await resp.json()
    return { ok: true, issueUrl: r.issue_url, issueNumber: r.issue_number, bundlePath: r.bundle_path }
  } catch (err) {
    return { ok: false, reason: err.message || 'Network error' }
  }
}

/** Blob → base64 without the `data:...;base64,` prefix (what the backend expects). */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const s = String(reader.result)
      const comma = s.indexOf(',')
      resolve(comma >= 0 ? s.slice(comma + 1) : s)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

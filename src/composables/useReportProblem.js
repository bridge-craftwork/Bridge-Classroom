import { API_URL } from '@/utils/apiUrl.js'

const API_KEY = import.meta.env.VITE_API_KEY || ''
// Reports normally go to `${API_URL}/report`. VITE_REPORT_URL lets a local dev
// build send them elsewhere (e.g. a local helper that files the GitHub issue
// directly) without redirecting the rest of the API. Unset in production.
const REPORT_URL = import.meta.env.VITE_REPORT_URL || `${API_URL}/report`

/**
 * Submit a "Report a Problem" report to the backend, which files a
 * classroom-feedback GitHub issue in the content repo. The learner never sees
 * any GitHub plumbing — they just get a confirmation.
 *
 * @param {Object} report - The gathered lesson/board state plus the free-text note.
 * @returns {Promise<{ok: boolean, issueUrl?: string, issueNumber?: number, reason?: string}>}
 *   reason is 'not_configured' when the server has no GitHub token set, so the
 *   caller can degrade gracefully; otherwise a short error message.
 */
async function submitReport(report) {
  try {
    const response = await fetch(REPORT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY
      },
      body: JSON.stringify(report)
    })

    if (response.status === 503) {
      return { ok: false, reason: 'not_configured' }
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return { ok: false, reason: text || `Server error ${response.status}` }
    }

    const result = await response.json()
    return { ok: true, issueUrl: result.issue_url, issueNumber: result.issue_number }
  } catch (err) {
    return { ok: false, reason: err.message || 'Network error' }
  }
}

export function useReportProblem() {
  return { submitReport }
}

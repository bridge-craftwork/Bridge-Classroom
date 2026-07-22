/**
 * Student Progress Data Processing
 *
 * Pure functions extracted from the React StudentProgress prototype.
 * Framework-agnostic — used by Vue components for lesson-level
 * progress visualization with sparklines, mastery bars, and detail views.
 */

import { getTaxonomyEntryBySubfolder } from './bakerBridgeTaxonomy.js'

const ONE_HOUR = 3600000

/**
 * A lesson's identity in progress views is (collection_id, deal_subfolder) —
 * NOT skill_path. Two collections may reuse a subfolder name; the backend keeps
 * them distinct and every observation / board_status row carries collection_id,
 * so we key on the composite. Keep this the single source of the key format so
 * every producer/consumer agrees. Null collection (legacy / ad-hoc) → '' half.
 */
export function lessonKeyOf(collectionId, subfolder) {
  return `${collectionId || ''}::${subfolder || ''}`
}

/**
 * Board states from CORRECTNESS_AND_MASTERY.md §5.1. Returned by
 * classifyBoard, and matches the values stored on `board_status.status`.
 */
export const BOARD_STATES = [
  'clean_correct',
  'close_correct',
  'corrected',
  'failed',
  'not_attempted',
]

/**
 * Effective per-play verdict — `board_result` if present, otherwise
 * derived from the boolean `correct`. Returns 'correct' | 'corrected' |
 * 'failed'.
 */
function effectiveResult(a) {
  if (a.board_result === 'correct' || a.board_result === 'corrected' || a.board_result === 'failed') {
    return a.board_result
  }
  return a.correct ? 'correct' : 'failed'
}

/**
 * Annotate each attempt with the per-play status it would have produced
 * on `board_status` per CORRECTNESS_AND_MASTERY.md §5.1. The backend
 * computes this canonically at insert time; this frontend mirror is used
 * only by display-only metrics that don't want to round-trip to the
 * backend (e.g. lesson card recent accuracy — see §15).
 *
 * @param {Array} attempts - [{ts, correct, board_result}] in any order
 * @returns {Array<{ts, status: 'clean_correct'|'close_correct'|'corrected'|'failed'}>}
 *   in the same chronological order as the sorted attempts.
 */
export function perAttemptStatuses(attempts) {
  if (!attempts || attempts.length === 0) return []
  const sorted = [...attempts].sort((a, b) => a.ts - b.ts)
  let lastErrorTs = null
  return sorted.map(a => {
    const result = effectiveResult(a)
    let status
    if (result === 'failed') {
      status = 'failed'
      lastErrorTs = a.ts
    } else if (result === 'corrected') {
      status = 'corrected'
      lastErrorTs = a.ts
    } else {
      // 'correct' — clean vs close depends on the most recent error so far
      status = (lastErrorTs && (a.ts - lastErrorTs) < ONE_HOUR)
        ? 'close_correct'
        : 'clean_correct'
    }
    return { ts: a.ts, status }
  })
}

/**
 * Classify a board's current state per CORRECTNESS_AND_MASTERY.md §5.
 *
 * If an authoritative `board_status` entry is supplied, its `status` is
 * returned verbatim — the backend is the single source of truth.
 *
 * Otherwise this falls back to deriving state from raw attempts using
 * the same rules: failed/corrected come straight from the last play's
 * verdict; clean_correct vs close_correct is decided by whether the
 * most recent error happened within the cooldown window (1 hour).
 *
 * @param {Array} attempts - [{correct, board_result, ts}] in any order
 * @param {Object|null} [boardStatusEntry] - Authoritative API row
 * @returns {'clean_correct'|'close_correct'|'corrected'|'failed'|'not_attempted'}
 */
export function classifyBoard(attempts, boardStatusEntry = null) {
  if (boardStatusEntry && boardStatusEntry.status) {
    return boardStatusEntry.status
  }
  if (!attempts || attempts.length === 0) return 'not_attempted'

  const sorted = [...attempts].sort((a, b) => a.ts - b.ts)
  const last = sorted[sorted.length - 1]
  const lastResult = effectiveResult(last)

  if (lastResult === 'failed') return 'failed'
  if (lastResult === 'corrected') return 'corrected'

  const prevError = sorted.slice(0, -1).reverse()
    .find(a => effectiveResult(a) !== 'correct')
  if (!prevError) return 'clean_correct'
  return (last.ts - prevError.ts) < ONE_HOUR ? 'close_correct' : 'clean_correct'
}

/**
 * Process raw observation data into per-lesson summaries with sparkline data.
 *
 * When `boardStatusByPath` is supplied (skill_path → array of board_status
 * rows from `/api/board-status`), per-board state is read straight from
 * the backend. Otherwise it's derived locally from raw observations
 * using the same rules — the doc says backend is authoritative, so the
 * local path is a fallback for offline / pre-fetch render.
 *
 * Lessons are keyed by (collection_id, deal_subfolder) via lessonKeyOf — the
 * lesson's real identity. `lessonTotals` / `lessonNames` / `boardStatusByKey` /
 * `lessonTiers` are all keyed the same way.
 *
 * @param {Array} rawData - [{id, timestamp, correct, board_result, collection_id, deal_subfolder, deal_number}]
 * @param {Object} lessonTotals - {lessonKey: totalBoardCount}
 * @param {Object} lessonNames - {lessonKey: "Display Name"}
 * @param {Object} [boardStatusByKey] - {lessonKey: [{deal_number, status, ...}, ...]}
 * @param {Object} [lessonTiers] - {lessonKey: 'Exploring'|'Learning'|'Retaining'|'Mastering'}
 * @returns {Array} Lesson objects sorted by last activity desc
 */
export function processData(rawData, lessonTotals = {}, lessonNames = {}, boardStatusByKey = {}, lessonTiers = {}) {
  const byLesson = {}
  rawData.forEach(r => {
    const subfolder = r.deal_subfolder
    if (!subfolder) return
    const collectionId = r.collection_id || null
    const key = lessonKeyOf(collectionId, subfolder)
    if (!byLesson[key]) byLesson[key] = { collectionId, subfolder, deals: {} }
    const dn = r.deal_number
    if (!byLesson[key].deals[dn]) byLesson[key].deals[dn] = []
    byLesson[key].deals[dn].push({ correct: r.correct, ts: new Date(r.timestamp), board_result: r.board_result })
  })

  const lessons = Object.entries(byLesson).map(([key, { collectionId, subfolder, deals }]) => {
    const dealNums = Object.keys(deals).map(Number).sort((a, b) => a - b)

    // Index board_status entries by deal_number for this lesson
    const statusByDeal = {}
    for (const row of boardStatusByKey[key] || []) {
      statusByDeal[row.deal_number] = row
    }

    const stateCounts = {
      clean_correct: 0,
      close_correct: 0,
      corrected: 0,
      failed: 0,
    }
    const boardStates = {}
    dealNums.forEach(dn => {
      const state = classifyBoard(deals[dn], statusByDeal[dn])
      boardStates[dn] = state
      if (state !== 'not_attempted') stateCounts[state]++
    })
    const tried = dealNums.length

    const allAttempts = []
    dealNums.forEach(dn => {
      deals[dn].forEach(a => allAttempts.push({ ...a, dealNum: dn }))
    })
    allAttempts.sort((a, b) => a.ts - b.ts)

    const MIN_SPREAD = 2 * ONE_HOUR

    const boardLines = dealNums.map(dn => {
      const attempts = deals[dn].slice().sort((a, b) => a.ts - b.ts)
      const status = boardStates[dn]
      const lastCorrect = attempts[attempts.length - 1]?.correct ?? false

      const points = attempts.map((a, i) => {
        // Use board_result when available (preferred)
        if (a.board_result === 'corrected') return { ts: a.ts, y: 0.5, correct: a.correct }
        if (a.board_result === 'failed') return { ts: a.ts, y: 0.0, correct: false }

        if (a.correct) {
          const recentFail = attempts.slice(0, i)
            .reverse()
            .find(p => (p.board_result ? p.board_result !== 'correct' : !p.correct) && (a.ts - p.ts) < ONE_HOUR)
          return { ts: a.ts, y: recentFail ? 0.75 : 1.0, correct: true }
        } else {
          const nextSuccess = attempts.slice(i + 1)
            .find(p => p.correct && (p.ts - a.ts) < ONE_HOUR)
          return { ts: a.ts, y: nextSuccess ? 0.5 : 0.0, correct: false }
        }
      })

      // Spread tight clusters so points don't overlap on X
      const CLUSTER_GAP = 5 * 60 * 1000
      const spreadPts = points.map(p => ({ ...p, vts: p.ts.getTime(), rawTs: p.ts.getTime() }))
      let i = 0
      while (i < spreadPts.length) {
        let j = i
        while (j + 1 < spreadPts.length &&
               spreadPts[j + 1].vts - spreadPts[j].vts < CLUSTER_GAP) j++
        if (j > i) {
          const clusterSpan = spreadPts[j].vts - spreadPts[i].vts
          const targetSpan = Math.max(clusterSpan, MIN_SPREAD)
          const scale = clusterSpan > 0 ? targetSpan / clusterSpan : 1
          const base = spreadPts[i].vts
          for (let k = i; k <= j; k++) {
            spreadPts[k].vts = base + (spreadPts[k].vts - base) * scale
          }
        }
        i = j + 1
      }

      const entry = statusByDeal[dn]
      return {
        dealNum: dn,
        status,
        lastCorrect,
        points: spreadPts,
        // Per-board achievement state — populated when board_status is
        // available. See CORRECTNESS_AND_MASTERY.md §6 (stars) and §7
        // (paws). Consumers may render these as badges in detail views.
        maxStars: entry?.max_stars || 0,
        wildAchievement: entry?.wild_achievement || null,
      }
    })

    // Global time range based on real timestamps (rawTs)
    const allRawTs = boardLines.flatMap(bl => bl.points.map(p => p.rawTs))
    const tMin = allRawTs.length ? Math.min(...allRawTs) : 0
    const tMax = allRawTs.length ? Math.max(...allRawTs) : 1
    const tRange = tMax - tMin || 1

    // Normalize x to [0,1] using real timestamps
    boardLines.forEach(bl => {
      bl.points = bl.points.map(p => ({ ...p, x: (p.rawTs - tMin) / tRange }))
    })

    // Recent accuracy: clean_correct ratio over a recent window of
    // observations. Window is the past 7 days; if that contains fewer
    // than 10 observations, the window extends back in time until 10
    // are included (or the lesson runs out of observations). Per
    // CORRECTNESS_AND_MASTERY.md §15 — display-only metric, computed
    // frontend, not stored on the backend.
    const recentRate = (() => {
      const annotated = []
      for (const dn of dealNums) {
        for (const s of perAttemptStatuses(deals[dn])) annotated.push(s)
      }
      if (annotated.length === 0) return 0
      annotated.sort((a, b) => b.ts - a.ts)
      const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000
      const cutoffMs = Date.now() - SEVEN_DAYS
      let window = annotated.filter(s => s.ts.getTime() >= cutoffMs)
      if (window.length < 10) window = annotated.slice(0, 10)
      const cleanCount = window.filter(s => s.status === 'clean_correct').length
      return Math.round(cleanCount / window.length * 100)
    })()

    return {
      key,
      collectionId,
      subfolder,
      name: lessonNames[key] || subfolder,
      tried,
      stateCounts,
      tier: lessonTiers[key] || (tried > 0 ? 'Exploring' : null),
      totalBoards: lessonTotals[key] ?? tried,
      totalAttempts: allAttempts.length,
      recentRate,
      boardLines,
      firstActivity: allAttempts[0]?.ts,
      lastActivity: allAttempts[allAttempts.length - 1]?.ts,
    }
  })

  return lessons.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))
}

/**
 * Monotone cubic spline interpolation (Fritsch-Carlson).
 * Returns an SVG path string through the given [{px,py}] points.
 * @param {Array} pts - [{px, py}] pixel coordinates
 * @returns {string|null} SVG path d attribute
 */
export function monoCubicPath(pts) {
  const n = pts.length
  if (n === 1) return null
  if (n === 2) {
    return `M${pts[0].px.toFixed(1)},${pts[0].py.toFixed(1)} L${pts[1].px.toFixed(1)},${pts[1].py.toFixed(1)}`
  }

  const dx = [], dy = [], m = [], slope = []
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].px - pts[i].px
    dy[i] = pts[i + 1].py - pts[i].py
    slope[i] = dy[i] / dx[i]
  }
  m[0] = slope[0]
  m[n - 1] = slope[n - 2]
  for (let i = 1; i < n - 1; i++) {
    m[i] = (slope[i - 1] + slope[i]) / 2
  }
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(slope[i]) < 1e-10) { m[i] = m[i + 1] = 0; continue }
    const alpha = m[i] / slope[i]
    const beta = m[i + 1] / slope[i]
    const mag = alpha * alpha + beta * beta
    if (mag > 9) {
      const tau = 3 / Math.sqrt(mag)
      m[i] = tau * alpha * slope[i]
      m[i + 1] = tau * beta * slope[i]
    }
  }

  let d = `M${pts[0].px.toFixed(1)},${pts[0].py.toFixed(1)}`
  for (let i = 0; i < n - 1; i++) {
    const cx1 = pts[i].px + dx[i] / 3
    const cy1 = pts[i].py + m[i] * dx[i] / 3
    const cx2 = pts[i + 1].px - dx[i] / 3
    const cy2 = pts[i + 1].py - m[i + 1] * dx[i] / 3
    d += ` C${cx1.toFixed(1)},${cy1.toFixed(1)} ${cx2.toFixed(1)},${cy2.toFixed(1)} ${pts[i + 1].px.toFixed(1)},${pts[i + 1].py.toFixed(1)}`
  }
  return d
}

/**
 * Build lessonTotals and lessonNames from observations, keyed by lessonKeyOf
 * (collection_id, deal_subfolder). Name + board total come from the Baker Bridge
 * taxonomy looked up by subfolder (1:1 with skill_path); unknown subfolders
 * (e.g. ad-hoc PBNs) fall back to the raw subfolder name and observed count.
 * @param {Array} observations - Raw observation array
 * @returns {{lessonTotals: Object, lessonNames: Object}}
 */
export function buildLessonMeta(observations) {
  const lessonTotals = {}
  const lessonNames = {}
  for (const o of observations) {
    const subfolder = o.deal_subfolder
    if (!subfolder) continue
    const key = lessonKeyOf(o.collection_id, subfolder)
    if (key in lessonNames) continue
    const entry = getTaxonomyEntryBySubfolder(subfolder)
    if (entry) {
      lessonTotals[key] = entry.dealCount
      lessonNames[key] = entry.name
    } else {
      lessonNames[key] = subfolder
    }
  }
  return { lessonTotals, lessonNames }
}

/**
 * Board state → display color, per CORRECTNESS_AND_MASTERY.md §5.3 with the
 * §5.4 drilldown rule applied (corrected and close_correct render orange
 * unconditionally in history views; the yellow flavor only exists on
 * the live tile).
 */
export const STATUS_COLORS = {
  clean_correct: '#10b981',  // green
  close_correct: '#f59e0b',  // orange (drilldown)
  corrected:     '#f59e0b',  // orange (drilldown)
  failed:        '#f43f5e',  // red
  not_attempted: '#d1d5db',  // grey
}

/** Tier → swatch color used by the lesson card badge. */
export const TIER_COLORS = {
  Exploring: '#9ca3af',
  Learning:  '#3b82f6',
  Retaining: '#10b981',
  Mastering: '#d4a900',  // gold, mirrors the §6.4 gold-star badge
}

/** Attempt quality → dot color */
export function yColor(y) {
  if (y >= 0.9) return '#10b981'  // clean correct (green)
  if (y >= 0.6) return '#f59e0b'  // recent correct (orange) — correct after earlier fail
  if (y >= 0.4) return '#f59e0b'  // corrected (orange) — errors fixed within same board
  return '#f43f5e'                 // fail (red) — uncorrected
}

/**
 * Student Progress Data Processing
 *
 * Pure functions extracted from the React StudentProgress prototype.
 * Framework-agnostic — used by Vue components for lesson-level
 * progress visualization with sparklines, mastery bars, and detail views.
 */

import { getTaxonomyEntry } from './bakerBridgeTaxonomy.js'
import { getSkillFromPath } from './skillPath.js'

const ONE_HOUR = 3600000

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
 * @param {Array} rawData - [{id, timestamp, skill_path, correct, board_result, deal_subfolder, deal_number}]
 * @param {Object} lessonTotals - {skill_path: totalBoardCount}
 * @param {Object} lessonNames - {skill_path: "Display Name"}
 * @param {Object} [boardStatusByPath] - {skill_path: [{deal_number, status, ...}, ...]}
 * @param {Object} [lessonTiers] - {skill_path: 'Exploring'|'Learning'|'Retaining'|'Mastering'}
 * @returns {Array} Lesson objects sorted by last activity desc
 */
export function processData(rawData, lessonTotals = {}, lessonNames = {}, boardStatusByPath = {}, lessonTiers = {}) {
  const byLesson = {}
  rawData.forEach(r => {
    if (!byLesson[r.skill_path]) byLesson[r.skill_path] = {}
    const dn = r.deal_number
    if (!byLesson[r.skill_path][dn]) byLesson[r.skill_path][dn] = []
    byLesson[r.skill_path][dn].push({ correct: r.correct, ts: new Date(r.timestamp), board_result: r.board_result })
  })

  const lessons = Object.entries(byLesson).map(([path, deals]) => {
    const dealNums = Object.keys(deals).map(Number).sort((a, b) => a - b)

    // Index board_status entries by deal_number for this lesson
    const statusByDeal = {}
    for (const row of boardStatusByPath[path] || []) {
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

    // Recent accuracy: last 5 attempts per board, averaged
    const recentRate = (() => {
      const boardAttempts = Object.values(deals)
      if (boardAttempts.length === 0) return 0
      const totalCorrect = boardAttempts.reduce((sum, atts) => {
        const recent = atts.slice(-5)
        return sum + recent.filter(a => a.correct).length
      }, 0)
      const totalRecent = boardAttempts.reduce((sum, atts) => sum + Math.min(atts.length, 5), 0)
      return totalRecent > 0 ? Math.round(totalCorrect / totalRecent * 100) : 0
    })()

    return {
      path,
      name: lessonNames[path] || path.split('/').pop().replace(/_/g, ' '),
      tried,
      stateCounts,
      tier: lessonTiers[path] || (tried > 0 ? 'Exploring' : null),
      totalBoards: lessonTotals[path] ?? tried,
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
 * Build lessonTotals and lessonNames from observations using the Baker Bridge taxonomy.
 * Replaces the React component's explicit props with automatic lookup.
 * @param {Array} observations - Raw observation array
 * @returns {{lessonTotals: Object, lessonNames: Object}}
 */
export function buildLessonMeta(observations) {
  const paths = new Set(observations.map(o => o.skill_path).filter(Boolean))
  const lessonTotals = {}
  const lessonNames = {}
  for (const path of paths) {
    const entry = getTaxonomyEntry(path)
    if (entry) {
      lessonTotals[path] = entry.dealCount
      lessonNames[path] = entry.name
    } else {
      const info = getSkillFromPath(path)
      lessonNames[path] = info.name
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

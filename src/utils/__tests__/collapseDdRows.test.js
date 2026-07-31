import { describe, it, expect } from 'vitest'
import { buildDdRows, collapseDdRows } from '../handAnalysis.js'

const rowsOf = (dd, fc = { contract: '', declarer: null }) => collapseDdRows(buildDdRows(dd, fc))
const seats = (rows) => rows.map(r => r.seat)

describe('collapseDdRows — one row per partnership when the pair agrees', () => {
  // Every seat sees the same tricks in every strain → both pairs collapse.
  it('merges N+S and E+W when each pair matches', () => {
    const rows = rowsOf('7'.repeat(20))
    expect(seats(rows)).toEqual(['NS', 'EW'])
    expect(rows[0].cells).toHaveLength(5)
  })

  // Lossless: a pair that DISAGREES stays split, because that difference is the
  // interesting part.
  it('keeps all four rows when a pair disagrees', () => {
    // N row (cells 0-4) differs from S row (cells 5-9); E and W match.
    const dd = '12345' + '54321' + '77777' + '77777'
    expect(seats(rowsOf(dd))).toEqual(['N', 'S', 'EW'])
  })

  it('collapses only the agreeing side', () => {
    const dd = '77777' + '77777' + '12345' + '54321'
    expect(seats(rowsOf(dd))).toEqual(['NS', 'E', 'W'])
  })

  it('merges nothing when neither pair agrees', () => {
    const dd = '12345' + '54321' + '13579' + '97531'
    expect(seats(rowsOf(dd))).toEqual(['N', 'S', 'E', 'W'])
  })

  // The contract highlight must survive the merge, or the merged view silently loses
  // the one cell the reader is looking for.
  it('carries the contract cell through a merge', () => {
    const rows = rowsOf('7'.repeat(20), { contract: '3NT', declarer: 'N' })
    const ns = rows.find(r => r.seat === 'NS')
    expect(ns.cells.some(c => c.isContract)).toBe(true)
  })

  it('passes null through untouched', () => {
    expect(collapseDdRows(null)).toBeNull()
    expect(collapseDdRows(buildDdRows('123', {}))).toBeNull()
  })
})

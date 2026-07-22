/**
 * Tests for AccomplishmentsView and useAccomplishments
 *
 * Run with: npm test -- AccomplishmentsView
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useAccomplishments } from '../../composables/useAccomplishments.js'
import {
  generateTestObservations,
  generateTaxonFocusedObservations,
  generateEmptyObservations
} from '../../utils/accomplishmentsTestData.js'

describe('useAccomplishments', () => {
  let accomplishments

  beforeEach(() => {
    accomplishments = useAccomplishments()
    accomplishments.reset()
  })

  describe('test mode', () => {
    it('should enable test mode with test data', () => {
      const testData = generateTestObservations(10)
      accomplishments.enableTestMode(testData)

      expect(accomplishments.useTestData.value).toBe(true)
      expect(accomplishments.testObservations.value.length).toBe(10)
    })

    it('should disable test mode', () => {
      const testData = generateTestObservations(10)
      accomplishments.enableTestMode(testData)
      accomplishments.disableTestMode()

      expect(accomplishments.useTestData.value).toBe(false)
      expect(accomplishments.testObservations.value.length).toBe(0)
    })
  })

  // Note: per-lesson / overall observation aggregates were removed — the
  // Lessons tab now reads the board-status rollup (AccomplishmentsView
  // .lessonMasteryList). The Taxons tab remains observation-derived until a
  // taxon-level server rollup exists, so taxonStats is still covered here.

  describe('taxon stats', () => {
    it('should group observations by skill path', () => {
      const testData = generateTaxonFocusedObservations()
      accomplishments.enableTestMode(testData)

      const stats = accomplishments.taxonStats.value
      expect(stats.length).toBeGreaterThan(0)

      // Each stat should have required properties
      for (const stat of stats) {
        expect(stat).toHaveProperty('skillPath')
        expect(stat).toHaveProperty('category')
        expect(stat).toHaveProperty('categoryName')
        expect(stat).toHaveProperty('skillName')
        expect(stat).toHaveProperty('total')
        expect(stat).toHaveProperty('correct')
        expect(stat).toHaveProperty('incorrect')
        expect(stat).toHaveProperty('successRate')
      }
    })

    it('should parse category from skill path', () => {
      const testData = [
        { skill_path: 'bidding_conventions/stayman', correct: true },
        { skill_path: 'bidding_conventions/jacoby', correct: false },
        { skill_path: 'opening_bids/one_notrump', correct: true }
      ]
      accomplishments.enableTestMode(testData)

      const stats = accomplishments.taxonStats.value

      // Should have stats for both skill paths
      const staymanStats = stats.find(s => s.skillPath === 'bidding_conventions/stayman')
      expect(staymanStats).toBeDefined()
      expect(staymanStats.category).toBe('bidding_conventions')
      expect(staymanStats.categoryName).toBe('Bidding Conventions')
    })
  })

  describe('filtering', () => {
    it('should filter taxons to only items with observations when enabled', () => {
      const testData = generateTestObservations(50)
      accomplishments.enableTestMode(testData)
      accomplishments.onlyWithObservations.value = true

      const filtered = accomplishments.filteredTaxonStats.value
      for (const stat of filtered) {
        expect(stat.total).toBeGreaterThan(0)
      }
    })
  })

  describe('overall stats', () => {
    it('should report hasData true with observations, false when empty', () => {
      accomplishments.enableTestMode(generateTestObservations(5))
      expect(accomplishments.hasData.value).toBe(true)

      accomplishments.enableTestMode(generateEmptyObservations())
      expect(accomplishments.hasData.value).toBe(false)
    })
  })

  describe('formatLessonName', () => {
    it('should format lesson names correctly', () => {
      expect(accomplishments.formatLessonName('Stayman')).toBe('Stayman')
      expect(accomplishments.formatLessonName('2over1')).toBe('2 Over1')
      expect(accomplishments.formatLessonName('weak_twos')).toBe('Weak Twos')
      expect(accomplishments.formatLessonName('Jacoby_Transfer')).toBe('Jacoby Transfer')
    })

    it('should handle null/undefined', () => {
      expect(accomplishments.formatLessonName(null)).toBe('Unknown')
      expect(accomplishments.formatLessonName(undefined)).toBe('Unknown')
    })
  })
})

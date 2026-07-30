import { describe, it, expect } from 'vitest'
import { deriveReportableDeal, REPO_TO_COLLECTION } from '../reportableDeal.js'

const scenario = (over = {}) => ({
  items: [{ kind: 'scenario', repo: 'pbs', file: 'Stayman', label: 'Stayman', ...over }],
})

// Roadmap 2026-07-30 §5.2. The whole point of this gate is that being WRONG is
// expensive in a quiet way: POST /api/report falls back to the Bridge-Classroom
// (app) repo when `collection` is absent, so a button shown on a non-content deal
// files bridge-content complaints into the app repo, at volume, where nobody is
// looking for them. Every "returns null" case below is that failure mode.
describe('deriveReportableDeal — only repository-backed deals are reportable', () => {
  it('accepts a single scenario ref with a mappable repo and a board', () => {
    expect(deriveReportableDeal(scenario(), 3)).toEqual({
      collection: 'pbs-coaching',
      file: 'Stayman',
      label: 'Stayman',
      board: 3,
    })
  })

  it('refuses a random deal', () => {
    expect(deriveReportableDeal({ items: [{ kind: 'random' }] }, 3)).toBeNull()
  })

  it('refuses a pasted PBN', () => {
    expect(deriveReportableDeal({ items: [{ kind: 'pbn', text: '[Board "1"]' }] }, 3)).toBeNull()
  })

  it('refuses library and club sources — real deals, but nobody authored them', () => {
    expect(deriveReportableDeal({ items: [{ kind: 'library', entryId: 'e1' }] }, 3)).toBeNull()
    expect(deriveReportableDeal({ items: [{ kind: 'clubgame', gameId: 'g1' }] }, 3)).toBeNull()
    expect(deriveReportableDeal({ items: [{ kind: 'clubboard', gameId: 'g1' }] }, 3)).toBeNull()
  })

  it('refuses a dealer script — its output is generated, not written', () => {
    expect(deriveReportableDeal({ items: [{ kind: 'script', repo: 'pbs', file: 'x' }] }, 3)).toBeNull()
  })

  // A mixed pool has no single owner: "one of these twelve boards, from three
  // repos" is not actionable by any one maintainer.
  it('refuses a multi-item pool even when every item is reportable', () => {
    const two = {
      items: [
        { kind: 'scenario', repo: 'pbs', file: 'Stayman' },
        { kind: 'scenario', repo: 'pbs', file: 'Transfers' },
      ],
    }
    expect(deriveReportableDeal(two, 3)).toBeNull()
  })

  it('refuses an unknown repo rather than guessing a collection', () => {
    expect(deriveReportableDeal(scenario({ repo: 'not-a-repo' }), 3)).toBeNull()
    expect(deriveReportableDeal(scenario({ repo: undefined }), 3)).toBeNull()
  })

  it('refuses when there is no board identity to point at', () => {
    expect(deriveReportableDeal(scenario(), null)).toBeNull()
    expect(deriveReportableDeal(scenario(), undefined)).toBeNull()
    expect(deriveReportableDeal(scenario(), '')).toBeNull()
  })

  // Board 0 is a real board number in some sets; it must not be swallowed by a
  // truthiness check.
  it('accepts board 0', () => {
    expect(deriveReportableDeal(scenario(), 0)?.board).toBe(0)
  })

  it('survives an absent or empty selection (a guest on a served table)', () => {
    expect(deriveReportableDeal(null, 3)).toBeNull()
    expect(deriveReportableDeal(undefined, 3)).toBeNull()
    expect(deriveReportableDeal({}, 3)).toBeNull()
    expect(deriveReportableDeal({ items: [] }, 3)).toBeNull()
  })

  // The map must agree with route_for_collection in the API, or reports land in
  // the fallback repo. Pin the known-good pair.
  it('maps pbs → pbs-coaching', () => {
    expect(REPO_TO_COLLECTION.pbs).toBe('pbs-coaching')
  })
})

// Guard the B-series fixtures against the two errors that actually occurred while
// authoring them (2026-07-29): a duplicated card across two hands (♦5 in both North
// and East) and a hand one card short. Both render as plausible-looking bridge, so
// nothing catches them by eye — and a scene walked for LAYOUT review is exactly where
// a wrong deal would go unnoticed for months.
//
// Deliberately NOT asserted: that partial (mid-play) hands total 13. They shouldn't —
// cards already played are gone. The invariant that survives both cases is: whatever
// cards a fixture DOES name must be unique, and a fully-revealed deal must be complete.
import { describe, it, expect } from 'vitest'

const modules = import.meta.glob('../fixtures-b/*.js', { eager: true })
const fixtures = Object.entries(modules).map(([p, m]) => [p.match(/\/([^/]+)\.js$/)[1], m.default])

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs']
const RANKS = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2']

describe('fixtures-b', () => {
  it('registers every B surface the scene router can dispatch', () => {
    expect(fixtures.length).toBeGreaterThan(0)
    for (const [name, f] of fixtures) {
      expect(['b1', 'b2', 'b3'], `${name}.surface`).toContain(f.surface)
      expect(f.label, `${name}.label`).toBeTruthy()
    }
  })

  for (const [name, f] of fixtures) {
    describe(name, () => {
      it('names no card twice', () => {
        const seen = new Map()
        for (const seat of ['N', 'E', 'S', 'W']) {
          for (const suit of SUITS) {
            for (const rank of f.hands?.[seat]?.[suit] || []) {
              expect(RANKS, `${seat} ${suit} ${rank}`).toContain(rank)
              const card = `${suit}:${rank}`
              expect(seen.has(card), `${card} in both ${seen.get(card)} and ${seat}`).toBe(false)
              seen.set(card, seat)
            }
          }
        }
      })

      it('deals 13 to every seat when the hands are fully revealed', () => {
        // A reveal is a fixture that hides nothing — review states. Mid-play hands are
        // legitimately short, and hidden seats are legitimately empty.
        if (f.hiddenSeats?.length !== 0) return
        for (const seat of ['N', 'E', 'S', 'W']) {
          const n = SUITS.reduce((sum, s) => sum + (f.hands?.[seat]?.[s]?.length || 0), 0)
          expect(n, `${seat} holds ${n}`).toBe(13)
        }
      })

      it('has a double-dummy string that is well-formed and complements to 13', () => {
        if (!f.ddtricks) return
        expect(f.ddtricks, 'ddtricks length').toHaveLength(20)
        // Seat [N,S,E,W] × strain [NT,S,H,D,C]; NS and EW split 13 tricks per strain.
        const val = (c) => (c >= '0' && c <= '9' ? +c : 10 + c.charCodeAt(0) - 'a'.charCodeAt(0))
        for (let strain = 0; strain < 5; strain++) {
          const ns = val(f.ddtricks[strain]) + val(f.ddtricks[5 + strain])
          const ew = val(f.ddtricks[10 + strain]) + val(f.ddtricks[15 + strain])
          // N and S see the same count, as do E and W — so one side's pair is 2×.
          expect(val(f.ddtricks[strain]), `strain ${strain}: N vs S`).toBe(val(f.ddtricks[5 + strain]))
          expect(val(f.ddtricks[10 + strain]), `strain ${strain}: E vs W`).toBe(val(f.ddtricks[15 + strain]))
          expect(ns / 2 + ew / 2, `strain ${strain}: NS+EW`).toBe(13)
        }
      })
    })
  }
})

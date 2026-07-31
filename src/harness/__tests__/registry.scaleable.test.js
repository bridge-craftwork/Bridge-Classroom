import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { COMPONENTS, SCALEABLE } from '../registry.js'

// SCALEABLE is a DECLARATION, and declarations rot. This is the check that keeps it
// honest — and it is not hypothetical: DoubleDummyTable is table content that would
// have been declared scaleable by anyone who looked at it, while its CSS was fixed px
// and the arranger's computed scale went straight in the bin (2026-07-30).
//
// A source-level assertion rather than a rendered one on purpose: jsdom/happy-dom do
// no layout, so mounting at two scales and comparing sizes would compare 0 to 0 — the
// exact "probe that reads undefined vs undefined" trap. Reading the stylesheet asks a
// question the environment can actually answer.
const ROOT = path.resolve(__dirname, '../../..')

function sourceOf(name) {
  for (const rel of [`src/components/${name}.vue`, `src/components/table/${name}.vue`]) {
    const abs = path.join(ROOT, rel)
    if (fs.existsSync(abs)) return fs.readFileSync(abs, 'utf8')
  }
  throw new Error(`no .vue found for ${name}`)
}

describe('SCALEABLE matches what the components actually do', () => {
  it('every declared name is a real registered component', () => {
    for (const name of SCALEABLE) expect(Object.keys(COMPONENTS)).toContain(name)
  })

  it('every component declared scaleable really consumes var(--table-scale)', () => {
    const liars = SCALEABLE.filter((n) => !sourceOf(n).includes('var(--table-scale)'))
    expect(liars, `declared scaleable but never reads the var: ${liars.join(', ')}`).toEqual([])
  })

  it('no component consumes the var while declared fixed', () => {
    const undeclared = Object.keys(COMPONENTS)
      .filter((n) => !SCALEABLE.includes(n))
      .filter((n) => sourceOf(n).includes('var(--table-scale)'))
    expect(undeclared, `reads --table-scale but is not in SCALEABLE: ${undeclared.join(', ')}`).toEqual([])
  })
})

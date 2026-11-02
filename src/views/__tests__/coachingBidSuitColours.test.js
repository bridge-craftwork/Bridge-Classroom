import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { formatBid } from '../../utils/cardFormatting.js'

// A source-level check, as in registry.scaleable.test.js: happy-dom does not apply
// the stylesheet, so a rendered check could not see the colour. What can break is
// the pairing between the class formatBid emits and the rule MainLayout styles.
const css = fs.readFileSync(path.resolve(__dirname, '../MainLayout.vue'), 'utf8')

describe('coaching bid labels (bidLabel → formatBid)', () => {
  it.each([
    ['1D', 'red'],
    ['2H', 'red'],
    ['2C', 'black'],
    ['4S', 'black'],
  ])('%s carries a class the coaching prose colours', (bid, cls) => {
    expect(formatBid(bid).html).toContain(`<span class="${cls}">`)
    expect(css).toMatch(new RegExp(`\\.narrative-text \\.${cls} \\{\\s*color:`))
  })
})

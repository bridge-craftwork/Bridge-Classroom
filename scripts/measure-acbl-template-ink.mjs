#!/usr/bin/env node
// Measure where the ACBL convention card templates carry printed ink, and
// write it to src/utils/acblTemplateInk.js.
//
// The PDF export grows a text field into free space when its value needs
// more room (acblClassicFillPdf.js, applyTypography). It can see the other
// form fields, but the card's printed words, checkbox squares and rules
// are page art it cannot see, so a grown field used to spread over them.
// This records that art as rectangles the growth code treats as obstacles.
//
// Method: rasterise each page of the BLANK template at 150 dpi (grey) and
// take every pixel darker than INK_LEVEL as ink. Then, in two passes:
//
// 1. Rules. Any straight run of ink at least RULE_MIN_PX long is a rule,
//    not lettering, and is lifted out first. The card's rules and borders
//    form one connected grid that spans the page, so leaving them in would
//    merge everything into a single page-sized blob. Horizontal rules
//    thicker than HAIRLINE_PX (the heavy section borders) are recorded as
//    ink. Thinner ones are the underlines values are written on; they are
//    recorded too, flagged, because a field may sit on its OWN underline
//    but must not grow across another row's (that reads as a
//    strike-through). Vertical rules are dropped: fields only ever grow up
//    or down, so a column divider never blocks.
// 2. Lettering. The remaining ink is grouped into connected blobs (words,
//    symbols, checkbox squares), and blobs on one text line are merged into
//    word-level boxes to keep the table small.
//
// Needs `pdftoppm` (poppler). Re-run whenever a template is revised:
//   node scripts/measure-acbl-template-ink.mjs

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PDFDocument } from 'pdf-lib'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const TEMPLATES = {
  classic: 'public/templates/acbl-classic-2023.pdf',
  new: 'public/templates/acbl-new.pdf',
}
const OUT = path.join(ROOT, 'src/utils/acblTemplateInk.js')

const DPI = 150
const SCALE = DPI / 72 // pixels per PDF point
// Grey level below which a pixel is ink. High enough to catch the card's
// red and light-blue print (luminance ~76 and ~130), not just black.
const INK_LEVEL = 200
// Blobs this tall or less are rules a value is written ON (underlines),
// not obstacles. 2 px at 150 dpi is ~1pt; the card's hairlines are 1 px.
const HAIRLINE_PX = 2
// A straight run of ink this long (~19pt) is a rule, not lettering.
const RULE_MIN_PX = 40
// Blobs on one line merge when this close horizontally (~2pt).
const MERGE_GAP_PX = 4

function readPgm(file) {
  const buf = fs.readFileSync(file)
  // P5 <w> <h> <max>\n<binary>
  let pos = 0
  const tokens = []
  while (tokens.length < 4) {
    while (/\s/.test(String.fromCharCode(buf[pos]))) pos++
    if (buf[pos] === 0x23) { while (buf[pos] !== 0x0a) pos++; continue } // comment
    let t = ''
    while (!/\s/.test(String.fromCharCode(buf[pos]))) t += String.fromCharCode(buf[pos++])
    tokens.push(t)
  }
  pos++ // single whitespace after maxval
  const [magic, w, h] = tokens
  if (magic !== 'P5') throw new Error(`${file}: expected binary PGM, got ${magic}`)
  return { w: +w, h: +h, px: buf.subarray(pos) }
}

/**
 * Lift straight rules out of the image (painting them white) and return
 * the heavy horizontal ones as pixel boxes. See the method note above.
 */
function liftRules(img) {
  const { w, h, px } = img
  const ink = (x, y) => px[y * w + x] < INK_LEVEL
  const horizontal = [] // [y, x0, x1] runs
  const vertical = []   // [x, y0, y1] runs
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w;) {
      if (!ink(x, y)) { x++; continue }
      let e = x
      while (e + 1 < w && ink(e + 1, y)) e++
      if (e - x + 1 >= RULE_MIN_PX) horizontal.push([y, x, e])
      x = e + 1
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h;) {
      if (!ink(x, y)) { y++; continue }
      let e = y
      while (e + 1 < h && ink(x, e + 1)) e++
      if (e - y + 1 >= RULE_MIN_PX) vertical.push([x, y, e])
      y = e + 1
    }
  }
  // Stack horizontal runs on consecutive rows into bands; a band thicker
  // than a hairline is a heavy rule and stays as an obstacle.
  const bands = []
  for (const [y, x0, x1] of horizontal) {
    const band = bands.find(b => b.y1 === y - 1 && x0 <= b.x1 && x1 >= b.x0)
    if (band) { band.y1 = y; band.x0 = Math.min(band.x0, x0); band.x1 = Math.max(band.x1, x1) }
    else bands.push({ x0, x1, y0: y, y1: y })
  }
  for (const [y, x0, x1] of horizontal) px.fill(255, y * w + x0, y * w + x1 + 1)
  for (const [x, y0, y1] of vertical) for (let y = y0; y <= y1; y++) px[y * w + x] = 255
  return bands.map(b => ({ ...b, underline: b.y1 - b.y0 + 1 <= HAIRLINE_PX }))
}

/** Connected blobs of ink (8-connected), as pixel bounding boxes. */
function inkBlobs({ w, h, px }) {
  const label = new Int32Array(w * h).fill(-1)
  const blobs = []
  const stack = []
  for (let i = 0; i < w * h; i++) {
    if (px[i] >= INK_LEVEL || label[i] !== -1) continue
    const b = { x0: w, y0: h, x1: -1, y1: -1 }
    label[i] = blobs.length
    stack.push(i)
    while (stack.length) {
      const j = stack.pop()
      const x = j % w, y = (j - x) / w
      if (x < b.x0) b.x0 = x
      if (x > b.x1) b.x1 = x
      if (y < b.y0) b.y0 = y
      if (y > b.y1) b.y1 = y
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const k = ny * w + nx
          if (px[k] < INK_LEVEL && label[k] === -1) { label[k] = blobs.length; stack.push(k) }
        }
      }
    }
    blobs.push(b)
  }
  return blobs
}

/** Merge blobs that share a text line and nearly touch. */
function mergeOnLines(blobs) {
  let boxes = blobs.map(b => ({ ...b }))
  let merged = true
  while (merged) {
    merged = false
    boxes.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
    const out = []
    for (const b of boxes) {
      const hit = out.find(o => {
        const vOverlap = Math.min(o.y1, b.y1) - Math.max(o.y0, b.y0) + 1
        const minH = Math.min(o.y1 - o.y0, b.y1 - b.y0) + 1
        const hGap = Math.max(o.x0, b.x0) - Math.min(o.x1, b.x1) - 1
        return vOverlap >= minH * 0.5 && hGap <= MERGE_GAP_PX
      })
      if (hit) {
        hit.x0 = Math.min(hit.x0, b.x0); hit.y0 = Math.min(hit.y0, b.y0)
        hit.x1 = Math.max(hit.x1, b.x1); hit.y1 = Math.max(hit.y1, b.y1)
        merged = true
      } else {
        out.push(b)
      }
    }
    boxes = out
  }
  return boxes
}

const round = (v) => Math.round(v * 10) / 10

async function measure(name, rel) {
  const file = path.join(ROOT, rel)
  const pdf = await PDFDocument.load(fs.readFileSync(file))
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acbl-ink-'))
  const rects = []
  pdf.getPages().forEach((page, p) => {
    const { height: pageH } = page.getMediaBox()
    const base = path.join(tmp, `p${p}`)
    execFileSync('pdftoppm', ['-r', String(DPI), '-gray', '-f', String(p + 1), '-l', String(p + 1),
      '-singlefile', file, base], { stdio: ['ignore', 'ignore', 'ignore'] })
    const img = readPgm(`${base}.pgm`)
    const rules = liftRules(img)
    const blobs = inkBlobs(img).filter(b => b.y1 - b.y0 + 1 > HAIRLINE_PX)
    for (const b of [...rules, ...mergeOnLines(blobs)]) {
      // Pixel box → PDF points, origin bottom-left.
      const x = b.x0 / SCALE
      const w = (b.x1 + 1 - b.x0) / SCALE
      const top = pageH - b.y0 / SCALE
      const bottom = pageH - (b.y1 + 1) / SCALE
      const rect = [p, round(x), round(bottom), round(w), round(top - bottom)]
      if (b.underline) rect.push(1)
      rects.push(rect)
    }
  })
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log(`${name}: ${rects.length} ink rectangles`)
  return rects
}

const result = {}
for (const [name, rel] of Object.entries(TEMPLATES)) result[name] = await measure(name, rel)

const body = Object.entries(result).map(([name, rects]) =>
  `  ${name}: [\n${rects.map(r => `    [${r.join(', ')}],`).join('\n')}\n  ],`).join('\n')

fs.writeFileSync(OUT, `// GENERATED by scripts/measure-acbl-template-ink.mjs — do not edit by hand.
// Re-run that script if an ACBL template is revised.
//
// Printed ink on each blank ACBL template, as [page, x, y, width, height]
// in PDF points (origin bottom-left), with a trailing 1 on the thin
// underlines values are written on. The PDF export treats all of it as
// obstacles, so a text field never grows over the card's printed words,
// checkboxes, rules, or another row's underline; a field's own underline
// is exempt.
export const TEMPLATE_INK = {
${body}
}
`)
console.log(`wrote ${path.relative(ROOT, OUT)}`)

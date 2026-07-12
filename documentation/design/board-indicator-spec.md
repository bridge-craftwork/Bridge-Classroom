# BoardIndicator component specification

**Status:** Draft for implementation
**Date:** 2026-07-11
**Origin:** Design session (claude.ai) replacing the earlier CC-generated session info graphic

## 1. Purpose

`BoardIndicator` is a compact, self-contained SVG graphic that communicates three facts about the current board at a glance: board number, dealer seat, and vulnerability. It renders as a truncated pyramid ("cut-off pyramid") viewed from directly above: a raised center plateau carrying the board number, surrounded by four sloped bevel faces whose colors encode vulnerability and one of which carries the dealer letter.

It is a pure presentational component: no state, no events, output fully determined by props.

## 2. Visual model

The 3D illusion is produced entirely by **per-face shading under a single implied light source at the upper left**. Each of the four trapezoidal faces uses a different shade of its base color: top face lightest, left face light-mid, right face dark-mid, bottom face darkest. The mitered diagonal seams at the corners fall out of the polygon geometry.

All corners are sharp (no rounding anywhere).

### Design decisions and rationale (do not revisit without cause)

1. **Flat, uniform-color elements must not touch the pyramid.** A uniform ring pressed flush against four differently-shaded faces contradicts the lighting model and flattens the whole render. Any annotation layer (the flag border) therefore floats with an air gap.
2. **The dealer letter is upright and undistorted.** Foreshortening/projecting the D onto the sloped face was tried and rejected: the compression flips the ambiguous pyramid/well percept and makes the center read as *recessed*. The D is a label read by an upright human, not a texture on the surface.
3. **Dealer is marked by a large D on the dealer's face**, not by a floating badge. The D is co-equal information with the board number and is sized accordingly.
4. **Vulnerability is carried by face color alone**: red = vulnerable, ivory = not vulnerable, matching physical board convention (N/S faces = NS, E/W faces = EW).

## 3. Props

| Prop | Type | Required | Default | Notes |
|---|---|---|---|---|
| `boardNumber` | integer ≥ 1 | yes | — | Dealer and vulnerability are derived from it (§4) unless overridden below |
| `size` | number (px) | no | `130` | Edge length **S** of the pyramid footprint, excluding the border slot |
| `borderColor` | CSS color string | no | `'transparent'` | Flag border color (§7). The border slot is always reserved |
| `dealer` | `'N'`\|`'E'`\|`'S'`\|`'W'` | no | `null` | Overrides the derived dealer (§4). For non-standard boards |
| `vulnerable` | `'None'`\|`'NS'`\|`'EW'`\|`'All'` | no | `null` | Overrides the derived vulnerability (§4). For non-standard boards |

Recommended minimum `size`: 48 px. Below that, seam strokes may be dropped (§9).

## 4. Derivation of dealer and vulnerability

Standard duplicate 16-board cycle. Let `n = boardNumber`, `i = (n - 1) % 16`.

- **Dealer:** `i % 4` → `0=N, 1=E, 2=S, 3=W`
- **Vulnerability:** `(i + floor(i / 4)) % 4` → `0=None, 1=NS, 2=EW, 3=All`

Sanity checks: board 1 → dealer N, none vul. Board 2 → E, NS. Board 8 → W, none. Board 16 → W, EW.

Red faces per vulnerability: `None` = {}, `NS` = {top, bottom}, `EW` = {left, right}, `All` = all four. All non-red faces are ivory.

**Overrides for non-standard boards.** The 16-cycle derivation is the *default*, not a constraint. Practice deals and imported boards frequently carry their own dealer and vulnerability that don't follow the duplicate cycle (e.g. a deal labelled "board 7" dealt by North with NS vul, which the cycle would otherwise render as dealer S / all vulnerable). The `dealer` and `vulnerable` props override the corresponding derived value; each is independent, so a board can override just one. Prop values are matched case-insensitively; `vulnerable` also accepts the aliases `Love`/`-` (→ None) and `Both` (→ All). An unrecognised value is ignored and the derived value is used, so a bad prop never renders a wrong-but-plausible board. The board number still shows verbatim regardless of overrides.

## 5. Geometry

All coordinates in a local space where the pyramid footprint spans `(0,0)` to `(S,S)`. Bevel depth `b = 0.23 · S` (30 px at S = 130).

| Element | Definition |
|---|---|
| Top face | polygon `(0,0) (S,0) (S−b,b) (b,b)` |
| Right face | polygon `(S,0) (S,S) (S−b,S−b) (S−b,b)` |
| Bottom face | polygon `(0,S) (S,S) (S−b,S−b) (b,S−b)` |
| Left face | polygon `(0,0) (b,b) (b,S−b) (0,S)` |
| Plateau | rect `(b, b)`, width/height `S − 2b` |

Draw order: four faces, then plateau, then plateau number, then dealer D, with the border rect (§7) drawn first (bottom of the stack).

## 6. Color and typography

### Face shades

| Face | Vulnerable (red) | Not vulnerable (ivory) |
|---|---|---|
| Top | `#DA5A50` | `#FFFFFF` |
| Left | `#C64840` | `#F0ECE1` |
| Right | `#A6332B` | `#DBD5C7` |
| Bottom | `#8A2822` | `#C2BCAB` |
| Seam stroke | `#7A201B` | `#ABA595` |

Seam stroke width: `max(0.5, 0.004 · S)` px, applied per polygon.

These are fixed hex values by design — the graphic depicts a physical object and must not invert in dark mode. If a dark-theme variant is ever needed, it gets its own explicit palette; do not route these through theme tokens.

### Plateau and board number

- Plateau fill `#FBFAF5`, stroke `#9B9588` at `max(1, 0.008 · S)` px.
- Number: fill `#222018`, weight 500, `text-anchor: middle`, font size `0.28 · S` for 1–2 digits. For 3+ digits, shrink to `0.22 · S`.
- Position: `x = 0.5 · S`, baseline `y = 0.5 · S + 0.35 · fontSize`.
- Font: the app's standard sans stack.

### Dealer letter

- Glyph: `D`, weight 500, font size `d = 0.20 · S` (26 px at S = 130), upright, `text-anchor: middle`, **no scale/rotate/skew transforms**.
- Ink: `#FFEDEA` when the dealer's face is red; `#443F35` when the dealer's face is ivory.
- Anchor: face center, baseline-shifted. Face centers: N `(0.5S, b/2)`, E `(S − b/2, 0.5S)`, S `(0.5S, S − b/2)`, W `(b/2, 0.5S)`. Baseline `y = centerY + 0.35 · d`.

At `d = 0.20 · S` the cap height spans roughly two-thirds of the bevel width; treat this as the ceiling for this bevel depth.

## 7. Flag border

An optional square ring used to flag boards (e.g., beta content, review requested). Sharp corners, 4-sided, uniform color.

- Stroke width `w = 0.031 · S` (4 px at S = 130).
- Air gap between pyramid edge and the border's inner stroke edge: `g = 0.038 · S` (5 px at S = 130). The gap is load-bearing (§2.1) — never render the border flush.
- As an SVG rect: `x = y = −(g + w/2)`, `width = height = S + 2(g + w/2)`, `fill="none"`, `stroke = borderColor`, `stroke-width = w`.
- **The slot is always reserved.** Total rendered extent is `S + 2(g + w)` square regardless of whether `borderColor` is transparent, so flagged and unflagged boards align pixel-identically in any layout.

Suggested palette (not enforced by the component): blue `#378ADD` reads cleanly against both red and ivory edges and is the recommended default flag color; amber `#EF9F27` is acceptable but sits chromatically close to the vulnerable red.

## 8. Accessibility

Root `<svg>` carries `role="img"` and a computed `aria-label` of the form:

> `Board 16, dealer West, East-West vulnerable`

Vulnerability phrasing: `not vulnerable`, `North-South vulnerable`, `East-West vulnerable`, `all vulnerable`. If `borderColor` is non-transparent, append `, flagged`.

## 9. Scaling behavior

Everything scales linearly with `S` except:

- Seam and plateau strokes have px floors (§6) so they don't vanish at small sizes.
- At `S < 64`, omit face seam strokes entirely (the shade contrast carries the geometry) and keep only the plateau stroke.
- No behavior is defined for `S < 48`; don't render below that.

## 10. Reference rendering (S = 130, board 16, no border)

Board 16 → dealer W, EW vulnerable → left/right faces red, top/bottom ivory, light D on the west face.

```svg
<svg width="148" height="148" viewBox="-9 -9 148 148" role="img"
     aria-label="Board 16, dealer West, East-West vulnerable">
  <rect x="-7" y="-7" width="144" height="144" fill="none"
        stroke="transparent" stroke-width="4"/>
  <polygon points="0,0 130,0 100,30 30,30"     fill="#FFFFFF" stroke="#ABA595" stroke-width="0.52"/>
  <polygon points="130,0 130,130 100,100 100,30" fill="#A6332B" stroke="#7A201B" stroke-width="0.52"/>
  <polygon points="0,130 130,130 100,100 30,100" fill="#C2BCAB" stroke="#ABA595" stroke-width="0.52"/>
  <polygon points="0,0 30,30 30,100 0,130"     fill="#C64840" stroke="#7A201B" stroke-width="0.52"/>
  <rect x="30" y="30" width="70" height="70" fill="#FBFAF5" stroke="#9B9588" stroke-width="1.04"/>
  <text x="65" y="77.6" text-anchor="middle" font-size="36.4" font-weight="500"
        fill="#222018">16</text>
  <text x="15" y="74.1" text-anchor="middle" font-size="26" font-weight="500"
        fill="#FFEDEA">D</text>
</svg>
```

(Values shown with derived stroke widths and baselines; implementations may round to 2 decimal places.)

## 11. Implementation notes

- Target: Vue 3 SFC (`BoardIndicator.vue`), rendering inline SVG from computed geometry. No external assets, no CSS classes required beyond font inheritance.
- All geometry computed from `size` at render time; no hardcoded 130-px coordinates in the template.
- The component must be deterministic: same props → byte-identical SVG (needed for screenshot-diff testing in the rendering harness).

## 12. Acceptance criteria

1. Boards 1–16 render with correct dealer letter position and vulnerability coloring per §4 (all 16 combinations).
2. With `borderColor` transparent vs. set, the pyramid's absolute position within the component's box is pixel-identical.
3. Dealer D ink switches correctly between red and ivory faces across the 16-board cycle.
4. Renders correctly at S = 48, 80, 130, 200; seams disappear below S = 64 per §9.
5. `aria-label` matches §8 for at least boards 1, 2, 3, 4, 16.
6. Gallery page for the rendering harness shows: boards 1–16 plain, boards 1–4 with blue and amber borders, the size sweep, and at least one override board (dealer/vulnerable diverging from the cycle) — suitable for Playwright screenshot capture in the two-tier gallery system.
7. With `dealer`/`vulnerable` props set, the render (face colors, D position, `aria-label`) reflects the overrides, not the cycle; an unrecognised prop value falls back to the derived value.

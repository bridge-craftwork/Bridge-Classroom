// Table-config snapshot for a bug report — the INPUT side that pairs with
// layout.js's computed OUTPUTS (rendered widths + --region-scale). It flattens a
// per-surface tableConfig into exactly the values the arranger RAN with, so a
// config-driven layout bug reads input→output at a glance ("center cap 1.8 →
// computed 1.27×") without re-deriving.
//
// Report-side and SELF-CONTAINED: it understands the config SHAPE but imports no
// arranger module, so the collector stays decoupled from the arranger (and works
// before the arranger ships). The shell that mounts the arranger calls
// resolveTableConfig(...) and hands the result to enrich.context.tableConfig — and
// may spread in its own computed reserves alongside, e.g.:
//   enrich.context.tableConfig = {
//     ...resolveTableConfig(cfg, phase, viewport),
//     reserves: { auction: auctionReservePx(), seat: rowReservePx(7) },
//   }
// (Reserves live in the arranger's own modules, so they're passed in, not
// imported here — keeping this file dependency-free.)

/**
 * Which per-viewport shell rule the current viewport resolves to (mode +
 * companion side). Mirrors the shell's own first-hit-wins matching so the report
 * shows the layout the user actually saw, not just the config file.
 * @returns {{mode:string, companion:string|null}|null}
 */
export function matchShell(shell, viewport) {
  const rules = shell?.perViewport
  if (!Array.isArray(rules) || !viewport || viewport.w == null) return null
  const w = viewport.w
  const portrait = viewport.h != null ? viewport.h > viewport.w : null
  const hit = rules.find((r) =>
    (r.minWidth == null || w >= r.minWidth) &&
    (r.maxWidth == null || w <= r.maxWidth) &&
    (r.portrait == null || r.portrait === portrait),
  )
  return hit ? { mode: hit.mode ?? null, companion: hit.companionPosition ?? null } : null
}

/**
 * Flatten a tableConfig into a compact report snapshot (~0.4 KB). Only the
 * density map for the CURRENT phase is included (the rest is recoverable from
 * env.commit). Returns null for a null/legacy config so it can be spread safely.
 *
 * @param {object|null} config    the surface's tableConfig
 * @param {string|null} [phase]   canonical engine phase (for densities)
 * @param {{w:number,h:number}|null} [viewport]  current viewport (for shell match)
 */
export function resolveTableConfig(config, phase = null, viewport = null) {
  if (!config || typeof config !== 'object') return null
  const scale = config.scale || {}
  return {
    arrangement: config.arrangement ?? null,
    orientation: config.orientation ?? null,
    tracks: config.tracks
      ? { columns: config.tracks.columns ?? null, rows: config.tracks.rows ?? null }
      : null,
    caps: scale.caps ?? null,
    legibilityFloor: scale.legibilityFloor ?? null,
    // Resolved for the current phase only — the arranger's actual density inputs.
    density: phase && config.densities ? (config.densities[phase] ?? null) : null,
    // The shell layout this viewport resolved to (what the user saw).
    shell: matchShell(config.shell, viewport),
    phase: phase ?? null,
  }
}

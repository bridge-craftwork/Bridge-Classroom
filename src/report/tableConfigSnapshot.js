// Table-config snapshot for a bug report — the INPUT side that pairs with
// layout.js's computed OUTPUTS (rendered widths + --region-scale). It flattens a
// per-surface tableConfig into exactly the values the arranger RAN with, so a
// config-driven layout bug reads input→output at a glance ("center cap 1.8 →
// computed 1.27×") without re-deriving.
//
// Report-side: it understands the config SHAPE but imports no ARRANGER module
// (the shell-rule matcher it shares with TableShell is a plain util), so the collector stays decoupled from the arranger (and works
// before the arranger ships). The shell that mounts the arranger calls
// resolveTableConfig(...) and hands the result to enrich.context.tableConfig — and
// may spread in its own computed reserves alongside, e.g.:
//   enrich.context.tableConfig = {
//     ...resolveTableConfig(cfg, phase, viewport),
//     reserves: { auction: auctionReservePx(), seat: rowReservePx(7) },
//   }
// (Reserves live in the arranger's own modules, so they're passed in, not
// imported here — keeping this file dependency-free.)

// The shell matcher now lives in utils/shellLayout.js and is SHARED with TableShell,
// so the rule this report records is literally the one the shell rendered. Re-exported
// here to keep this module's public surface unchanged for existing callers.
import { matchShell } from '../utils/shellLayout.js'
export { matchShell }


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

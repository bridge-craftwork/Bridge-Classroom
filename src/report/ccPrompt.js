// The ready-to-paste Claude Code prompt written to the clipboard when a dev-sink
// bundle is saved (spec §10). Lives here, next to the sink, so the wording is
// versioned with the pipeline rather than buried inline in a component.
//
// The prompt hands CC a failing-state-as-data pointer: where the bundle is, what
// the reporter said, the env coordinates inline, and the workflow by reference to
// CLAUDE.md — ending with the standing instruction to diagnose before editing.

/**
 * @param {object} args
 * @param {string} args.bundlePath  Repo-relative bundle dir (FS Access) or file (fallback).
 * @param {object} args.context     The bundle's context.json object.
 * @param {boolean} [args.singleFile=false]  True for the zip/json fallback layout.
 * @returns {string}
 */
export function buildCcPrompt({ bundlePath, context, singleFile = false }) {
  const env = context?.env || {}
  const note = (context?.note || '').trim()

  const coords = [
    env.app && `app: ${env.app}`,
    env.viewport && `viewport: ${env.viewport.w}×${env.viewport.h}@${env.viewport.dpr}`,
    env.arrangement && `arrangement: ${env.arrangement}`,
    env.tableScale != null && `scale: ${env.tableScale}`,
    env.phase && `phase: ${env.phase}`,
    env.commit && `commit: ${env.commit}`
  ].filter(Boolean).join(' · ')

  const layoutClause = singleFile
    ? `The bundle is a single JSON file at \`${bundlePath}\` (context, fixture, and the screenshot as a data URL inlined together).`
    : `The bundle dir is \`${bundlePath}\` — it holds \`context.json\`, \`fixture.json\`, and \`screenshot.jpg\`.`

  const header = [
    `Reporter note: ${note || '(none)'}`,
    coords ? `Env: ${coords}` : null
  ].filter(Boolean).join('\n')

  return [
    `Bug report captured from the app.`,
    header,
    layoutClause +
      `\nRead \`context.json\` first for the full env block and (once wired) the action tape;` +
      ` \`fixture.json\` is the engine state (stubbed until Slice 3/4).`,
    `Follow the bug-report workflow in CLAUDE.md ("Reading a bug-report bundle").` +
      `\nDiagnose before changing anything.`
  ].join('\n\n')
}

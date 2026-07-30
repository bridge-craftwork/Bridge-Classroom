// Where a link we hand to SOMEONE ELSE should point.
//
// Invite links used to be built from `window.location.origin` — the SENDER's
// origin, which is the one piece of information that is certainly irrelevant. It
// describes the sender's reachability, and the link has to work for the recipient
// (2026-07-30: David, on `.com`, sent a `.com` link to someone who normally uses
// `.org`).
//
// `.org` exists precisely because Norton-style reputation filters block `.com` for
// some users with no whitelist (see apiUrl.js). That makes the blocking
// DIRECTIONAL: someone who can reach `.com` can almost certainly reach `.org`, and
// not the other way round. For a link going to someone we can't identify, `.org` is
// therefore the strictly safer guess.
//
// ⚠️ KNOWN GAP, tracked separately: origins are SESSION boundaries. localStorage is
// per-origin and the durable session cookie is per-API-host/per-TLD (ADR-0004), so a
// habitual `.com` user who follows a `.org` link arrives somewhere they are not
// logged in and is treated as a guest. That is a real cost of this rule, accepted
// for now because a link that cannot be opened at all is worse than one that opens
// signed-out. It's why this is only used for links leaving the app — a friend
// invitation needs no URL (the in-app invitation navigates relatively, so the
// invitee never leaves their own domain).
const CANONICAL_ORIGIN = 'https://bridge-classroom.org'
const APP_HOSTS = ['bridge-classroom.org', 'bridge-classroom.com']

/**
 * The origin to build a shareable link on: the canonical one in production, and the
 * CURRENT origin anywhere else — so `npm run dev` and the harness keep producing
 * links to themselves instead of quietly handing out production URLs.
 */
export function inviteOrigin() {
  if (typeof window === 'undefined') return CANONICAL_ORIGIN
  const host = window.location.hostname || ''
  const isApp = APP_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
  return isApp ? CANONICAL_ORIGIN : window.location.origin
}

/**
 * A shareable link to a hash route, on the invite origin. The PATHNAME is kept from
 * the current page (both domains serve the identical build, so the SPA lives at the
 * same path on each) — only the origin is swapped.
 *
 * @param {string} hashRoute e.g. `#/table/ABC123`
 */
export function buildInviteUrl(hashRoute) {
  const path = typeof window === 'undefined' ? '/' : window.location.pathname
  return `${inviteOrigin()}${path}${hashRoute}`
}

# Shared cards and print links — plan (#436 + #482)

**Status:** draft for review, 2026-10-30.
**Issues:** [#436](https://github.com/bridge-craftwork/Bridge-Classroom/issues/436) (partners share a card: members, roles, invitation links) and [#482](https://github.com/bridge-craftwork/Bridge-Classroom/issues/482) (a read-only link to a card's PDF, for RealBridge etc.).
**Design source:** convention-card `docs/DESIGN.md` "Shared cards" and `docs/DECISIONS.md` decision 18. This plan is the Bridge Classroom side of them, plus the print link.

Both features hang off the same saved card, so they share one migration, one access check and one release.

## Where things stand

- `convention_cards` (id = UUIDv4, `owner_id`, `card_data`, `visibility`, timestamps) and `user_convention_cards` (user ↔ card links, `is_primary`, `label`). Production: 13 cards, 15 links.
- `can_read` / `can_write` ([convention_cards.rs](../../bridge-classroom-api/src/routes/convention_cards.rs)) check only `owner_id`, admin or a public card.
- **Identity is self-asserted.** The card routes take `viewer_id` / `acting_user_id` from the query or body and trust it. Anyone who knows a user's id can read or overwrite that user's private cards. That is tolerable while a card has one owner who is the only one who knows its id, but sharing hands card ids and member ids to other people. **Sharing must land on cookie auth** (ADR-0004): `require_roster_member(&state, &headers, &acting_user_id)`, as `invitations.rs` and `presence.rs` already do.
- `PUT` overwrites; the last save wins.
- The library (`@bridge-craftwork/convention-card` 0.25.0) has `renderAcblPdfBytes(card, 'classic' | 'new')` with injectable asset loading (`assets.js`), and `compareCards`. **It has no three-way merge yet**; decision 18 puts it in the library.

## Decisions taken (2026-10-30)

1. **Do #436 and #482 together.**
2. **A print link is not revocable.** Each card has one permanent read-only token, minted the first time anyone asks for the link. The link always shows the card as it is now.
3. The print token is **separate from the card id**: once cards have members, the id is known to every member and appears in their API traffic; the token is the one thing that grants anonymous read.

## Open decision: where the PDF is made

RealBridge wants a direct PDF URL. The PDF code is JavaScript (pdf-lib); the API is Rust.

| Option | For | Against |
|---|---|---|
| **A. A script on the .org Worker** (recommended) | One deploy pipeline (already in `deploy.yml`); the templates and font are already in `dist/`; `nodejs_compat` is on; the library's assets are injectable. | Links live on `bridge-classroom.org` only (`.com` is GitHub Pages, static). The Worker calls the Mac API through the tunnel, so a sleeping Mac means a failed link (as for the rest of the app). |
| B. A small Node service on the droplet behind Caddy | Any hostname; no Worker code. | One more service to run and deploy; still calls the Mac API. |
| C. A page that renders in the browser | Simplest. | Not a direct PDF URL; RealBridge may not accept it. |

With A, the link is `https://bridge-classroom.org/card/print/<token>.pdf` (the `.pdf` suffix helps sites that check the extension). Shown to `.com` users too; it works for anyone.

Worker sketch: `wrangler.jsonc` gains `"main": "worker/index.js"` and `"assets": { "directory": "./dist", "binding": "ASSETS", "run_worker_first": ["/card/print/*"] }`. The script handles only that path: fetch `GET https://api.bridge-classroom.com/api/cards/print/<token>`, load the template and font via `env.ASSETS`, `renderAcblPdfBytes`, return `application/pdf` with `Content-Disposition: inline; filename="<card name>.pdf"` and a short cache (`max-age=300`, so edits show within minutes). Everything else falls through to static assets as today. Check the pdf-lib bundle against the Worker size limit (free plan 3 MB compressed) in the first slice.

## Database (one migration, idempotent like the others in `db.rs`)

```sql
ALTER TABLE user_convention_cards ADD COLUMN role TEXT NOT NULL DEFAULT 'owner';
-- backfill: rows whose user is not the card's owner_id become 'viewer'
-- (today such links are read-only in practice), and every card gets an owner row.

ALTER TABLE convention_cards ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE convention_cards ADD COLUMN print_token TEXT;          -- NULL until first asked for
CREATE UNIQUE INDEX idx_cards_print_token ON convention_cards(print_token);
ALTER TABLE convention_cards ADD COLUMN print_template TEXT NOT NULL DEFAULT 'classic';

CREATE TABLE card_invitations (
  token TEXT PRIMARY KEY,          -- 32 random bytes, base64url
  card_id TEXT NOT NULL REFERENCES convention_cards(id),
  role TEXT NOT NULL,              -- 'editor' | 'viewer'
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,        -- created_at + 30 days
  revoked_at TEXT
);

CREATE TABLE card_versions (
  card_id TEXT NOT NULL REFERENCES convention_cards(id),
  version INTEGER NOT NULL,
  card_data TEXT NOT NULL,
  saved_by TEXT REFERENCES users(id),
  saved_at TEXT NOT NULL,
  PRIMARY KEY (card_id, version)
);
-- backfill: each card's current card_data as version 1, saved_by = owner_id.
```

`owner_id` stays as the creator (and for admin views); permissions come from membership.

## API

Existing routes move to cookie auth (`require_roster_member` on `acting_user_id` / `viewer_id`); the anonymous public-card read stays.

| Route | Who | What |
|---|---|---|
| `GET /api/cards/:id` | member, admin, or public card | unchanged shape + `version`, caller's `role` |
| `PUT /api/cards/:id` | owner, editor | body adds `base_version`; mismatch → **409** with the current card and version; success bumps `version` and writes `card_versions` |
| `DELETE /api/cards/:id` | owner | unchanged (soft delete is out of scope) |
| `GET /api/users/:id/cards` | self | adds `role`, member count |
| `POST /api/cards/:id/invitations {role}` | owner | → `{ token, url, expires_at }`; url `https://bridge-classroom.com/cards/join/<token>` |
| `GET /api/cards/:id/invitations` | owner | live invitations |
| `DELETE /api/cards/:id/invitations/:token` | owner | revoke |
| `POST /api/cards/join/:token` | signed in | adds the caller as a member with the link's role; repeat is harmless; never downgrades an existing role; expired/revoked → 410 |
| `GET /api/cards/:id/members` | member | names and roles |
| `PATCH /api/cards/:id/members/:user_id {role}` | owner | change a role; a card always keeps at least one owner |
| `DELETE /api/cards/:id/members/:user_id` | owner, or the member themself | remove |
| `GET /api/cards/:id/versions` | member | history list: version, saved_by name, saved_at |
| `GET /api/cards/:id/versions/:v` | member | that version's `card_data` (the merge base) |
| `POST /api/cards/:id/print-link {template?}` | member | mints `print_token` if absent; sets `print_template`; → `{ url }` |
| `GET /api/cards/print/:token` | **anyone** | `{ name, template, card_data }`, nothing else (no ids, no owner). Rate-limited. 404 for an unknown token or a deleted card. |

A 409 is the editor's cue to merge: fetch `versions/:base_version` (base), mine, theirs → library three-way merge → save with the new `base_version`.

## Library (convention-card repo)

- `mergeCards(base, mine, theirs) → { card, conflicts: [{ path, mine, theirs }] }` — paths and values, so different fields merge themselves. New; decision 18 places it here.
- The share UI (Members, Invite, Print link, the conflict view) lives in the editor, reaching the API through the storage adapter (`src/utils/conventionCardAdapters.js` here). This is the "Phase 3" the issue mentions; the adapter gains `members`, `invite`, `join`, `printLink`, and handles 409.

## Frontend (Bridge Classroom)

- Route `/cards/join/:token` (like `/join/:code` for classrooms): sign in if needed, `POST /api/cards/join/:token`, open the card.
- The adapter methods above, and the lobby's Convention Card tab showing shared cards and the caller's role.

## Slices

1. **Cookie auth on the card routes** — no feature change; closes the self-asserted identity gap. Ship first.
2. **Migration + membership checks + roles in lists** (backfill verified on a copy of the production DB).
3. **Versions and the 409** (history table, `base_version`).
4. **Invitations + join route + members.**
5. **Print token + public read route + Worker PDF** (the decision above).
6. **Library `mergeCards` + editor UI** (convention-card repo), then a package bump here.

Slices 1–5 are API work and need the API deploy (rebuild, then restart); 5 also deploys the Worker through the normal `main` push. Slice 6 is in the other repo.

## Out of scope

Soft-deleting cards, notifying members of changes, sharing with a classroom as a whole, and print links on `.com`.

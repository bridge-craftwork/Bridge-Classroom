# Convention card print links

**Status:** live, 2026-10-31. **Issue:** [#482](https://github.com/bridge-craftwork/Bridge-Classroom/issues/482).
**History:** [shared-cards-and-print-links-plan.md](shared-cards-and-print-links-plan.md) records how we got here (the Worker rendered first, then hit Error 1102). This file is the design as it runs now.

A print link is a read-only URL to a saved card's ACBL PDF, for RealBridge and other sites that ask for a card:

```
https://bridge-classroom.org/card/print/<token>.pdf
```

No sign-in. The token is the permission. The link shows the card as it is now, never an older version.

## What it promises, and what it doesn't

- **The link works while the card is saved in Bridge Classroom.** Delete the card and the link answers 404 from then on.
- **It isn't revocable**, and there's one token per card, so the URL never changes. Decided 2026-10-30: we didn't want a second lifecycle to manage.
- **It isn't a backup.** The Share dialog says so and points to Export PDF. We don't want people treating the URL as the only copy of their card.
- **The URL shape is fixed for good** once people paste it into other sites. Everything behind it (Worker, API, renderer) can move without changing it. That's why the Worker sits in front, though it does no work.

## The parts

| Part | Where | Job |
|---|---|---|
| Share dialog | convention-card editor (`ShareDialog.vue`) | "Get the link": choose Classic or New |
| Storage adapter | `src/utils/conventionCardAdapters.js` | `printLink`, and `refreshPrintPdf` (render in the browser, upload) |
| Worker | `worker/index.js`, on `bridge-classroom.org` | forwards `/card/print/*` to the API; nothing else |
| API | `bridge-classroom-api/src/routes/card_sharing.rs`, on the Mac | finds the card by token; serves the stored PDF or has one made |
| `card_print_pdfs` | the API's database | one stored PDF per card, tagged with the card version and layout it shows |
| card-pdf-service | droplet, `card-pdf.bridge-craftwork.com` ([repo](https://github.com/bridge-craftwork/card-pdf-service)) | generic renderer: POST a card's JSON, get its PDF. Stores nothing |

All three renderers (the browser, card-pdf-service and Export PDF) use the same library call, `renderAcblPdfBytes` from `@bridge-craftwork/convention-card`. The output is flattened and is the card page only (no scoresheet, since v0.30.0).

## 1. Making the link

`POST /api/cards/:id/print-link {template?}`, any member:

- Mints `convention_cards.print_token` the first time it's asked for (guarded, so two first asks at once settle on one token). After that, the same token is returned every time.
- An owner or editor may set `print_template` (`classic` | `new`). For a viewer, the card's current layout stands.
- Returns `{ url, template }`.

## 2. Rendering in the browser, then storing

After **save**, **overwrite** (the merge after a 409) and **printLink**, the adapter calls `refreshPrintPdf(cardId)` in the background:

1. It reads the card back (`GET /api/cards/:id`), getting `version`, the caller's `role`, and `print_template`. The API sets `print_template` only when a print link exists.
2. It stops there if the card has no link or the caller is a viewer.
3. It runs `renderAcblPdfBytes(card, template, { flatten: true })`, which takes about 0.2 s of CPU on a laptop.
4. It uploads with `PUT /api/cards/:id/print-pdf?acting_user_id=&version=&template=`, the PDF as the body.

The API stores it (an upsert on `card_id`) only if all of these hold:

- the caller is signed in (cookie) and is an owner or editor;
- the card has a print token (otherwise 409);
- `version` and `template` match the card now (otherwise 409, so an older render never replaces a newer one);
- the body starts with `%PDF-` (otherwise 400);
- it's no bigger than 4 MB (`PRINT_PDF_LIMIT`; otherwise 413).

Failures only log a warning. A save never waits on this step and never fails because of it.

## 3. Opening the link

```
anyone's browser
  GET bridge-classroom.org/card/print/<token>.pdf
  → Worker: forwards, no cache
  → GET api.bridge-classroom.org/api/cards/print/<token>.pdf   (API, on the Mac)
      no card has this token          → 404 "No card for this link"
      stored PDF matches the card's
        version and print_template    → served
      otherwise                       → POST card-pdf.bridge-craftwork.com/pdf?template=…
                                           (X-Render-Key, 20 s timeout)
                                        → stored in card_print_pdfs, then served
                                        → 502 if the renderer fails
```

- The PDF comes back as `application/pdf`, `inline`, named after the partners (else the card), with `Cache-Control: no-store` and `X-Robots-Tag: noindex`.
- Without `.pdf`, the same API route returns the card as JSON: the name, layout and `card_data` only, with no ids and no owner.
- The `X-Render-Key` skips card-pdf-service's per-IP rate limit, since the API's requests all arrive from one address.

**Nothing is cached**, neither at the Worker nor in the browser. These links are opened rarely. A stored PDF already makes the API's answer instant, and without a cache an edit or a delete shows up on the very next open.

## 4. When the card changes

Each save bumps `version`, so the stored PDF stops matching at once. Usually the saver's browser uploads the new one within seconds. If someone opens the link first, card-pdf-service renders it once (2–5 s on the droplet's shared CPU) and that copy is stored. Changing the layout has the same effect, because the stored layout no longer matches.

## 5. When the card is deleted

`DELETE /api/cards/:id` (owner) removes the card's stored PDF, along with its invitations, history and members, and then the card itself. The token went with the card, so the link answers 404. When the API starts, it also deletes any `card_print_pdfs` row whose card no longer exists. That cleans up cards deleted before the delete removed their PDF.

A member who leaves doesn't delete the card. The card and its link stay as long as anyone still has it.

## Why it's built this way

- **Not in the Worker:** a render takes 200–300 ms of CPU, and the free Workers plan allows 10 ms (Error 1102). We chose not to pay for Workers Paid.
- **The API reads the card and calls the renderer**, and the Worker only forwards: the API already has the database, so the renderer stays generic and needs no access to it.
- **Rendering in the browser first:** the droplet has one shared vCPU, so a render there took about 5–8 s on first open. Members' browsers do the work for free when they save, so the droplet only renders on a cold open.
- **Card page only:** a scoresheet doesn't help a site that wants your card. Dropping it cut the PDF from 1.6 MB to 0.5 MB and the render time by about 40%. Export PDF still offers the scoresheet ("Second page"), and a team scoresheet can be added later as another value in `SCORESHEETS`.

## Running it

- **API:** environment variables `CARD_PDF_URL` (default `https://card-pdf.bridge-craftwork.com`) and `CARD_PDF_KEY` (one of the renderer's `CARD_PDF_SERVICE_RENDER_KEYS`). Both are set in `~/Library/LaunchAgents/com.bridgeclassroom.api.plist`. A new variable needs `launchctl bootout` and `bootstrap`; a new binary only needs `kickstart -k`.
- **Renderer:** bridge-craftwork-platform compose service `card-pdf-service` (127.0.0.1:8007 behind Caddy). It's pinned to a convention-card tag in its `package.json`; bump the tag, push, and when the `:main` image is built, run `docker compose pull && up -d card-pdf-service` on the droplet.
- **Browser side:** the convention-card pin in this repo's `package.json`.
- **Storage:** about 0.5 MB per card with a link, one row per card.

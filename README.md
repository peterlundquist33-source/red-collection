# The RED Collection

A static, zero-backend public showroom for a personal sports-card collection.
The public site shows **what a card is and the story behind it**. Everything
financial or private stays in a Google Sheet that never leaves Peter's machine.

The site currently publishes **zero cards** — by design. `data/cards.json` is an
empty array and the page renders a complete, polished empty state with zeroed
metrics. No sample cards, demo data, prices or claims have been invented.

---

## Existing-solutions preflight

Checked before building anything custom:

| Option | Why it wasn't chosen |
| --- | --- |
| **TCDB (Trading Card Database)** | Excellent breadth: community checklists, collection tracking, a trading ecosystem. But it's a hosted service with its own look and URL structure — it is not a bespoke, branded public gallery that Peter owns and controls. |
| **Collectr** | Strong at scanning, live market value, cost basis and portfolio tracking (export is a paid Pro feature). Its centre of gravity is exactly the data this request deliberately keeps **private**; using it as the public surface would couple the gallery to valuation data. |
| **Small OSS inventory managers** (`card-hub`, `cardvault`, `card-maven` and similar) | Young, self-hosted inventory apps. They need a server, a database and ongoing operational care, and they are built as inventory managers rather than a zero-backend, branded, GitHub Pages showroom. |

**Conclusion:** a custom static gallery plus a private Google Sheet fits
*this specific request* — a branded public showroom with a hard wall between
public presentation and private financial/control data, hosted free on GitHub
Pages with no server to maintain. This is not a claim that custom beats the
hosted options generally; for checklist management and valuation tracking those
services remain the better tools, and Peter can keep using one alongside this.

---

## Architecture

```
red-collection/
├── site/                     # The published site (source of dist/)
│   ├── index.html            # Hero, summary, featured, gallery, dialog
│   ├── favicon.svg           # Inline SVG mark, no external assets
│   ├── robots.txt
│   └── assets/
│       ├── css/styles.css    # Card-vault theme, mobile-first
│       └── js/
│           ├── core.js       # Pure view logic (filter/search/render) - unit tested
│           └── app.js        # DOM wiring: events, accessible dialog
├── data/cards.json           # THE public data file. Committed. Currently []
├── images/cards/             # Committed card scans (local files only)
├── scripts/
│   ├── sync.mjs              # CSV or Google Sheet -> data/cards.json
│   ├── build.mjs             # Allowlist copy -> dist/
│   ├── check-dist.mjs        # Privacy gate over dist/
│   ├── serve.mjs             # Local preview at /red-collection/
│   └── lib/                  # csv, schema, pipeline, images
├── templates/
│   └── inventory-template.csv  # Headers only. Never published
├── tests/                    # node:test, zero dependencies
└── .github/workflows/deploy.yml
```

Data flow, one direction only:

```
private Google Sheet (or local CSV)
        │  scripts/sync.mjs   -- strict allowlist, fails closed
        ▼
data/cards.json  (public, committed, allowlisted fields only)
        │  scripts/build.mjs  -- explicit copy allowlist
        ▼
dist/  ──  scripts/check-dist.mjs  ──  GitHub Pages
```

No build step touches the network. No runtime code talks to Google. The browser
fetches exactly one relative file: `data/cards.json`.

### Zero dependencies

There is no `node_modules`, no bundler and no framework — Node's built-ins and
the browser's own module loader do everything, including the CSV parser and the
test runner. Nothing to audit, nothing to update, nothing to break.

---

## Privacy model

**The rule:** the public site contains the card and its story. Nothing else.

Never published, and enforced in three independent places:

| Never published | Enforcement |
| --- | --- |
| Purchase price, price paid, cost basis | `sync.mjs` **aborts** if such a column exists |
| Estimated / current / market / insured value, appraisals | `sync.mjs` aborts |
| *(allowed, by design)* `tier` — a qualitative Grail/Keeper/Tradeable rating | Not a price; never a number or a currency symbol |
| Acquisition date/source, purchased-from, seller, vendor, invoice, receipt | `sync.mjs` aborts |
| Sale price, profit, margin, offers | `sync.mjs` aborts |
| Raw Google Drive / Docs / `googleusercontent` URLs | `sync.mjs` aborts on any field containing one; image paths must be local |
| Storage/vault location, email, address, phone | `sync.mjs` aborts |
| The Sheet ID itself | Never written to this repository. Supplied per-run via `--sheet-id` or `RED_SHEET_ID` |
| Unpublished rows | Dropped entirely — not shipped as hidden data |
| Any other column | Stripped with a warning; only the allowlist is emitted |

1. **Pipeline (fail closed).** A sensitive column, or a Drive URL anywhere in a
   row, aborts the whole run with a `PRIVACY STOP`. Nothing is written. Private
   data is never "dropped quietly" — a mis-mapped column stops the sync so it
   gets noticed.
2. **Build (allowlist copy).** `build.mjs` copies only `site/`, `data/cards.json`
   and `images/cards/`, filtered by file extension. `scripts/`, `tests/`,
   `templates/`, `node_modules/`, `private/`, `.git` and `.github` cannot reach
   `dist/` because nothing copies them.
3. **Gate (`npm run check`).** Scans every text file in `dist/` for Google hosts,
   financial vocabulary, Google-file-ID-shaped tokens, non-allowlisted JSON
   fields and leaked private paths. CI runs this before deploying, so a failure
   blocks publication.

Also: `.gitignore` excludes `private/`, `inventory*.csv` and `*.private.csv`, so
an inventory export dropped in the repo root is not committed by accident.

### No secrets anywhere

This project uses none. No API keys, no tokens, no service accounts, no GitHub
secrets. The only authenticated action is `gog sheets get`, run locally against
Peter's own already-authorized account. The Sheet ID is passed at the command
line and never stored in the repo.

---

## Public schema

`data/cards.json` is an array of objects with exactly these fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | **yes** | Unique slug: `^[a-z0-9][a-z0-9-]{1,63}$`. Stable, lowercase. Duplicates are rejected |
| `player` | string | **yes** | Player name as it should display |
| `sport` | enum | **yes** | `baseball`, `basketball`, `football`, `hockey`, `soccer`, `golf`, `tennis`, `racing`, `boxing`, `mma`, `wrestling`, `olympics`, `multi-sport`, `other` |
| `team` | string | **yes** | Team on the card |
| `year` | integer | **yes** | Four digits, 1860 … next year |
| `set` | string | **yes** | e.g. `Topps Chrome` |
| `cardNumber` | string | no | Printed number, without `#` |
| `parallel` | string | no | e.g. `Refractor`, `Gold /10` |
| `grade` | string | no | e.g. `9`, `9.5`, `A` |
| `gradingCompany` | enum | no | `PSA`, `BGS`, `SGC`, `CGC`, `CSG`, `HGA`, `TAG`, `Raw` |
| `status` | enum | **yes** | `owned`, `incoming`, `grading`, `traded`, `sold`, `archived` |
| `tier` | enum | no | `Grail`, `Keeper`, `Tradeable` — a qualitative "how much this card matters to me" rating. Deliberately not a price; see Privacy model |
| `featured` | boolean | **yes** (defaults `false`) | Drives the featured region |
| `frontImage` | path | no | Local path under `images/cards/`. A bare filename is accepted and prefixed |
| `backImage` | path | no | Same rules |
| `altFront` | string | required **with** `frontImage` | Alt text; accessibility is not optional |
| `altBack` | string | required **with** `backImage` | Alt text |
| `story` | string | no | Up to 2000 characters. Blank lines become paragraphs |

**Input-only (never emitted):**

| Field | Type | Notes |
| --- | --- | --- |
| `published` | boolean | Must be truthy for the row to appear. Missing/blank = unpublished |

Why these required fields: `id` makes links and dedupe possible; `player`,
`sport`, `team`, `year` and `set` are what the filters and the card title are
built from; `status` is shown as a badge. Everything else is genuinely optional
so the first card can go up before its scans exist — a card with no images gets
a styled "scan pending" placeholder rather than a broken image.

Booleans accept `true/false`, `yes/no`, `y/n`, `1/0`, `x` and blank (false).
Anything else is an error rather than a silent guess.

---

## Local sync commands

### From a local CSV

```bash
# 1. Copy the template and fill it in (or export the Sheet as CSV)
cp templates/inventory-template.csv private/inventory.csv

# 2. Validate without writing anything
node scripts/sync.mjs --csv private/inventory.csv --dry-run

# 3. Write data/cards.json
npm run sync:csv -- private/inventory.csv
```

### From the private Google Sheet

Requires the `gog` CLI, already authorized for `peterlundquist33@gmail.com`.
That account is pinned in `scripts/sync.mjs` as `REQUIRED_ACCOUNT` and passed
explicitly on every call, so the other account configured on this machine is
never used — even though it is `gog`'s default.

```bash
# The Sheet ID is private: pass it per run, or export it for the shell session.
export RED_SHEET_ID='<the-private-sheet-id>'

# Dry run first
node scripts/sync.mjs --sheet --sheet-id "$RED_SHEET_ID" --range 'Cards!A1:S1000' --dry-run

# Then write data/cards.json
npm run sync:sheet -- --sheet-id "$RED_SHEET_ID" --range 'Cards!A1:S1000'
```

Under the hood this runs, locally and read-only:

```bash
gog --account peterlundquist33@gmail.com --readonly --json sheets get <SHEET_ID> 'Cards!A1:S1000'
```

**Narrow the range deliberately.** Point it at only the public columns. If the
range includes a price, value or acquisition column, the sync refuses to run:

```
PRIVACY STOP: Refusing to run: inventory contains private/sensitive column(s): Purchase Price.
```

That is the intended behaviour — fix the range, not the guard.

If `gog` reports `invalid_grant`, an expired token, or a locked keyring, it
needs an interactive terminal (`GOG_KEYRING_PASSWORD` is not set for background
agents). Unlock/reauthorize `peterlundquist33@gmail.com` in a real terminal and
re-run. The CSV path is always available as a fallback.

### Full local loop

```bash
npm test          # 78 tests, no dependencies
npm run build     # -> dist/
npm run check     # privacy gate over dist/
npm run verify    # all three
npm run serve     # http://localhost:4321/red-collection/
```

---

## Image workflow

Images are **copied, never downloaded.** The pipeline will not authenticate to
Drive or fetch a remote URL, and a Drive link in an image column aborts the run.

1. Save or export the front and back scans to a local folder.
2. Name them predictably, e.g. `1989-upper-deck-griffey-1-front.jpg`.
3. Copy them in with validation:

   ```bash
   node scripts/sync.mjs --csv private/inventory.csv --images-src ~/Pictures/card-scans
   ```

   Each file must be a real JPEG/PNG/WebP/AVIF (checked by magic bytes, not just
   the extension), ≤ 8 MB, with a safe filename. Anything else is reported and
   skipped, never copied.
4. Reference the filename in the inventory (`frontImage`, `backImage`) and give
   every image alt text.

**Optimization is a separate, optional step.** No image library is installed and
none is required: `sharp` would add a large native dependency to a project that
otherwise has zero, for a job that runs a handful of times a year. Resize before
or after copying with whatever is to hand, for example:

```bash
# Pick one; none of these are project dependencies
npx --yes sharp-cli --input 'images/cards/*.jpg' --output images/cards --resize 1200 --quality 82
magick mogrify -resize 1200x -quality 82 images/cards/*.jpg   # ImageMagick
```

A sensible target is ~1000–1400px on the long edge, under ~400 KB per scan. The
gallery already lazy-loads images and uses `aspect-ratio` boxes, so large files
hurt bandwidth rather than layout.

---

## Publishing to GitHub Pages

The site is built for a **project path** (`/red-collection/`): every asset and
URL in `site/` is relative, and a test enforces that no absolute root paths
creep in, so it works at a project path or a custom domain unchanged.

1. Push this repository to GitHub.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Push to `main`. `.github/workflows/deploy.yml` runs tests, builds `dist/`,
   runs the privacy gate, then uploads and deploys **only `dist/`** via
   `actions/upload-pages-artifact` and `actions/deploy-pages`.
4. The site appears at `https://<user>.github.io/red-collection/`.

Pull requests run tests and the build but never upload or deploy. A failing test
or a failed privacy check blocks the deploy.

---

## Adding the first card — checklist

- [ ] Add one row to the private inventory. Fill `id`, `player`, `sport`,
      `team`, `year`, `set`, `status`, and set `published` to `true`.
- [ ] Save the front/back scans locally; copy them in with `--images-src`.
- [ ] Set `frontImage` / `backImage` to the filenames, and write `altFront` /
      `altBack` describing each scan.
- [ ] Write the `story` — the reason the card is in the vault.
- [ ] Set `featured` to `true` if it belongs on the front page.
- [ ] `node scripts/sync.mjs --csv <file> --dry-run` and read every warning.
- [ ] Run the real sync, then `npm run verify`.
- [ ] `git diff data/cards.json` and confirm with your own eyes that it contains
      only public fields.
- [ ] `npm run serve` and check the card: tile, dialog, keyboard (Tab, Escape),
      and a narrow mobile viewport.
- [ ] Commit `data/cards.json` plus the new images, then push.

---

## Accessibility

Built in, and covered by tests:

- Skip link; semantic landmarks; one `h1`; sections labelled by their headings.
- Real `<button>` and `<select>` controls — no clickable `div`s, no inline
  handlers.
- Card detail is a `role="dialog" aria-modal="true"` panel: focus moves to the
  close button on open, Tab and Shift+Tab are trapped inside, Escape closes, and
  focus returns to the tile that opened it. The keydown listener is removed on
  close, and body scroll is locked while open.
- Visible 3px focus ring on every focusable element; 44px minimum touch targets.
- Result counts announced via `role="status" aria-live="polite"`.
- Every image carries author-written alt text; cards without scans get a
  labelled placeholder instead of a broken image.
- `prefers-reduced-motion` honoured.

## Design notes

Mobile-first: a single column that becomes a `minmax()` auto-fill grid at wider
sizes, with `min-width` breakpoints only. Deep charcoal vault surfaces, warm
cream type, one restrained red accent reserved for emphasis. The foil sheen is
pure CSS gradients — no image assets, no external fonts, no tracking, nothing
loaded from a third party.

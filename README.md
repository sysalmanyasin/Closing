# Shift Register & Daily Closing — Fazal Din's Pharma Plus

A single-page, installable web app (PWA) for cashier shift closing, cash
reconciliation, and daily/period closing reports. Runs entirely
client-side; data lives in `localStorage` with optional Dropbox sync.

**Live URL:** https://closing.duapharma.com

---

## Architecture — The 5 Floors + Nav Layer

```
├── index.html
├── css/main.css
├── manifest.json         ← PWA install config
├── sw.js                 ← service worker (offline cache)
└── js/
    ├── state.js          ← FLOOR 2: AppState, constants, DENOMS, SHIFTS
    ├── repository.js     ← FLOOR 1: localStorage read/write, JSON backup export/import
    ├── actions.js        ← FLOOR 3: Business logic + EventBus
    ├── components.js     ← FLOOR 4: UI builders, numpad, PDF, row builders
    ├── pages.js           ← FLOOR 5: Page renderers, navigation
    ├── ledger-nav.js      ← FLOOR 4/5: guided-focus mode, progress bar,
    │                         jump-nav, end-of-shift summary modal
    └── sync.js           ← FLOOR 1 (ext): Dropbox cloud sync module
```

Each floor only talks to the floor(s) below it. `ledger-nav.js` sits
on top of the original 5 floors — it doesn't duplicate business logic,
it only reads totals already computed by `calc()` (Floor 3) and
orchestrates which section is shown.

**Load order matters:** `state.js` → `repository.js` → `actions.js` →
`components.js` → `pages.js` → `ledger-nav.js` → `sync.js`. All are
plain `<script>` tags (no bundler, no build step).

---

## Ledger Nav Layer (`ledger-nav.js`)

The ledger page is **guided-focus only** — there is no "browse all
cards freely" mode. One section is shown at a time; cashiers move
through it with Back / Next.

- **Sticky jump-nav** — pill chips at the top of the ledger page, one
  per section. Tap a chip to jump straight to that section.
- **Progress bar** — "X of Y done," fills in as sections are marked
  complete.
- **Focus flow** — the current section is expanded, everything else
  is collapsed. "✓ Save Section" marks a section complete; editing a
  completed section un-marks it automatically.
- **View all** — a read-only overlay (tap "View all" on the progress
  bar) to glance across every section without leaving focus mode.
  It's a look, not a second editing path.
- **End-of-shift summary modal** — the Save & Close button opens a
  review screen first: Target Net Sales / Net Cash / Variance, plus a
  note listing any section that's unopened or entered-but-unsaved.
  Variance is color-coded: green (surplus, or ≤ Rs. 100 rounding
  gap), amber (Rs. 100–1,000 shortage), red (> Rs. 1,000 shortage).
  The note is a warning, not a hard block — you can still save.

**Integration points in the existing floors (3 edits only):**
1. `index.html` — Save button calls `openSummaryModal()` instead of
   `saveSheet()` directly; `confirmSummaryAndSave()` calls the real
   `saveSheet()` after review.
2. `actions.js` — `initLedger()` calls `initLedgerNav()` at the end;
   `calc()` calls `updateSectionStatus()` at the end.
3. `components.js` — `toggleCard()` is a no-op for ledger section
   cards (navigation is via chips / Back-Next / View all instead);
   for non-ledger cards it still toggles normally and notifies
   `onCardToggled()` so the nav stays in sync.

**Dependency note:** `sync.js` must always be loaded — `actions.js`'s
`persist()` → `scheduleSyncPush()` references `dbxClient`, which is
declared in `sync.js`. This is a pre-existing coupling, not introduced
by the nav layer.

---

## Named Credit Accounts

Each named account (configured in Settings) can hold **multiple
entries**, not just one lump value:

- "＋ Add entry" adds another row under an account, each with an
  optional description and a signed amount (± toggle).
- Descriptions carry through to the printable PDF and the closing
  summary export (`Account — description`).
- Old sheets saved before this change (single value per account) load
  correctly — they're treated as one entry with no description.

---

## Backup / Restore

Settings → Data → **Export Backup** / **Import Backup** writes/reads
a full JSON snapshot of `localStorage` (`js/repository.js`:
`exportDataJSON()` / `importDataJSON()`).

---

## Dropbox Sync

Optional cloud sync (`js/sync.js`). When configured, `persist()`
schedules a push to Dropbox after every save so the same shift data
is available across devices. Sync failures don't block local saves —
`localStorage` is always the source of truth on-device.

---

## Deployment

`.github/workflows/deploy.yml` deploys this as a **static site** to
GitHub Pages on every push to `main` — no build step, no
`package.json`, just the files as-is. `CNAME` points the Pages site
at `closing.duapharma.com`.

--

## Local development

No build tooling required. Serve the folder with anything that can
host static files, e.g.:

```bash
npx serve .
# or
python3 -m http.server 8000
```

Open the served URL in a browser. For full PWA/offline behavior
(service worker), use `http://localhost` or HTTPS — `sw.js` won't
register over a plain `file://` URL.

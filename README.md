# Shift Register & Daily Closing — Fazal Din's Pharma Plus

A single-page, installable web app (PWA) for cashier shift closing, cash
reconciliation, credit tracking, and daily/period closing reports. Runs
entirely client-side as native ES modules — no bundler, no build step.
Data lives in `localStorage`, with optional Dropbox sync for
across-device backup.

**Live URL:** https://closing.duapharma.com

---

## Features

- **Shift closing ledger** — guided, one-section-at-a-time flow (Night
  → Morning → Evening; Night starts the day) covering POS/cash
  reconciliation, HS entries, strip sales, till/vault cash counts,
  credit accounts, deposits, and misc/ongoing charges.
- **Credit Ledger** — a permanent snapshot history of every shift's
  credit, browsable by date, with a toggle to switch to a **Misc /
  Ongoing Ledger** view (derived live from each shift's misc charges).
  Any snapshot can be printed directly to a 3" thermal receipt printer.
- **Closing Book** — assembles any date/shift range into a single
  flip-through, fullscreen "book" for review or export as one
  multi-page PDF. Includes quick shortcuts (Last 10 Closings, Last 3/7
  days, Last month), zoom, swipe/keyboard paging, and jump-to-date.
- **Data Retention** — configurable (default 6 months) archival of old
  records. Nothing deletes automatically; it's a PIN-gated Settings
  action, same safety level as deleting a single sheet.
- **Named credit accounts** with multiple entries per account (each
  with an optional description and signed amount), staff/tier credit
  groups, and free-label credit entries.
- **Backup & restore** — full JSON export/import of all local data.
- **Dropbox cloud sync** (optional) — pushes a copy after every save
  so the same data is available across devices.
- **Installable PWA** with offline support via a service worker.

---

## Architecture — 5 floors, real ES modules

The app is a set of native ES modules (`<script type="module">`, no
bundler). Every file has one job; each floor only depends on the
floor(s) at or below it — enforced by real `import`/`export`, not
convention. Internal per-file state (numpad state, cache, UI mode
flags, etc.) is a private, unexported object — genuinely inaccessible
from any other file, not just "private by agreement."

```
├── index.html
├── css/main.css
├── manifest.json          ← PWA install config
├── sw.js                  ← service worker (offline cache)
└── js/
    ├── app.js              ← ENTRY POINT — the only <script> index.html loads.
    │                          Imports every module below (which is what
    │                          resolves load order — no more manually-ordered
    │                          <script> tags) and exposes the handful of
    │                          functions index.html's onclick/onchange
    │                          attributes need, on `window`.
    ├── repository.js        ← FLOOR 1 — the only file that touches
    │                          localStorage. db load/persist, generic
    │                          key/value storage, JSON backup export/import.
    ├── state.js              ← FLOOR 2 — the one protected source of truth:
    │                          `db` (business data), `session` (current
    │                          "what am I looking at" pointers), and shared
    │                          constants (PIN, SHIFTS, SHIFT_SR, DENOMS).
    ├── actions.js            ← FLOOR 3 — the only door to change data: calc
    │                          engine, ledger lifecycle, save/delete sheets,
    │                          Settings mutations, auto-save, retention.
    ├── ledger-engine.js      ← FLOOR 3 (ext) — Credit/Misc Ledger snapshot
    │                          engine: builds/persists credit snapshots,
    │                          derives misc snapshots live, retention queries.
    ├── components.js         ← FLOOR 4 — pure UI building blocks: numpad,
    │                          modal picker, row builders, toast, print
    │                          sheet, PDF/WhatsApp export, edit modal.
    ├── pages.js              ← FLOOR 5 — reads state, renders UI, calls
    │                          actions: navigation, Credit/Misc Ledger page,
    │                          Calendar, Manifest, Settings UI.
    ├── ledger-nav.js         ← FLOOR 5 (ext) — guided-focus mode, progress
    │                          bar, jump-nav, end-of-shift summary modal.
    ├── closing-book.js       ← FLOOR 5 (ext) — Closing Book assembly,
    │                          fullscreen reader, PDF export.
    └── sync.js               ← FLOOR 1 (ext) — Dropbox OAuth2 PKCE cloud
                                  sync, client-side only, no backend.
```

**Shift order:** `Night → Morning → Evening` — Night starts the day,
not ends it. This shows up in sort order, "Closing 1/2/3" numbering,
and Closing Book range defaults everywhere in the codebase; don't
reintroduce a Morning-first assumption.

**One door, verified:** `db` is only ever mutated inside
`actions.js`/`ledger-engine.js` (Floor 3), and `localStorage` is only
ever touched inside `repository.js` (Floor 1) — checked by grep, not
assumed, every time something changes.

See `SCHEMA.md` for the full shape of `db` (every field, what writes
it, what reads it).

---

## Dev tooling

No build step for the app itself — `package.json` and `node_modules`
are dev-only (linting/testing), never loaded by `index.html`.

```bash
npm install        # one-time, installs eslint + test runner deps
npm run lint        # ESLint — catches undefined vars, unused imports,
                     # duplicate declarations
npm test            # Node's built-in test runner — tests/*.test.mjs
```

Tests currently cover the shift day-cycle ordering, the Credit/Misc
Ledger snapshot engine, retention math, and Repository's
corruption-safe loading. They don't yet cover `calc()` (the core
financial arithmetic) or any rendering code — the highest-value next
addition if you extend the test suite.

---

## Deployment

`.github/workflows/deploy.yml` triggers on any push of a `*.zip` file
to `main`: it unzips the archive and deploys the contents as a static
site to GitHub Pages — no build step, just the files as-is. `CNAME`
points the Pages site at `closing.duapharma.com`.

---

## Local development

Serve the folder with anything that can host static files, e.g.:

```bash
npx serve .
# or
python3 -m http.server 8000
```

Open the served URL in a browser. ES modules require serving over
`http(s)://` — opening `index.html` directly via `file://` will fail
to load the module graph (a browser security restriction, not a bug).
For full PWA/offline behavior, use `http://localhost` or HTTPS —
`sw.js` won't register otherwise.

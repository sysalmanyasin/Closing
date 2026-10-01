# Shift Register & Daily Closing — Fazal Din's Pharma Plus

A single-page, installable web app (PWA) for cashier shift closing, cash
reconciliation, credit tracking, and daily/period closing reports. Runs
entirely client-side as native ES modules — no bundler, no build step.
Data lives in `localStorage`, with optional Supabase cloud sync for
across-device backup.

**Live URL:** https://closing.duapharma.com

---

## Features

- **Shift closing ledger** — guided, one-section-at-a-time flow (Night
  → Morning → Evening; Night starts the day) covering POS/cash
  reconciliation, HS entries, strip sales, till/vault cash counts,
  credit accounts, deposits, MEDIQ COD orders, and misc/ongoing charges.
- **Inventory Audit card** — sits right after Strips. *Sync & Audit*
  reads live stock balances for 31 fixed item codes (read-only REST GET
  to `inventory_products` in the Pharmacy Audit Hub Supabase project),
  lists only non-zero balances (positive or negative), and flags codes
  missing from the table. *Verify & Confirm* freezes the card and stores
  a snapshot (`record.inventoryAudit`: item code, name, verified qty,
  timestamp, staff ID) inside the closing record, which syncs with the
  rest of the sheet — no schema change. Logic: `js/inventory-audit.js`.
- **Staff login & permissions** — phone + 4-digit PIN login against the
  shared `bt_staff` roster (`js/auth.js`), per-staff feature permissions,
  an Activity Log of who changed what, and a *Responsible Closing Person*
  per shift.
- **Handover closings** — extra mid-day slots (`date_Handover1`, …)
  added on top of Night / Morning / Evening.
- **Report tabs in the Closing Book** — Register Book, CC History,
  Returns / Book Bill / Deposit History, and MEDIQ History.
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
- **Cloud Settings History** — every real change to the cloud `settings`
  row is archived by a Postgres trigger; *Settings → Backup & Retention →
  Cloud Settings History* lists versions and restores one (Admin PIN,
  checked server-side, 5-try lockout). Setup: run
  `supabase/settings_restore.sql`. Guards against the settings resets of
  2026-08-27 and 2026-09-28 (see `_mergeSettings()` in `js/sync.js`).
- **Backup & restore** — full JSON export/import of all local data, plus
  optional Google Drive backup through the `google-drive` Supabase Edge
  Function (`js/drive-backup.js`; the Google refresh token never reaches
  the browser).
- **Closing notifications** — Settings shortcut to the ntfy topic that
  receives each saved closing (`js/ntfy-link.js`; topic name is stored
  on the device only, never in the repo).
- **Android home-screen widgets** — separate native app in
  `android-widget/` (see its own README).
- **Supabase cloud sync** (optional) — pushes a copy after every save
  and subscribes to realtime changes, so the same data stays in sync
  across devices within about a second.
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
├── sw.js                  ← service worker (offline cache, APP_SHELL list)
├── CNAME                  ← GitHub Pages custom domain
├── SCHEMA.md              ← shape of `db` and saved sheet records
├── supabase/              ← reference SQL + Edge Function (see below)
├── android-widget/        ← native Android widgets app (own README)
├── tests/                 ← node --test suites
└── js/
    ├── app.js              ← ENTRY POINT — the only <script type="module">
    │                          index.html loads. Imports every module below
    │                          and exposes the functions index.html's
    │                          onclick/onchange attributes need on `window`.
    ├── notify.js            ← FLOOR 0 — in-app alert/confirm dialogs
    │                          (replaces window.alert). Zero imports.
    ├── repository.js        ← FLOOR 1 — the only file that touches
    │                          localStorage. db load/persist, key/value
    │                          storage, JSON backup export/import.
    ├── supabase-client.js   ← FLOOR 1 (ext) — single shared Supabase client
    ├── sync.js              ← FLOOR 1 (ext) — cloud sync engine: realtime
    │                          channel, per-record last-write-wins merge.
    ├── auth.js              ← phone + PIN login, sets session.loggedInStaff
    ├── bt-bridge.js         ← read-only fetch of the shared bt_staff roster
    ├── state.js              ← FLOOR 2 — `db`, `session`, shared constants
    │                          (SHIFTS, DENOMS, …), permissions helpers.
    ├── actions.js            ← FLOOR 3 — only door to change data: calc
    │                          engine, ledger lifecycle, save/delete,
    │                          Settings mutations, auto-save, retention.
    ├── ledger-engine.js      ← FLOOR 3 (ext) — Credit/Misc Ledger snapshots
    ├── activity-log.js       ← FLOOR 3 (ext) — append-only audit trail
    ├── components.js         ← FLOOR 4 — numpad, modal picker, row builders,
    │                          toast, print sheet, PDF / image export.
    ├── inventory-audit.js    ← FLOOR 4 — Inventory Audit card (see Features).
    │                          Keeps a private snapshot; actions.js reads it
    │                          via invAuditGetSnapshot()/invAuditRestore().
    ├── pages.js              ← FLOOR 5 — navigation, Credit/Misc Ledger page,
    │                          Calendar, Manifest, Settings UI.
    ├── ledger-nav.js         ← FLOOR 5 (ext) — guided focus mode, progress
    │                          bar, jump-nav, end-of-shift summary modal.
    ├── closing-book.js       ← FLOOR 5 (ext) — Closing Book + PDF export
    ├── cc-history.js         ← FLOOR 5 (ext) — CC History tab (Evening only)
    ├── rbd-history.js        ← FLOOR 5 (ext) — Returns/Book/Deposit tab
    ├── mediq-history.js      ← FLOOR 5 (ext) — MEDIQ History tab
    ├── settings-history.js   ← FLOOR 5 (ext) — cloud settings history/restore
    ├── drive-backup.js       ← Google Drive backup client
    └── ntfy-link.js          ← ntfy topic shortcut (Settings)
```

**Ledger section order** (jump-nav): POS → MEDIQ → Shift → HS → Strips →
Inventory Audit → Misc → Card → Till → Vault → Credit → Deposit → Audit →
Final.

**Third-party scripts** loaded by `index.html` from CDNs: html2canvas,
jsPDF, and supabase-js.

**Shift order:** `Night → Morning → Evening` — Night starts the day,
not ends it. This shows up in sort order, "Closing 1/2/3" numbering,
and Closing Book range defaults everywhere in the codebase; don't
reintroduce a Morning-first assumption.

**One door, verified:** `db` is only ever mutated inside
`actions.js`/`ledger-engine.js`/`activity-log.js` (Floor 3), and `localStorage` is only
ever touched inside `repository.js` (Floor 1) — checked by grep, not
assumed, every time something changes.

See `SCHEMA.md` for the full shape of `db` (every field, what writes
it, what reads it).

---

## Supabase

Reference SQL in `supabase/` (documentation / disaster recovery — not
wired into any CI step):

- `schema.sql` — tables and RLS the app uses: `sheets`, `credit_ledger`,
  `settings`, `activity_log`, `deleted_records`, `staff_auth_link`,
  `staff_presence`, plus `bt_staff` (owned by the BT Sale Data app).
- `settings_restore.sql` — `settings_history` trigger and restore RPCs.
- `google_drive_backup.sql` and `functions/google-drive/index.ts` — Drive
  backup table and Edge Function.

The Inventory Audit card reads from a **different** project (Pharmacy
Audit Hub, table `inventory_products`) with a read-only publishable key,
independently of the Closing client.

---

## Dev tooling

No build step for the app itself — `package.json` and `node_modules`
are dev-only (linting/testing), never loaded by `index.html`.

```bash
npm install        # one-time, installs eslint, globals, jsdom
npm run lint        # ESLint over js/
npm test            # node --test "tests/**/*.test.mjs"
```

Tests cover shift ordering and handover slots, the Credit/Misc ledger
engine, sync merge, soft-deleted rows, activity-log diffing, escHtml,
responsible-staff, CC / RBD / MEDIQ history, settings history, timeline
steps, and the Inventory Audit helpers (`tests/inventory-audit.test.mjs`).
They do not cover `calc()` or rendering code. Note: `e2e-handover` and two
other suites currently fail in the repo independently of recent changes.

---

## Deployment

The web app is static files served via GitHub Pages; `CNAME` points the
site at `closing.duapharma.com`. There is no web build step and no
web-deploy workflow in this repo.

The only workflow is `.github/workflows/build-widget-apk.yml`: on pushes
to `main` that touch `android-widget/**` (or manually), it builds a debug
APK and posts the Gradle log as a commit comment on failure.

When adding or renaming a JS file, add it to `APP_SHELL` in `sw.js` and
bump `CACHE_NAME` so installed PWAs pick it up.

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

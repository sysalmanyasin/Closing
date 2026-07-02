# Fazal Din's Pharma Plus — Shift Closing Register

A Progressive Web App (PWA) for managing pharmacy shift closings, daily reconciliations, and period-level reporting.

## Features

- **Multi-shift ledger** — Night / Morning / Evening closings with full carry-forward logic (CC, credit, deposits, cash)
- **Final Closing mode** — Period aggregation across shifts since the last Final, with net sale and net cash reconciliation
- **Credit Ledger** — Running credit history with snapshot engine per shift, filterable by account
- **Closing Book** — Multi-page reader covering any date+shift range; cover page, per-shift detail pages, Final Aggregation pages, placeholder pages for missing records; pinch-to-zoom, swipe navigation, PDF export, and browser print
- **Cloud Sync** — Dropbox OAuth2 PKCE integration for automatic push/pull backups
- **PWA** — Installable, offline-capable via Service Worker; works on mobile and desktop

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | Vanilla HTML / CSS / JavaScript (no framework) |
| Build / Dev server | [Vite](https://vitejs.dev/) |
| PDF export | [html2canvas](https://html2canvas.hertzen.com/) + [jsPDF](https://github.com/parallax/jsPDF) |
| Cloud backup | [Dropbox JS SDK](https://github.com/dropbox/dropbox-sdk-js) |
| Storage | `localStorage` (key: `pharmpos_v2`) |
| PWA | `manifest.json` + `sw.js` |

## Architecture — 5-Floor Load Order

Scripts are loaded in dependency order (defined in `index.html`):

```
Floor 2 — state.js        AppState constants (PIN, SHIFTS, DENOMS, db)
Floor 1 — repository.js   localStorage read/write, JSON export/import
Floor 3 — actions.js      Business logic: calc(), save, hydrate, carry-forward
Floor 4 — components.js   UI builders: numpad, modal, dynamic rows, buildPrintSheet()
Floor 5 — pages.js        Navigation, calendar, manifest, credit ledger (~930 lines)
Floor 5.5 — closing-book.js  Closing Book reader (1045 lines)
Sync    — ledger-nav.js   Focus-mode nav, swipe gestures, section chips
        — sync.js         Dropbox OAuth2 PKCE cloud sync
```

## Data Model

All data lives in `localStorage` under the key `pharmpos_v2`:

```js
{
  settings: {
    branchName, pin,
    inventory: [...],   // strip items with prices
    subTiers: [...],    // credit subscription tiers
    namedCredits: [...] // named credit accounts
  },
  sheets: {
    "2026-06-01_Night": { /* SheetRecord */ },
    "2026-06-01_Morning": { /* SheetRecord */ },
    ...
  }
}
```

Each `SheetRecord` captures: system cash, last bill, strip qtys, till/vault denominations, credit lines (named, tier, aux), deposits, misc rows, carry-forward overrides, and computed totals.

## Getting Started

```bash
# Install dependencies
pnpm install

# Start dev server (requires PORT and BASE_PATH env vars — set automatically in Replit)
pnpm --filter @workspace/pharma-closing run dev

# Production build
pnpm --filter @workspace/pharma-closing run build
```

## Closing Book — Quick Reference

Open via **📖 Closing Book** on the dashboard.

1. Pick a **From** date+shift and **To** date+shift (or use a quick-range shortcut: 3 Days / 7 Days / 1 Month)
2. Tap **Open Closing Book** — pages assemble automatically
3. Swipe or use ◀ ▶ to navigate; pinch or zoom buttons (1× 2× 4× 8×) to zoom
4. Use the **Jump to…** dropdown to go directly to any page
5. Export via **🖨 Print** (browser dialog) or **⬇ PDF** (html2canvas + jsPDF)

Export filename pattern: `FDPP BT Closing {FromShift} {FromDate} to {ToShift} {ToDate}.pdf`

## PWA Installation

On mobile (Chrome / Safari): tap **Share → Add to Home Screen**.  
On desktop (Chrome): click the install icon in the address bar.

## Dropbox Sync Setup

1. Create a Dropbox app at <https://www.dropbox.com/developers/apps> with **App Folder** access
2. In **Settings → Cloud Sync**, enter your App Key and link your account
3. Data is pushed automatically after every save and pulled on app load

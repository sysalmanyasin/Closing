# Data Schema — Fazal Din's Pharma Plus Closing System

This is the actual shape of the `db` object as it exists in code today
(not an aspirational design). If you add a field, add it here in the
same commit — a schema doc that drifts from reality is worse than none.

`db` lives in `state.js` (Floor 2), is loaded/saved exclusively through
`repository.js` (Floor 1), and is only ever mutated by `actions.js` /
`ledger-engine.js` (Floor 3). See `js/*.js` file headers for the full
5-floor architecture this schema is used inside of.

---

## Top-level shape

```js
db = {
  settings:     { ... },   // one object, see below
  sheets:       { ... },   // keyed by "YYYY-MM-DD_Shift"
  creditLedger: [ ... ]    // flat array, append-only snapshots
}
```

## Record key format

Every saved shift is keyed as:

```
"YYYY-MM-DD_Shift"     e.g. "2026-07-03_Night"
```

`Shift` is one of `"Night" | "Morning" | "Evening"` — **Night starts the
day**, Evening ends it (see `SHIFTS` in `state.js` and `BOOK_SHIFT_ORDER`
in `closing-book.js`). `Night` sorts first, not last — this bit teams
before (see conversation history); don't reintroduce a Morning-first
assumption in new code.

---

## `db.settings`

| Field | Type | Notes |
|---|---|---|
| `bookBrandCode` | string | Used in exported Closing Book PDF filenames |
| `retentionMonths` | number | Default 6. Used by `archiveOldRecords()` — nothing deletes automatically without this + explicit PIN confirmation |
| `finalEveryN` | number | Reminds for a Final Closing every N shift closings |
| `namedCredits` | `{label}[]` | Named credit accounts (e.g. "Corporate Account") |
| `subTiers` | `{type, names[]}[]` (length 3) | Staff/branch credit tier dropdown groups |
| `strips` | `{name, price, group}[]` | Sellable strip items |
| `stripGroups` | `string[]` | Group names strips can belong to |

All of the above are mutated **only** via named functions in
`actions.js` (`settingsSet*`, `settingsAdd*`, `settingsRemove*`,
`settingsCommitAll`) — never assign to `db.settings.x` from Pages or
Components.

---

## `db.sheets[key]` — one saved shift record

Built by `buildSheetRecord()` in `actions.js`. A record is either a
**draft** (`draft: true, locked: false` — autosaved every 3s while
editing, see `scheduleAutoSave()`) or **final** (`draft: false,
locked: true` — written by `saveSheet()`).

| Field | Type | Notes |
|---|---|---|
| `profileMode` | `"shift" \| "final"` | Which closing type this is |
| `overrides` | object | Manually-overridden calculated values, keyed by field id |
| `draft` | boolean | `true` = autosave, not yet explicitly saved |
| `locked` | boolean | `true` = view-only snapshot |
| `in*` / `out*` / `pos*` / `final*` | number | Raw numeric fields entered/calculated in the ledger form — see `hydrate()` in actions.js for the full field-by-field list, it's long and self-explanatory from the ids |
| `hsRows` | `{id, lbl, val}[]` | "HS" (household/misc sundry?) line items |
| `stripQtys` / `stripPrices` | `number[]` | Parallel arrays, index-matched to `db.settings.strips` |
| `auxStrips` | `{id, label, p, q}[]` | Extra ad-hoc strip line items not in the main strips list |
| `tillValues` / `vaultValues` | `number[]` | Cash-count grid values |
| `namedCredits` | `{id, idx, lbl, desc, val}[]` | Entries against `db.settings.namedCredits[idx]` |
| `tierCredits` | `{tIdx, name, val}[]` (length 3) | One per sub-tier dropdown — fixed 3 slots, no `id` needed (nothing to add/remove/reorder) |
| `auxCredits` | `{id, lbl, val}[]` | Free-label credit entries |
| `deposits` | `{id, lbl, val}[]` | Deposit line items |
| `miscRows` | `{id, label, val}[]` | **Misc/Ongoing Ledger source** — this is what the Misc Ledger tab reads live, no separate storage |

**On `id`:** every free-form row array above carries a stable `id` (from
`genRowId()` in state.js), assigned once when the row is first created
and preserved through every hydrate → edit → re-save cycle — it's how
the row survives being reopened for editing, not just a fresh row on
each load. This matters because array *position* isn't stable (deleting
row 2 of 4 shifts everything below it up), so anything that needs to
say "this specific row changed" — the Activity Log's field-diffing,
in particular — needs `id` to match old and new correctly instead of
comparing by position.

**Note:** `savedAt` is written by `saveSheet()` at final-save time (as of
this doc). Draft/autosaved records don't get a `savedAt` — only an
explicit save does, which is what Credit Ledger snapshots are built
from anyway.

---

## `db.creditLedger[]` — Credit Ledger snapshots

One entry per **saved** (non-draft) shift, built by `clBuildSnapshot()`
in `ledger-engine.js` and kept in sync by `clSaveSnapshot()` (on every
save) and `clBackfillSnapshots()` (catches any saved sheet that
somehow doesn't have one yet).

```js
{
  key, date, shift, mode, savedAt,
  openingCredit: number,
  creditAdj:     number,
  totalCredit:   number,
  lines: [{ category: "named"|"tier"|"aux", lbl, desc?, val }]
}
```

**Misc/Ongoing Ledger has no equivalent persisted array** — it's
derived live from `db.sheets[key].miscRows` on every render via
`mlAllSnapshots()`. This is intentional: misc charges don't need to
outlive the sheet record the way credit history does. Don't add a
`db.miscLedger` array unless the "why" changes.

---

## Data retention

`archiveOldRecords()` (actions.js) permanently deletes `db.sheets`
entries — and their matching `db.creditLedger` snapshot — older than
`db.settings.retentionMonths`. This never runs automatically; it's a
Settings button, PIN-gated, same safety level as deleting a single
sheet. Misc Ledger needs no separate cleanup since it's derived live.

If a future need requires keeping data past 6 months (e.g. tax/audit
requirements), export a backup (Settings → Data Backup) before
archiving — the archived data is not recoverable from within the app
afterward.

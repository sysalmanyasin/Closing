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
| `responsibleStaff` | string | Name of the staff member accountable for THIS shift's till — picked from `db.settings.staff`, set via the dropdown in the ledger toolbar. Deliberately **not** the same as `session.currentActor` (whoever is currently logged in/typing) since a manager can fill a sheet on desktop after the fact for a shift that wasn't theirs. Required (`confirmSummaryAndSave()` in `ledger-nav.js` blocks final save if empty) but NOT required for draft saves. Surfaced in the Saved Records manifest and the Staff Ledger page (`goToStaffLedger()`/`renderStaffLedger()` in `pages.js`). |
| `draft` | boolean | `true` = autosave, not yet explicitly saved |
| `locked` | boolean | `true` = view-only snapshot |
| `in*` / `out*` / `pos*` / `final*` | number | Raw numeric fields entered/calculated in the ledger form — see `hydrate()` in actions.js for the full field-by-field list, it's long and self-explanatory from the ids |
| `finalDiff` | number | The shift's variance, computed in **every** mode (not just Final Closing — see actions.js). Stored as an **absolute value**; sign lives separately in `finalDiffLabel` ("Plus (Final Audit):" = surplus, "Less (Final Audit):" = shortage). Use `Pages.signedVariance(rec)` to get a proper signed number — don't read `finalDiff`'s own sign, it has none. **Second gotcha, easy to miss:** for a `'shift'`-mode record this is a RUNNING CUMULATIVE total since the last Final Closing, not that shift's own standalone number — `aggregateSinceLastFinal()` walks backward and folds in every shift since the last `'final'` record. Summing `finalDiff`/`signedVariance()` across multiple shift rows therefore double- (triple-, quadruple-…) counts. Use `Pages.computeVarianceDeltas()` to turn cumulative snapshots into each shift's own standalone contribution (delta from the previous record, reset to 0 right after a `'final'` record) before summing anything across rows or staff — see the Staff Ledger page for the reference implementation. |
| `hsRows` | `{id, lbl, val, deleted}[]` | "HS" (household/misc sundry?) line items |
| `stripQtys` / `stripPrices` | `number[]` | Parallel arrays, index-matched to `db.settings.strips` |
| `auxStrips` | `{id, label, p, q, deleted}[]` | Extra ad-hoc strip line items not in the main strips list |
| `tillValues` / `vaultValues` | `number[]` | Cash-count grid values |
| `namedCredits` | `{id, idx, lbl, desc, val}[]` | Entries against `db.settings.namedCredits[idx]` — NOT part of the soft-delete mechanism below (tier sub-accounts have their own add/remove UX) |
| `tierCredits` | `{tIdx, name, val}[]` (length 3) | One per sub-tier dropdown — fixed 3 slots, no `id` needed (nothing to add/remove/reorder) |
| `auxCredits` | `{id, lbl, val, deleted}[]` | Free-label credit entries |
| `deposits` | `{id, lbl, val, deleted}[]` | Deposit line items |
| `miscRows` | `{id, label, val, deleted}[]` | **Misc/Ongoing Ledger source** — this is what the Misc Ledger tab reads live, no separate storage |

**`deleted` (soft-delete)** — on `hsRows`/`auxStrips`/`auxCredits`/`deposits`/`miscRows` only. Tapping ✕ (`delRow()` in components.js) asks for confirmation, then marks the row `.row-deleted` (struck through, read-only, button flips to ↺ Undo) rather than removing it from the DOM. Deleted rows: are excluded from that section's total in `calc()`; are excluded from `pullPreviousShift()`'s carry-forward into the next shift's Misc rows; DO still get saved (`deleted: true`) and restored (`hydrate()`) on this shift's own record; and DO still appear (struck through, `🚫 … (removed)`) in the read-only Previous Shift snapshot (`snapshotRowsForSection()` in ledger-nav.js) for the HS/Strips/Credit/Deposits/Misc sections — auditable, just never active going forward.

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

**`mlLatestSnapshot()` / `mlComputeAging()`** (both in
`ledger-engine.js`, both pure reads over `mlAllSnapshots()` — nothing
new is persisted) power the "Latest Snapshot + Aging" card at the top
of the Misc/Ongoing Ledger page. `mlComputeAging()` matches charges
**by label text, not row id** — carried-forward misc rows get a fresh
`id` from `addMiscRow()` every time (`pullPreviousShift()` never passes
the old `rid` through), so `id` can't track a charge's history the way
the Activity Log tracks other rows. Renaming a charge, or deleting and
recreating it under the same name after a gap, resets its aging clock.
This is a known limitation of the current data shape, not a bug.

---

## BT Sale Data bridge (bt-bridge.js)

Closing and BT Sale Data are two separate app codebases sharing **one**
Supabase project (`wetbugzzchkghpzmowod.supabase.co`). The bridge is
**read-only, one direction only**: Closing fetches BT's shared
`bt_staff` roster; Closing never writes into any of BT's tables.

| Function | Used for |
|---|---|
| `fetchStaff(force)` | Raw mirror of `bt_staff` (id/name/active), 60s cache |
| `fetchActiveStaff(force)` | `fetchStaff()` filtered to active rows, deduped by name — the list every UI actually builds from |
| `loadTierNamesFromBtStaff(tierIdx)` | Settings helper — fills a credit-tier textbox with comma-joined active staff names |

Consumers: Settings' "Sync from BT Staff" / "Load active names from
BT Staff" buttons, and the Responsible Closing Person dropdown
(`initLedger()` in actions.js, with a fallback to
`db.settings.staff` if BT Sale Data isn't reachable).

A two-way sync used to exist here — `btBridgeSyncRecord`/
`btBridgeQuickAdd` pushing into `bt_inbox_ledger`/
`bt_inbox_staff_credit`/`bt_inbox_unmatched` staging tables, including
a Quick Add widget on the Credit Ledger page — and was removed by
request: Closing's and BT's ledgers are meant to stay two independent
records, not auto-merged into one. If that's ever wanted again it
needs to be redesigned and turned back on deliberately, not restored
as a side effect of some other change.

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

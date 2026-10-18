# Closing Summary — Android Home Screen Widgets

A minimal native Android app whose only real purpose is a set of
home-screen widgets, pulled directly from the **BT SALE DATA** Supabase
project:

# Closing Summary — Android Home Screen Widgets

A minimal native Android app whose only real purpose is a set of
**22 home-screen widgets**, pulled directly from the **BT SALE DATA**
Supabase project and the separate Pharmacy Audit Hub Supabase project
(for the inventory + Today's Sale widgets). No login screen in the
normal sense — see [Auth model](#auth-model) below.

### Closing & Sales
1. **Closing Summary** — the most recent closing sheet (date, shift,
   carried CC, deposits, book bills, manual returns).
2. **Sales & Target Pace** — latest daily sale, day-over-day change,
   and this month's progress against target.
3. **Aggregated Final Closing** — Target Net Sales, Pre-date Total, Net
   Cash Available and Variance for the full period since the last
   Final Closing, mirroring the amber "🧮 Aggregated Final Closing"
   strip in the web app. Unlike the other two, its numbers never
   switch to shift-only figures — same as the web app's strip, it's
   always the period roll-up.
4. **Latest Month Total Sale** — the current month's TOTAL broken down
   into Cash, Banks, Cash & Banks combined, Credit Clients (including
   free issue), and Customers, mirroring the hero card at the top of
   the Sales section on the web app's Cover dashboard.
5. **Today's Sale** — Candela POS's live Cash / Card / Credit split for
   today, read straight from `sales_payment_summary` in the separate
   Pharmacy Audit Hub Supabase project (same one the Inventory widgets
   use) — synced by the `sync-inventory-from-dropbox` Edge Function
   alongside `inventory_products`, mirroring the "Today's Sale — POS
   Live" hero card on the web app's Cover dashboard. Deliberately
   separate from **Latest Month Total Sale** above: that one reads the
   manually-typed Sale Data ledger, this one is what Candela itself
   recorded automatically — the two can legitimately disagree until
   the day's manual entry is filled in.
6. **Last 3 Shift Closings** — the web app's per-shift reconciliation
   banner ("This shift only"), recomputed straight from each sheet's
   raw `outNetSale`/`outNetCash`/`outPrevCash`/`outTotalCash` fields —
   deliberately *not* the Aggregated Final Closing above.

### Credit
7. **Total Outstanding Credit** — one number: Staff Credit for the
   latest month with data, plus Jazz Cash / Patty-Expenses / Misc
   Sections all-time, mirroring BT Sale Data's Manager > Credit
   report's bottom total.
8. **Credit — Section Summary** — the same total broken into its four
   sections: Staff Credit (latest month), Jazz Cash (all-time),
   Patty/Expenses (all-time), Misc Sections (all-time — Pharmacy,
   Miscellaneous, Less Amounts, Extra Credits, Adjustments & Strips,
   and any other named credit account).
9. **Staff Credit** — every active staff member from `bt_staff`,
   ordered by their Sr# (the same field that orders Salary/Generic/
   Credit sheets in BT Sale Data), with that month's credit amount.
10. **Misc/Ongoing Ledger Aging** — mirrors the web app's Misc Ledger
    "Latest Snapshot + Aging" card, reading the same synced `sheets`
    table every Closing-side widget above reads.

### Inventory
Nine widgets, all reading `inventory_products` from the Pharmacy Audit
Hub Supabase project — a Kotlin, line-for-line port of the web app's
`stockledger.js`/`excess-working.js`/`reorder-report.js` math (see
`InventoryRepository.kt`'s doc-comment for the exact function each
formula mirrors), so none of them need either app open to compute:
11. **Inventory — Total Stock** — total inventory level and negative-
    value stock.
12. **Inventory Health** — Never Sold (60D), Dead Stock (60D), raw and
    corrected Excess Stock totals.
13. **Reorder Now — Most Urgent** — 30-day sales window, <7-day cover.
14. **Excess Stock — Highest Value**
15. **Top Running Items — Value-Wise**
16. **Negative Stock — Value-Wise** — most negative value first.
17. **Dead Stock — Top 20** — sold before, nothing moved in 60D+,
    ranked by value.
18. **Never Sold — Top 20** — received 60D+ ago, never sold, ranked by
    value.
19. **Search Inventory** — not a data widget: `RemoteViews` can't host
    a live search box + dropdown + results panel, so this is a tap
    shortcut into `ProductSearchActivity`, the one screen in this app
    with real interactive UI (type a name/code, pick a match, see full
    detail).

### STR Report
Three widgets reading `str_headers` from the same Pharmacy Audit Hub
Supabase project as the Inventory widgets (`StrRepository.kt` — a
Kotlin mirror of the web app's `js/str-bridge.js`/`js/str-shared.js`:
same 3-stage Awaited/Dispatched/Received lifecycle derived from
`dispatch_status`/`receive_status`, same `direction` field to tell
which side Bahria Town is on). Same rolling ~7-day window caveat as
the web app — `str_headers` only ever holds recent STRs, there's no
long-term history to surface here.
20. **Awaited STR — Dispatch from Bahria Town** — every STR with
    Bahria Town as the dispatch branch that hasn't been dispatched,
    closed, or received yet. Up to 6 stacked cards (STR Number, Date,
    Comment), oldest/most-overdue first — same bounded-list pattern as
    Last 3 Shift Closings, since a 7-day window rarely needs more.
21. **Dispatched STR — from Bahria Town** — the same Bahria-Town-as-
    dispatch-branch STRs, but already dispatched and still not closed
    or received (i.e. currently in transit out). Same stacked-card
    layout as #20.
22. **Dispatched STR — Inbound to Bahria Town** — every STR dispatched
    *from* another branch (Warehouse, Warehouse 2, or any other
    source — `direction == "in"`, Bahria Town is the receive branch)
    that's been dispatched but not yet closed or received at Bahria
    Town. Unlike #20/#21, this one can have STRs arriving from an
    unbounded number of branches at once, so it's rendered as a
    scrolling `ListView` via `StrInboundWidgetService`/
    `StrInboundCache.kt` — the same RemoteViewsService pattern as the
    Inventory list widgets (#13–18), for the same TransactionTooLarge
    reason documented on `InventoryReorderWidgetService.kt`. Each row
    shows STR Number, source branch, Date, and Comment.

## Auth model

`WidgetAuthManager.kt` holds a Supabase session for a dedicated
**"widget service" account** (`bt_widget_service_accounts` /
`is_widget_service()` on the BT SALE DATA project) — RLS only lets it
`SELECT` from the handful of tables the widgets read (`sheets`,
`bt_salesdata`, `bt_daily`, `bt_monthly`, `bt_col_config`,
`bt_targets`). It can't write anything and unlocks no other capability
in either app, so a compromised widget token is a read-only leak of
dashboard numbers, not an admin/staff credential. The only long-lived
secret is the refresh token, stored in `EncryptedSharedPreferences`
(Android Keystore-backed); access tokens are short-lived and re-minted
from it on every widget refresh.

## How it works

- One `*Repository.kt` per data domain (`ClosingRepository`,
  `SalesRepository`, `AggregatedRepository`, `MonthSaleRepository`,
  `CreditRepository`, `InventoryRepository`, `TodaySaleRepository`,
  `LastShiftsRepository`, `MiscAgingRepository`, `StrRepository`) does
  a plain `GET`
  against the relevant Supabase REST API using the project's anon/
  publishable key. Read access is governed by each table's Row Level
  Security policy, not by keeping this key secret — that's expected
  for a client-side key.
  - `AggregatedRepository` reads `finalNetSale` / `finalNetCash` /
    `finalPreTotal` straight off the latest saved sheet — the web app's
    `calc()` computes and saves these on every closing (Shift or
    Final), so no re-aggregation happens on the Android side.
  - `MonthSaleRepository` reads the current month's row from
    `bt_monthly` (falling back to the chronologically-latest row if
    the current month hasn't been saved yet, same as the web app's
    `_latestMonthlyRecord()`), splits it into Cash / Banks / Cash &
    Banks / Credit Clients / Customers exactly like `_monthSaleBreakdown()`
    in `js/cover-dashboard.js`, and folds in any custom Bank/Credit
    Clients fields from `bt_col_config` the same way `mBanks()`/
    `creditSales()` do in `js/config.js`.
  - `CreditRepository` powers the three credit widgets. It reads
    `credit_ledger` (Closing's own `js/ledger-engine.js` snapshots —
    each shift's Staff/Jazz Cash/Patty/Misc credit lines) plus
    `bt_staff` (for Sr#-ordered active names), all client-side, no
    re-implementation of either app's save-time logic. Staff Credit is
    scoped to the latest month with any snapshot; named credit
    accounts are bucketed into Jazz Cash / Patty-Expenses / Misc
    Sections by keyword match on their label (`"jazz"`, `"patty"`/
    `"expense"`, else Misc) so a renamed or newly added misc account
    (Pharmacy, Miscellaneous, Less Amounts, Extra Credits, Adjustments
    & Strips, ...) is never silently dropped from the total.
  - `InventoryRepository` is a line-for-line Kotlin port of the web
    app's inventory-health math — see the doc-comment above each
    function for exactly which JS function (`computeAll()`,
    `getCoverStats()`, `computeRows()`, `summarize()`,
    `computeAllRows()`, `topNByValue()`, `lowCoverWithin()`) it mirrors.
  - `LastShiftsRepository` recomputes each shift's own raw fields
    rather than reading the sheet's stored `finalDiff`/`finalDiffLabel`,
    which flip to the period-aggregated figures whenever a Final
    Closing has since been saved.
  - `StrRepository` reads `str_headers` directly with the same anon
    key `InventoryRepository` uses (no `WidgetAuthManager` session
    needed — RLS on this table resolves for the anon role only, same
    as the web app's `str-bridge.js`), and mirrors that same file's
    `strStage()`/`isDispatchedFromBT()`/`isReceivedAtBT()` logic in
    Kotlin so the three STR widgets never drift from what the web app
    considers "Awaited" vs "Dispatched".
- Each domain's `*WidgetProvider.kt` is an `AppWidgetProvider` that
  renders its result into the widget via `RemoteViews`. Every data
  widget auto-refreshes every 30 minutes (the Android-enforced
  minimum) and refreshes on tap; **Search Inventory** is the one
  exception — it's a static tap-shortcut, not a data widget.
- `MainActivity.kt` — a placeholder launcher screen with a manual
  "refresh all widgets" button; not required for the widgets to work,
  just gives the app something to open from the launcher.

## Widget design: Neon Glass

All widgets share one dark "neon glass" look: deep-navy cards with a soft cyan/violet corner glow, a 1dp neon edge and a glowing top line, glass inner panels, ring badges, gradient progress bars and uppercase HUD-style captions. It is driven entirely by tokens in `res/values/colors.xml` and the shared drawables (`widget_background`, `widget_grid_background`, `badge_circle_*`, `chip_*`, `tile_*`), so a new widget only needs to reference those. Data providers, refresh behaviour and Supabase access are unchanged.

## Launcher UI

The launcher now uses a clean, light dashboard with high-contrast actions. The existing widget data providers, refresh behavior, and Supabase access model are unchanged.

## Building locally

Requires Android Studio (or the command-line SDK) with SDK 34 and
JDK 17.

```
cd android-widget
./gradlew assembleDebug
```

The debug APK lands in `app/build/outputs/apk/debug/app-debug.apk`.

## Building via GitHub Actions

Any push to `main` touching `android-widget/**` triggers
`.github/workflows/build-widget-apk.yml`, which builds a debug APK and
uploads it as a workflow artifact (Actions tab → latest run →
Artifacts). It's unsigned/debug-only — fine for sideloading onto your
own device, not for the Play Store.

## Installing on your phone

1. Download `app-debug.apk` from the workflow run's Artifacts.
2. Enable "Install unknown apps" for whatever app you download it
   with.
3. Install the APK, open it once, then long-press your home screen →
   Widgets → **Closing Summary** → drag any of the 22 widgets listed
   above onto your home screen.

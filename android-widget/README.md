# Closing Summary — Android Home Screen Widgets

A minimal native Android app whose only real purpose is a set of
home-screen widgets, pulled directly from the **BT SALE DATA** Supabase
project:

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
5. **Total Outstanding Credit** — one number: Staff Credit for the
   latest month with data, plus Jazz Cash / Patty-Expenses / Misc
   Sections all-time, mirroring BT Sale Data's Manager > Credit
   report's bottom total.
6. **Credit — Section Summary** — the same total broken into its four
   sections: Staff Credit (latest month), Jazz Cash (all-time),
   Patty/Expenses (all-time), Misc Sections (all-time — Pharmacy,
   Miscellaneous, Less Amounts, Extra Credits, Adjustments & Strips,
   and any other named credit account).
7. **Staff Credit** — every active staff member from `bt_staff`,
   ordered by their Sr# (the same field that orders Salary/Generic/
   Credit sheets in BT Sale Data), with that month's credit amount.

## How it works

- `ClosingRepository.kt` / `SalesRepository.kt` / `AggregatedRepository.kt` /
  `MonthSaleRepository.kt` each do a plain `GET` against the Supabase
  REST API using the project's anon/publishable key. Read access is
  governed by each table's Row Level Security policy, not by keeping
  this key secret — that's expected for a client-side key.
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
- `ClosingWidgetProvider.kt` / `SalesWidgetProvider.kt` /
  `AggregatedWidgetProvider.kt` / `MonthSaleWidgetProvider.kt` are
  `AppWidgetProvider`s that render their result into the widget via
  `RemoteViews`. Each auto-refreshes every 30 minutes (the
  Android-enforced minimum) and refreshes on tap.
- `MainActivity.kt` — a placeholder launcher screen with a manual
  "refresh all widgets" button; not required for the widgets to work,
  just gives the app something to open from the launcher.

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
   Widgets → **Closing Summary** → drag any of the four widgets
   (**Closing Summary**, **Sales & Target Pace**, **Aggregated Final
   Closing**, **Latest Month Total Sale**) onto your home screen.

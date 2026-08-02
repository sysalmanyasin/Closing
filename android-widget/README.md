# Closing Summary — Android Home Screen Widget

A minimal native Android app whose only real purpose is a home-screen
widget showing the most recent closing sheet (date, shift, staff, net
sale, net cash, total cash), pulled directly from the `sheets` table in
the **BT SALE DATA** Supabase project.

## How it works

- `ClosingRepository.kt` — does a plain `GET` against the Supabase REST
  API (`/rest/v1/sheets?draft=eq.false&order=updated_at.desc&limit=1`)
  using the project's anon/publishable key. Read access is governed by
  the `sheets` table's Row Level Security policy, not by keeping this
  key secret — that's expected for a client-side key.
- `ClosingWidgetProvider.kt` — an `AppWidgetProvider` that renders the
  result into the widget via `RemoteViews`. Auto-refreshes every 30
  minutes (the Android-enforced minimum) and refreshes on tap.
- `MainActivity.kt` — a placeholder launcher screen with a manual
  "refresh widget" button; not required for the widget to work, just
  gives the app something to open from the launcher.

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
   Widgets → **Closing Summary** → drag it onto your home screen.

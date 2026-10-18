# Android Quick Add and Ask Dua

The Android app now has two redesigned home-screen widgets—**Quick Add** (Jazz Cash, Add Credit, Add Expense shortcuts) and **Ask Dua**—plus a modern dark/neon assistant screen.

## Google sign-in setup

- Quick Add and Ask Dua use the same Supabase Google OAuth provider as BT Sales IC. There is no separate email/password login.
- In Supabase Dashboard → Authentication → URL Configuration → Redirect URLs, add this exact URL:
  `com.duapharma.closingwidget://auth/callback`
- Keep Google enabled under Authentication → Providers and keep the existing Google OAuth client configuration unchanged.
- The Android sign-in uses the PKCE authorization-code flow. The verifier and refresh token are stored in Android Keystore-backed encrypted preferences.
- The user's Google email must be active in `public.bt_authorized_users`; Google authentication alone does not grant business access.

## Access and security

- The existing widget-service account remains read-only and is not used for writes.
- The `android-assistant` Edge Function requires a JWT and independently checks `bt_authorized_users` before every action.
- Quick Add inserts into `bt_inbox_ledger` or `bt_inbox_staff_credit`. Existing database triggers fold those events into the shared payload; the app never sends a replacement payload or invokes arbitrary SQL/RPC.
- Each submit uses a client UUID as the inbox primary key. The client keeps that ID across retries until it receives confirmation, so replaying the same request cannot add the same row twice.
- Ask Dua calls the same `bt-agent` provider pool and rate limits as BT Sales IC. The mobile call sends no tools and is explicitly read-only; the server returns text only and does not execute tool calls.

## Build

Pushes affecting `android-widget/**` trigger **Build Closing Widget APK** in GitHub Actions. The workflow uploads `closing-widget-debug-apk` as an artifact when the build succeeds.

## Smoke test after installing

1. Add `com.duapharma.closingwidget://auth/callback` to Supabase's Redirect URLs before testing Google sign-in.
2. Open Quick Add / Ask Dua and continue with Google. Use a Google account whose email is active in `bt_authorized_users`.
3. Ask Dua a question whose answer can be checked against current records.
4. If you choose to test a write, enter a legitimate business transaction only; verify it appears in the matching ledger. Do not create synthetic production transactions.
5. Confirm all existing home-screen widgets still refresh and inventory search still opens.

The build can compile without the redirect allowlist, but Google sign-in will not complete until that exact redirect is allowed in Supabase Auth settings.

## Widget v2 (Quick Add + Ask Dua)

- **Quick Add widget (4×3):** live total credit (same figure as the Total Credit widget; tap the header to refresh), four buttons (Jazz Cash, Credit, Expense, Section) and the last 3 entries saved from the app/widget. The last-3 list and the cached total live in the encrypted `AssistantStore`.
- **Ask Dua widget (4×3):** shows the last question/answer, three one-tap questions (they open the app and ask immediately), and an "Ask a question" button.
- **Quick Add screen now mirrors BT Sale Data:** four destinations including custom sections, date picker, staff-credit month hint, credit/deduction toggle, all five shifts (Morning, Evening, Night, Both, Off).
- **Deploy the Edge Function** after pulling: `supabase functions deploy android-assistant`. It now returns custom sections in `metadata`, accepts Both/Off shifts, allows negative staff-credit amounts (deductions) and passes today's date to Ask Dua.

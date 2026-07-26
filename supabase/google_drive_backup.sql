/* ═══════════════════════════════════════════════════════════════
   GOOGLE DRIVE BACKUP — token storage
   Run this once in the Supabase SQL Editor (same as schema.sql).

   This table holds the Google OAuth refresh token that makes the
   Drive backup "permanent" (no repeated sign-in). It is deliberately
   given ZERO policies with RLS enabled — that means neither the anon
   key nor an authenticated user can read or write it under any
   circumstance. Only the service_role key can touch it, and the
   service_role key only ever lives inside the google-drive Edge
   Function's runtime — it is never shipped to the browser. This is
   the actual security boundary for the refresh token (compare to
   staff_login_rls.sql's comment about bt_staff/staff_presence).
═══════════════════════════════════════════════════════════════ */

create table if not exists google_drive_backup (
  id                       int primary key default 1,
  refresh_token            text,
  access_token             text,
  access_token_expires_at  timestamptz,
  drive_file_id            text,
  connected_email          text,
  last_backup_at           timestamptz,
  updated_at               timestamptz not null default now(),
  constraint google_drive_backup_single_row check (id = 1)
);

alter table google_drive_backup enable row level security;
/* No policies added on purpose — see header comment. */

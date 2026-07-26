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
  drive_file_id            text,  -- most recent version's Drive file id (informational only now that backups are versioned)
  connected_email          text,
  last_backup_at           timestamptz,
  auto_key                 text,  -- per-install secret that authorizes the 'backup' action WITHOUT the Admin PIN, so an ordinary shift save can trigger one — see google-drive/index.ts's requireBackupAuth()
  updated_at               timestamptz not null default now(),
  constraint google_drive_backup_single_row check (id = 1)
);

/* Migrating an existing table from before auto_key existed. */
alter table google_drive_backup add column if not exists auto_key text;

alter table google_drive_backup enable row level security;
/* No policies added on purpose — see header comment. */

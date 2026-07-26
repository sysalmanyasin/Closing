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

-- ── Server-side auto-backup ──────────────────────────────────────
-- Fires the Edge Function's 'backup' action whenever a completed
-- (non-draft) shift is written to `sheets` — from ANY device, since
-- it's the Postgres write that triggers it, not anything running in
-- a particular browser. The auto_key it sends is generated
-- automatically by handleOauthCallback() in google-drive/index.ts
-- the moment Drive is connected; nothing to configure here.
--
-- The anon key below is hardcoded on purpose, not a secret leak: it's
-- the exact same public anon key already shipped to every browser in
-- sync.js/drive-backup.js. Edge Functions with verify_jwt=true just
-- need SOME valid signed JWT in the Authorization header to be
-- reached at all — the anon key satisfies that. The REAL boundary is
-- still requireBackupAuth() in index.ts checking auto_key/adminPin.
create or replace function public.drive_backup_on_shift_save()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net
as $$
declare
  v_auto_key text;
begin
  select auto_key into v_auto_key from google_drive_backup where id = 1;
  if v_auto_key is null then
    return new; -- Drive not connected / no key registered yet
  end if;

  perform net.http_post(
    url := 'https://wetbugzzchkghpzmowod.supabase.co/functions/v1/google-drive',
    body := jsonb_build_object('action', 'backup', 'autoKey', v_auto_key),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndldGJ1Z3p6Y2hrZ2hwem1vd29kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMDg4OTIsImV4cCI6MjA5Nzg4NDg5Mn0.LXFrvQTOfI3ph4aA8xWYIUo-z1yxdX0znnN5f-KsOPM',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndldGJ1Z3p6Y2hrZ2hwem1vd29kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMDg4OTIsImV4cCI6MjA5Nzg4NDg5Mn0.LXFrvQTOfI3ph4aA8xWYIUo-z1yxdX0znnN5f-KsOPM'
    ),
    timeout_milliseconds := 15000
  );
  return new;
end;
$$;

drop trigger if exists trg_drive_backup_on_shift_save on sheets;
create trigger trg_drive_backup_on_shift_save
  after insert or update on sheets
  for each row
  when (new.draft = false)
  execute function public.drive_backup_on_shift_save();

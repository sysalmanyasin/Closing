-- supabase/schema.sql
--
-- Reference schema for the tables/functions this app (Closing) actually
-- reads or writes: js/sync.js, js/auth.js, js/repository.js,
-- js/drive-backup.js, and supabase/functions/google-drive/index.ts.
--
-- Pulled directly from the live "BT SALE DATA" project (wetbugzzchkghpzmowod)
-- via the Supabase MCP connector on 2026-07-29 — table definitions, RLS
-- policies, and helper functions below are the real, current state, not a
-- reconstruction from code. bt_staff is included because auth.js and
-- is_active_staff() both depend on it directly, even though it's owned by
-- the separate BT dashboard app; its own dashboard-specific tables
-- (bt_daily, bt_monthly, bt_manager, bt_targets, etc.) are intentionally
-- left out of this file — they're out of scope for Closing and already have
-- their own (currently RLS-disabled — see audit) definitions elsewhere.
--
-- This file is documentation/disaster-recovery reference. Re-running it
-- against a fresh project should reproduce the schema Closing depends on;
-- it is not wired into any CI/deploy step.

-- =========================================================================
-- Helper functions (SECURITY DEFINER — used inside RLS policies below)
-- =========================================================================

create or replace function public.current_staff_id()
returns text
language sql
stable security definer
as $$
  select staff_id from staff_auth_link where auth_user_id = auth.uid();
$$;

create or replace function public.is_active_staff(p_uid uuid)
returns boolean
language sql
stable security definer
as $$
  select coalesce(
    (select coalesce((s.data ->> 'active')::boolean, true)
       from staff_auth_link l
       join bt_staff s on s.id = l.staff_id
      where l.auth_user_id = p_uid),
    false
  );
$$;

-- =========================================================================
-- bt_staff — owned by the BT dashboard app; Closing only reads it
-- (auth.js login) and is_active_staff() depends on it.
--
-- ⚠ SECURITY: RLS is currently DISABLED on this table in production.
-- Anyone holding the anon key can read AND write every row, including the
-- id/phone/name fields js/auth.js's login flow relies on being merely
-- "known", not secret. See the audit report for the brute-force
-- implication this has on staff login. Enabling RLS here needs a policy
-- decision from the BT dashboard side, not just Closing — not included in
-- this migration for that reason. Tracked as a known gap, not fixed here.
-- =========================================================================
create table if not exists public.bt_staff (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);
-- alter table public.bt_staff enable row level security;  -- NOT enabled live — see note above

-- =========================================================================
-- sheets — one row per shift-closing record (draft or locked), keyed by
-- "YYYY-MM-DD_Shift". See SCHEMA.md for the JSON shape of `data`.
-- =========================================================================
create table if not exists public.sheets (
  key        text primary key,
  date       text not null,
  shift      text not null,
  draft      boolean not null default true,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.sheets enable row level security;

create policy "active staff only" on public.sheets
  for all
  using (is_active_staff(auth.uid()))
  with check (is_active_staff(auth.uid()));

create policy "bt dashboard can read" on public.sheets
  for select
  to anon, authenticated
  using (true);

-- =========================================================================
-- credit_ledger — one row per shift's credit-ledger snapshot.
-- =========================================================================
create table if not exists public.credit_ledger (
  key        text primary key,
  date       text not null,
  shift      text not null,
  data       jsonb not null,
  saved_at   timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.credit_ledger enable row level security;

create policy "active staff only" on public.credit_ledger
  for all
  using (is_active_staff(auth.uid()))
  with check (is_active_staff(auth.uid()));

create policy "bt dashboard can read" on public.credit_ledger
  for select
  to anon, authenticated
  using (true);

-- =========================================================================
-- settings — single row (id = 1) holding db.settings as JSON.
-- NOTE: updated_at here is bigint (epoch ms), NOT timestamptz — this is
-- intentional and matches js/sync.js pushing db.settings._updatedAt
-- directly. Do not "fix" this to timestamptz without also changing sync.js.
-- =========================================================================
create table if not exists public.settings (
  id         integer primary key default 1 check (id = 1),
  data       jsonb not null,
  updated_at bigint not null default 0
);
alter table public.settings enable row level security;

create policy "active staff only" on public.settings
  for all
  using (is_active_staff(auth.uid()))
  with check (is_active_staff(auth.uid()));

create policy "bt dashboard can read" on public.settings
  for select
  to anon, authenticated
  using (true);

-- =========================================================================
-- activity_log — append-only audit trail written by actions.js.
--
-- ⚠ SECURITY: RLS is currently DISABLED on this table in production,
-- despite the policies below existing in this file — meaning the intended
-- restriction (staff-only writes) is not actually being enforced live.
-- See the audit report. The fix is a one-line
-- `alter table public.activity_log enable row level security;` — included
-- here for completeness/documentation, but deliberately not auto-applied;
-- confirm with the team before running it, since re-enabling RLS with only
-- these two policies will immediately cut off any write path that isn't
-- an active staff session or the "bt dashboard" read.
-- =========================================================================
create table if not exists public.activity_log (
  id         uuid primary key default gen_random_uuid(),
  ts         bigint,
  actor      text,
  key        text,
  action     text,
  changes    jsonb,
  created_at timestamptz not null default now()
);
-- alter table public.activity_log enable row level security;  -- NOT enabled live — see note above

create policy "active staff only" on public.activity_log
  for all
  using (is_active_staff(auth.uid()))
  with check (is_active_staff(auth.uid()));

create policy "bt dashboard can read" on public.activity_log
  for select
  to anon, authenticated
  using (true);

-- =========================================================================
-- deleted_records — tombstones for sync (see js/sync.js). Intentionally
-- wide open: low-sensitivity (just a key + timestamp), and every device
-- needs to freely write/read tombstones to stay in sync.
-- =========================================================================
create table if not exists public.deleted_records (
  key        text primary key,
  deleted_at timestamptz not null default now()
);
alter table public.deleted_records enable row level security;

create policy "anon full access" on public.deleted_records
  for all
  using (true)
  with check (true);

-- =========================================================================
-- staff_auth_link — maps a Supabase auth user to a bt_staff.id. Each staff
-- member may only ever read their own link.
-- =========================================================================
create table if not exists public.staff_auth_link (
  staff_id      text primary key references public.bt_staff(id),
  auth_user_id  uuid not null unique references auth.users(id),
  created_at    timestamptz not null default now()
);
alter table public.staff_auth_link enable row level security;

create policy "user reads own link" on public.staff_auth_link
  for select
  using (auth.uid() = auth_user_id);

-- =========================================================================
-- staff_presence — heartbeat table, written every 30s by auth.js while a
-- staff member has an active shift open. Presence is public info (used for
-- shift-collision detection / cover dashboard); writes are restricted to
-- the staff member's own row via staff_auth_link.
-- =========================================================================
create table if not exists public.staff_presence (
  staff_id   text primary key references public.bt_staff(id),
  name       text not null,
  last_seen  timestamptz not null default now(),
  active_key text
);
comment on column public.staff_presence.active_key is
  'Current shift key (e.g., "2026-07-19_Night") or null when not on an active shift. '
  'Set by auth.js heartbeat every 30s from session.activeKey. '
  'Used for shift collision detection and cover dashboard display.';

alter table public.staff_presence enable row level security;

create policy "anon can read presence" on public.staff_presence
  for select
  to anon, authenticated
  using (true);

create policy "staff can upsert own presence" on public.staff_presence
  for insert
  to authenticated
  with check (staff_id in (select staff_id from staff_auth_link where auth_user_id = auth.uid()));

create policy "staff can update own presence" on public.staff_presence
  for update
  to authenticated
  using (staff_id in (select staff_id from staff_auth_link where auth_user_id = auth.uid()));

create policy "staff can delete own presence" on public.staff_presence
  for delete
  to authenticated
  using (staff_id in (select staff_id from staff_auth_link where auth_user_id = auth.uid()));

-- =========================================================================
-- google_drive_backup — single row (id = 1) holding the Drive OAuth
-- refresh/access tokens and last-backup metadata. RLS is enabled with
-- ZERO policies defined (intentionally — this is a default-deny table).
-- Only the google-drive Edge Function's service-role key can touch it;
-- no anon/authenticated policy exists on purpose. Do not add one without
-- understanding this is what keeps the refresh token from being readable
-- client-side. See supabase/google_drive_backup.sql for the full history
-- of how this table was hardened.
-- =========================================================================
create table if not exists public.google_drive_backup (
  id                       integer primary key default 1 check (id = 1),
  refresh_token            text,
  access_token             text,
  access_token_expires_at  timestamptz,
  drive_file_id            text,
  connected_email          text,
  last_backup_at           timestamptz,
  updated_at               timestamptz not null default now(),
  auto_key                 text
);
alter table public.google_drive_backup enable row level security;
-- No policies — service_role (Edge Function) only, by design.

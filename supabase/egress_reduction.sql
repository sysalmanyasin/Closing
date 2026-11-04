-- ════════════════════════════════════════════════════════════════
-- EGRESS REDUCTION  (APPLIED to production 2026-11-04 via the Supabase connector)
--
-- Why: pg_stat showed ~4.2M UPDATEs each on sheets and credit_ledger (185 live
-- rows) and ~70K on deleted_records. Closing's push upserts EVERY row on every
-- push, so almost all of those were no-ops — and each one fired a Realtime event
-- to every subscribed device, which then re-downloaded the whole dataset
-- (incl. the full activity_log, ~3 MB) on every pull.
--
-- What this does (all idempotent, safe to re-run):
--   1. suppress_noop_update()  — BEFORE UPDATE trigger that drops updates which
--      change nothing meaningful (client-stamped updated_at alone doesn't count).
--      No WAL row, no Realtime broadcast, no dead tuple.
--   2. server_updated_at       — server-set change cursor on sheets/credit_ledger
--      (client clocks can't be trusted) so clients can pull only what changed.
--   3. activity_log(created_at) index — cursor index for incremental log pulls.
--   4. activity_log_archive + archive_activity_log() + weekly pg_cron job —
--      moves log rows older than 90 days out of the hot table (nothing is deleted).
--   5. closing_change_token()  — one tiny RPC clients can poll instead of
--      re-downloading everything to find out whether anything changed.
--
-- ROLLBACK:
--   drop trigger if exists a_suppress_noop_update on public.sheets;
--   drop trigger if exists a_suppress_noop_update on public.credit_ledger;
--   drop trigger if exists a_suppress_noop_update on public.deleted_records;
--   drop trigger if exists a_suppress_noop_update on public.settings;
--   drop trigger if exists b_set_server_updated_at on public.sheets;
--   drop trigger if exists b_set_server_updated_at on public.credit_ledger;
--   -- archived rows can be restored with:
--   --   insert into public.activity_log select * from public.activity_log_archive on conflict (id) do nothing;
-- ════════════════════════════════════════════════════════════════

-- 1. No-op update suppression ───────────────────────────────────
create or replace function public.suppress_noop_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'sheets' then
    if new.data  is not distinct from old.data
       and new.draft is not distinct from old.draft
       and new.date  is not distinct from old.date
       and new.shift is not distinct from old.shift then
      return null;
    end if;
  elsif tg_table_name = 'credit_ledger' then
    if new.data     is not distinct from old.data
       and new.date     is not distinct from old.date
       and new.shift    is not distinct from old.shift
       and new.saved_at is not distinct from old.saved_at then
      return null;
    end if;
  elsif tg_table_name = 'deleted_records' then
    if new.deleted_at is not distinct from old.deleted_at then
      return null;
    end if;
  elsif tg_table_name = 'settings' then
    if new.data       is not distinct from old.data
       and new.updated_at is not distinct from old.updated_at then
      return null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists a_suppress_noop_update on public.sheets;
create trigger a_suppress_noop_update before update on public.sheets
  for each row execute function public.suppress_noop_update();

drop trigger if exists a_suppress_noop_update on public.credit_ledger;
create trigger a_suppress_noop_update before update on public.credit_ledger
  for each row execute function public.suppress_noop_update();

drop trigger if exists a_suppress_noop_update on public.deleted_records;
create trigger a_suppress_noop_update before update on public.deleted_records
  for each row execute function public.suppress_noop_update();

drop trigger if exists a_suppress_noop_update on public.settings;
create trigger a_suppress_noop_update before update on public.settings
  for each row execute function public.suppress_noop_update();

-- 2. Server-side change cursor ──────────────────────────────────
alter table public.sheets        add column if not exists server_updated_at timestamptz not null default now();
alter table public.credit_ledger add column if not exists server_updated_at timestamptz not null default now();

create or replace function public.set_server_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.server_updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists b_set_server_updated_at on public.sheets;
create trigger b_set_server_updated_at before insert or update on public.sheets
  for each row execute function public.set_server_updated_at();

drop trigger if exists b_set_server_updated_at on public.credit_ledger;
create trigger b_set_server_updated_at before insert or update on public.credit_ledger
  for each row execute function public.set_server_updated_at();

create index if not exists sheets_server_updated_at_idx        on public.sheets (server_updated_at);
create index if not exists credit_ledger_server_updated_at_idx on public.credit_ledger (server_updated_at);

-- 3. Cursor index for incremental activity_log pulls ────────────
create index if not exists activity_log_created_at_idx on public.activity_log (created_at);

-- 4. Archive old activity_log rows (moved, never deleted) ───────
create table if not exists public.activity_log_archive (like public.activity_log including all);
alter table public.activity_log_archive enable row level security;   -- no policies = not readable via the API
revoke all on public.activity_log_archive from anon, authenticated;

create or replace function public.archive_activity_log(p_keep_days int default 90)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare n bigint;
begin
  with moved as (
    delete from public.activity_log
    where created_at < now() - make_interval(days => p_keep_days)
    returning *
  )
  insert into public.activity_log_archive select * from moved
  on conflict (id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.archive_activity_log(int) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('archive-activity-log', '17 21 * * 6',   -- Sat 21:17 UTC = Sun 02:17 PKT
                          $cron$select public.archive_activity_log(90)$cron$);
  end if;
end $$;

-- 5. Cheap "did anything change?" probe ─────────────────────────
-- SECURITY INVOKER on purpose: RLS applies, so a caller only sees what they can read.
create or replace function public.closing_change_token()
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select concat_ws('|',
    (select count(*) || '.' || coalesce(max(server_updated_at)::text, '') from public.sheets),
    (select count(*) || '.' || coalesce(max(server_updated_at)::text, '') from public.credit_ledger),
    (select count(*) || '.' || coalesce(max(deleted_at)::text, '')        from public.deleted_records),
    (select coalesce(max(updated_at), 0)::text                            from public.settings),
    (select count(*) || '.' || coalesce(max(created_at)::text, '')        from public.activity_log)
  );
$$;
revoke all on function public.closing_change_token() from public, anon;
grant execute on function public.closing_change_token() to authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- closing_notify_ack.sql — lets the app CONFIRM the ntfy notification
-- before "Save & Close This Shift" finalizes a closing.
--
-- Apply ONCE, in the project that hosts public.sheets
-- (wetbugzzchkghpzmowod), BEFORE deploying the app change that calls
-- closing_notify_status() — until then every close is blocked with
-- "run supabase/closing_notify_ack.sql".
--
-- Replace <NOTIFY_SHARED_SECRET> below with the SAME bearer token the
-- current notify_admin_shift_saved() uses (it must match the Edge
-- Function secret NOTIFY_SHARED_SECRET). Never commit the real value —
-- this repo is public.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.closing_notify_log (
  id          bigserial primary key,
  sheet_key   text        not null,
  request_id  bigint      not null,   -- net.http_post() id → net._http_response.id
  created_at  timestamptz not null default now()
);
create index if not exists closing_notify_log_key_idx on public.closing_notify_log (sheet_key, id desc);
alter table public.closing_notify_log enable row level security;  -- no policies: only the definer functions touch it

-- Same behaviour as before, plus: remember the pg_net request id.
create or replace function public.notify_admin_shift_saved()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_req bigint;
begin
  v_req := net.http_post(
    url     := 'https://wetbugzzchkghpzmowod.functions.supabase.co/closing-ntfy-notify',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer <NOTIFY_SHARED_SECRET>'
               ),
    body    := jsonb_build_object(
                 'key',   new.key,
                 'date',  new.date,
                 'shift', new.shift,
                 'data',  new.data
               )
  );
  insert into public.closing_notify_log (sheet_key, request_id) values (new.key, v_req);
  return new;
end;
$function$;

-- Latest notification attempt for a sheet key: { log_id, status_code, ok, error }.
-- status_code is null while the HTTP call is still in flight. Returns
-- { log_id: 0 } when no notification has ever been attempted for the key.
create or replace function public.closing_notify_status(p_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'net', 'pg_temp'
as $function$
declare
  l public.closing_notify_log%rowtype;
  r record;
begin
  select * into l from public.closing_notify_log where sheet_key = p_key order by id desc limit 1;
  if not found then
    return jsonb_build_object('log_id', 0);
  end if;
  select status_code, error_msg into r from net._http_response where id = l.request_id;
  return jsonb_build_object(
    'log_id',      l.id,
    'status_code', r.status_code,
    'ok',          coalesce(r.status_code between 200 and 299, false),
    'error',       r.error_msg
  );
end;
$function$;

revoke all on function public.closing_notify_status(text) from public;
grant execute on function public.closing_notify_status(text) to authenticated;

-- =========================================================================
-- settings_history + PIN-protected cloud restore
--
-- Why: on 2026-09-28 a wiped device pushed factory-default settings over the
-- real ones (see js/sync.js _mergeSettings). Every real change to `settings`
-- is now archived, and an admin can list + restore a previous version from
-- inside the app (Settings -> Backup & Retention -> "Cloud Settings History",
-- js/settings-history.js).
--
-- Security model:
--   * settings_history / settings_restore_attempts have RLS ON and NO
--     policies -> unreadable with the anon/authenticated key (history holds
--     the admin PIN + staff PINs).
--   * The two functions are SECURITY DEFINER, require an ACTIVE STAFF login
--     (is_active_staff(auth.uid())) AND the current cloud Admin PIN.
--   * settings_history_list() returns a SUMMARY only (no PINs).
--   * 5 wrong PINs in 10 minutes locks that login out for the window.
--   * Functions return {ok:false,error:...} rather than raising, so failed
--     attempts are actually recorded.
--   * Restoring archives the version it replaces (trigger), so a restore is
--     itself undoable.
-- =========================================================================

create table if not exists public.settings_history (
  id          bigserial primary key,
  settings_id integer not null,
  data        jsonb   not null,
  updated_at  bigint,
  replaced_at timestamptz not null default now()
);
alter table public.settings_history enable row level security;

create or replace function public.settings_history_capture()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- ignore pure heartbeat updates (only _updatedAt changed); log every real change
  if (old.data - '_updatedAt') is distinct from (new.data - '_updatedAt') then
    insert into public.settings_history(settings_id, data, updated_at) values (old.id, old.data, old.updated_at);
    delete from public.settings_history where replaced_at < now() - interval '90 days';
  end if;
  return new;
end $$;

drop trigger if exists trg_settings_history on public.settings;
create trigger trg_settings_history before update on public.settings
for each row execute function public.settings_history_capture();

create table if not exists public.settings_restore_attempts (
  id        bigserial primary key,
  uid       uuid,
  attempted_at timestamptz not null default now()
);
alter table public.settings_restore_attempts enable row level security;

-- shared guard. RETURNS a status instead of raising for a wrong PIN: a raised
-- exception would roll back the failed-attempt row and the lockout could never
-- trigger. 'ok' | 'not_authorized' | 'too_many_attempts' | 'wrong_pin'
drop function if exists public._settings_restore_guard(text);
create or replace function public._settings_restore_guard(p_pin text)
returns text language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_pin text; v_fails int;
begin
  if v_uid is null or not public.is_active_staff(v_uid) then return 'not_authorized'; end if;
  select count(*) into v_fails from public.settings_restore_attempts
   where uid = v_uid and attempted_at > now() - interval '10 minutes';
  if v_fails >= 5 then return 'too_many_attempts'; end if;
  select data->>'adminPin' into v_pin from public.settings where id = 1;
  if p_pin is null or v_pin is null or p_pin <> v_pin then
    insert into public.settings_restore_attempts(uid) values (v_uid);
    return 'wrong_pin';
  end if;
  delete from public.settings_restore_attempts where uid = v_uid;
  return 'ok';
end $$;

-- Summary of recent archived versions (never returns PINs). Every keystroke in
-- Settings is archived, so a burst of edits is collapsed to ONE entry: the last
-- state archived before a gap of 5+ minutes.
drop function if exists public.settings_history_list(text);
create or replace function public.settings_history_list(p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text := public._settings_restore_guard(p_pin); v_rows jsonb;
begin
  if v_status <> 'ok' then return jsonb_build_object('ok', false, 'error', v_status); end if;
  select coalesce(jsonb_agg(row order by (row->>'id')::bigint desc), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'id', x.id, 'replaced_at', x.replaced_at,
      'n_strips', coalesce(jsonb_array_length(x.data->'strips'), 0),
      'strip_prices', coalesce((select jsonb_agg(round((e->>'price')::numeric) order by o)
                        from jsonb_array_elements(coalesce(x.data->'strips','[]'::jsonb)) with ordinality t(e,o)), '[]'::jsonb),
      'named_credits', coalesce((select jsonb_agg(e->>'label' order by o)
                        from jsonb_array_elements(coalesce(x.data->'namedCredits','[]'::jsonb)) with ordinality t(e,o)), '[]'::jsonb),
      'n_tiers', coalesce(jsonb_array_length(x.data->'subTiers'), 0),
      'n_staff', coalesce(jsonb_array_length(x.data->'staff'), 0)
    ) as row
    from (
      select h.*, lead(h.replaced_at) over (order by h.id) as nxt
        from public.settings_history h where h.settings_id = 1
    ) x
    where x.nxt is null or x.nxt - x.replaced_at >= interval '5 minutes'
    order by x.id desc limit 30
  ) q;
  return jsonb_build_object('ok', true, 'versions', v_rows);
end $$;

-- Restore one archived version as the live settings.
drop function if exists public.settings_history_restore(text, bigint);
create or replace function public.settings_history_restore(p_pin text, p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text := public._settings_restore_guard(p_pin); v_data jsonb;
        v_ts bigint := (extract(epoch from now()) * 1000)::bigint + 60000;
begin
  if v_status <> 'ok' then return jsonb_build_object('ok', false, 'error', v_status); end if;
  select data into v_data from public.settings_history where id = p_id and settings_id = 1;
  if v_data is null then return jsonb_build_object('ok', false, 'error', 'version_not_found'); end if;
  -- +60s so this beats any in-flight heartbeat; the BEFORE UPDATE trigger
  -- archives the version being replaced, so a restore can itself be undone.
  update public.settings
     set data = jsonb_set(v_data, '{_updatedAt}', to_jsonb(v_ts)), updated_at = v_ts
   where id = 1;
  return jsonb_build_object('ok', true, 'restored_id', p_id);
end $$;

revoke all on function public._settings_restore_guard(text)          from public, anon, authenticated;
revoke all on function public.settings_history_list(text)            from public, anon;
revoke all on function public.settings_history_restore(text, bigint) from public, anon;
grant execute on function public.settings_history_list(text)            to authenticated;
grant execute on function public.settings_history_restore(text, bigint) to authenticated;

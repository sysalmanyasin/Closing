/* ═══════════════════════════════════════════════════════════════
   AUTH — phone + 4-digit PIN login, gating the whole app.

   Also now the normal source of session.currentActor (used to be
   ONLY set by checkPin() in state.js, which nothing calls on a
   plain new-shift save — meaning ordinary saves logged 'Unknown'
   in the Activity Log unless someone had separately unlocked
   Settings/Activity Log/a locked record earlier in the session).
   Logging in here now sets currentActor too, so regular saves are
   attributed correctly without a second PIN prompt. checkPin()
   itself is untouched and still gates the higher-risk actions
   (delete, archive, reopening a locked record, Settings) — this
   only fixes the common case that had no gate at all.

   Also drives staff_presence (see supabase/staff_presence.sql) —
   a 30s heartbeat while logged in, so BT's Cover Dashboard can show
   who's currently online, the same way it already shows shift
   status via closing-bridge.js.

   The "only active" rule is enforced at the database layer (see
   supabase/staff_login_rls.sql), not just here — so this file's
   checks are for UX, not the actual security boundary.

   Uses the same Project URL + anon key already saved by the Cloud
   Sync setup in sync.js (dbxSaveAppKey) — this only runs once that
   exists.
═══════════════════════════════════════════════════════════════ */

import { repoGetLocal } from './repository.js';
import { session } from './state.js';

const SUPA_URL_KEY  = 'supabase_url';
const SUPA_ANON_KEY = 'supabase_anon_key';

/* Same baked-in default as sync.js — see its DEFAULT_SUPA_URL/
   DEFAULT_SUPA_ANON_KEY comment for why this is safe to commit. Kept
   duplicated here rather than imported, matching how this file already
   duplicates the storage keys instead of importing sync.js's getters. */
const DEFAULT_SUPA_URL      = 'https://wetbugzzchkghpzmowod.supabase.co';
const DEFAULT_SUPA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndldGJ1Z3p6Y2hrZ2hwem1vd29kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMDg4OTIsImV4cCI6MjA5Nzg4NDg5Mn0.LXFrvQTOfI3ph4aA8xWYIUo-z1yxdX0znnN5f-KsOPM';

/* Presence heartbeat — see supabase/staff_presence.sql. Same 30s
   cadence BT's own bt_sessions device heartbeat already uses
   (sync-center.js's SC_HEARTBEAT_MS), so both apps' "online" windows
   line up. */
const PRESENCE_HEARTBEAT_MS = 30_000;
let _presenceTimer = null;

let _client = null;

function getClient() {
  if (_client) return _client;
  const url = (repoGetLocal(SUPA_URL_KEY) || '').trim() || DEFAULT_SUPA_URL;
  const key = (repoGetLocal(SUPA_ANON_KEY) || '').trim() || DEFAULT_SUPA_ANON_KEY;
  if (!url || !key || typeof window.supabase?.createClient !== 'function') return null;
  _client = window.supabase.createClient(url, key);
  return _client;
}

function normalizePhone(p) {
  return String(p || '').replace(/\D/g, '');
}

function showGate(show) {
  const gate = document.getElementById('auth-gate');
  const app  = document.getElementById('app-root'); /* wraps the app's main content — see index.html */
  if (gate) gate.classList.toggle('hidden', !show);
  if (app)  app.classList.toggle('hidden', show);
}

export function authShowError(msg) {
  const el = document.getElementById('auth-error');
  if (el) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; }
}

/* Runs once at boot, after dbxInit() has had a chance to set up the
   Cloud Sync connection. If there's no Supabase connection configured
   yet, the login gate stays out of the way — Cloud Sync setup comes
   first (see sync.js's unlinked-state card). */
export async function authInit() {
  const client = getClient();
  if (!client) { showGate(false); return; }

  const { data: { session: sbSession } } = await client.auth.getSession();
  if (sbSession) {
    await _hydrateLoggedInStaff(client, sbSession.user.id);
    showGate(false);
  } else {
    showGate(true);
  }

  client.auth.onAuthStateChange((_event, sbSession) => {
    if (sbSession) {
      _hydrateLoggedInStaff(client, sbSession.user.id).then(() => showGate(false));
    } else {
      session.loggedInStaff = null;
      session.currentActor  = null;
      _stopPresenceHeartbeat();
      showGate(true);
    }
  });
}

async function _hydrateLoggedInStaff(client, authUserId) {
  const { data } = await client
    .from('staff_auth_link')
    .select('staff_id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (!data) { session.loggedInStaff = null; return; }
  const { data: staffRow } = await client
    .from('bt_staff')
    .select('id, data')
    .eq('id', data.staff_id)
    .maybeSingle();
  session.loggedInStaff = staffRow
    ? { staffId: staffRow.id, name: staffRow.data?.name || staffRow.id }
    : { staffId: data.staff_id, name: data.staff_id };

  /* Regular saves never call checkPin() — see file header. Without
     this, session.currentActor would stay null/'Unknown' for the
     whole session unless the person happened to unlock Settings or
     a locked record first. This is the actual fix for that. */
  session.currentActor = session.loggedInStaff.name;

  _startPresenceHeartbeat(client, session.loggedInStaff.staffId, session.loggedInStaff.name);
}

/* ── PRESENCE — see supabase/staff_presence.sql ───────────────────
   Upserts this staff member's row every PRESENCE_HEARTBEAT_MS while
   logged in. "Online" is derived by the reader (BT's Cover Dashboard)
   from last_seen recency — nothing here marks a row offline except
   authLogout()'s best-effort delete; a crashed tab just goes stale. */
function _startPresenceHeartbeat(client, staffId, name) {
  _stopPresenceHeartbeat();
  const beat = () => {
    client.from('staff_presence')
      .upsert({ staff_id: staffId, name, last_seen: new Date().toISOString() }, { onConflict: 'staff_id' })
      .then(({ error }) => { if (error) console.warn('[Auth] Presence heartbeat failed:', error.message); });
  };
  beat();
  _presenceTimer = setInterval(beat, PRESENCE_HEARTBEAT_MS);
}
function _stopPresenceHeartbeat() {
  if (_presenceTimer) { clearInterval(_presenceTimer); _presenceTimer = null; }
}

/* Reads the login form (#auth-phone, #auth-pin) and attempts login. */
export async function authLogin() {
  const client = getClient();
  if (!client) { authShowError('Cloud Sync isn\'t set up yet — set that up first.'); return; }

  const phone = normalizePhone(document.getElementById('auth-phone')?.value);
  const pin   = (document.getElementById('auth-pin')?.value || '').trim();
  if (!phone || !/^\d{4}$/.test(pin)) {
    authShowError('Enter your phone number and a 4-digit PIN.');
    return;
  }

  authShowError('');
  const btn = document.getElementById('auth-login-btn');
  if (btn) btn.disabled = true;

  try {
    /* bt_staff is readable with the anon key (same trust model BT
       already uses) — find which staffId this phone belongs to, and
       confirm it's active, before even attempting sign-in. */
    const { data: rows, error: lookupErr } = await client
      .from('bt_staff')
      .select('id, data');
    if (lookupErr) throw lookupErr;

    const match = (rows || []).find(r => normalizePhone(r.data?.phone) === phone);
    if (!match) { authShowError('No account found for that phone number.'); return; }
    if (match.data?.active === false) {
      authShowError('This account is inactive. Contact your manager.');
      return;
    }

    const email    = `${phone}@staff.internal`;
    const password = `${pin}_${match.id}`;
    const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
    if (signInErr) { authShowError('Incorrect phone number or PIN.'); return; }

    /* onAuthStateChange above handles hydrating session.loggedInStaff
       and hiding the gate once the sign-in event fires. */
  } catch (err) {
    console.error('[Auth] Login failed:', err);
    authShowError('Login failed — check your connection and try again.');
  } finally {
    if (btn) btn.disabled = false;
  }
}

export async function authLogout() {
  const client = getClient();
  if (!client) return;
  _stopPresenceHeartbeat();
  const staffId = session.loggedInStaff?.staffId;
  if (staffId) {
    try { await client.from('staff_presence').delete().eq('staff_id', staffId); }
    catch (e) { /* best-effort — a stale row just ages out on its own */ }
  }
  await client.auth.signOut();
}

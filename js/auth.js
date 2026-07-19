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

/* "Signed in as X" strip under the sync topbar — see index.html's
   #whoami-bar. Hidden entirely when nobody's logged in (e.g. Cloud
   Sync/login isn't set up on this install), matching how the auth
   gate itself stays out of the way in that case. */
function updateWhoAmI() {
  const bar  = document.getElementById('whoami-bar');
  const name = document.getElementById('whoami-name');
  if (!bar || !name) return;
  if (session.loggedInStaff) {
    name.textContent = session.loggedInStaff.name;
    bar.classList.remove('hidden');
  } else {
    bar.classList.add('hidden');
  }
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
      updateWhoAmI();
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
  updateWhoAmI();
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
      .upsert({ staff_id: staffId, name, last_seen: new Date().toISOString(), active_key: session.activeKey || null }, { onConflict: 'staff_id' })
      .then(({ error }) => { if (error) console.warn('[Auth] Presence heartbeat failed:', error.message); });
  };
  beat();
  _presenceTimer = setInterval(beat, PRESENCE_HEARTBEAT_MS);
}
function _stopPresenceHeartbeat() {
  if (_presenceTimer) { clearInterval(_presenceTimer); _presenceTimer = null; }
}

/* ── SHIFT COLLISION CHECK ──────────────────────────────────────
   Called by pages.js right after session.activeKey is set (opening
   a shift for editing). Looks for any OTHER staff member whose own
   presence row currently has the same active_key — i.e. someone
   else already has this exact shift open. A false negative just
   means the warning doesn't show (heartbeat is every 30s, so worst
   case is a ~30s blind spot); this is advisory, not a lock, so that's
   an acceptable tradeoff rather than adding real server-side locking. */
export async function checkShiftCollision(key) {
  const client = getClient();
  if (!client || !key) return null;
  const myStaffId = session.loggedInStaff?.staffId;
  const { data, error } = await client
    .from('staff_presence')
    .select('staff_id, name, last_seen, active_key')
    .eq('active_key', key);
  if (error || !data) return null;
  const now = Date.now();
  const others = data.filter(r =>
    r.staff_id !== myStaffId && (now - new Date(r.last_seen).getTime()) < PRESENCE_HEARTBEAT_MS * 3
  );
  return others.length ? others : null;
}

/* Renders/hides the red "Also open elsewhere" bar on the ledger page
   (#collision-bar in index.html). Exported so pages.js can call it
   directly without re-implementing the DOM bits. */
export function showCollisionBanner(others) {
  const bar  = document.getElementById('collision-bar');
  const text = document.getElementById('collision-bar-text');
  if (!bar || !text) return;
  if (!others || !others.length) { bar.classList.add('hidden'); return; }
  text.textContent = others.map(o => o.name).join(', ') +
    (others.length === 1 ? ' has' : ' have') + ' this shift open right now.';
  bar.classList.remove('hidden');
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

/* Settings page "Log Out" button — confirms first since it's a full
   sign-out (kills the session + presence row), not a lightweight
   PIN re-lock. */
export async function confirmLogout() {
  if (!session.loggedInStaff) { alert('You are not signed in.'); return; }
  if (!confirm('Log out of this device? You\'ll need your phone number and PIN to sign in again.')) return;
  await authLogout();
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

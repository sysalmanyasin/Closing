/* ═══════════════════════════════════════════════════════════════
   AUTH — phone + 4-digit PIN login, gating the whole app.

   Distinct from checkPin() in state.js: that's a lightweight
   per-action confirmation (typing a PIN before saving a shift) that
   already existed. This is a real session — the app doesn't render
   until someone logs in, and the "only active" rule is enforced at
   the database layer (see supabase/staff_login_rls.sql), not just
   here — so this file's checks are for UX, not the actual security
   boundary.

   Uses the same Project URL + anon key already saved by the Cloud
   Sync setup in sync.js (dbxSaveAppKey) — this only runs once that
   exists.
═══════════════════════════════════════════════════════════════ */

import { repoGetLocal } from './repository.js';
import { session } from './state.js';

const SUPA_URL_KEY  = 'supabase_url';
const SUPA_ANON_KEY = 'supabase_anon_key';

let _client = null;

function getClient() {
  if (_client) return _client;
  const url = (repoGetLocal(SUPA_URL_KEY) || '').trim();
  const key = (repoGetLocal(SUPA_ANON_KEY) || '').trim();
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
  await client.auth.signOut();
}

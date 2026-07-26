/* ═══════════════════════════════════════════════════════════════
   GOOGLE DRIVE BACKUP — client side
   The browser NEVER sees a Google refresh token. It only ever calls
   the google-drive Edge Function (see supabase/functions/google-drive)
   with an { action } body. All actual token storage/refresh/Drive
   upload happens server-side — see that function's header comment.

   OAuth Client ID is not secret (same trust level as the Supabase
   anon key baked into sync.js) — safe to commit. The Client SECRET
   is never referenced here; it only lives as an Edge Function secret.
═══════════════════════════════════════════════════════════════ */

import { repoGetLocal, repoSetLocal, repoRemoveLocal } from './repository.js';
import { dbxGetAppKey, getAnonKey } from './sync.js';
import { checkAdminPin } from './state.js';

/* ── Admin-only gate ──────────────────────────────────────────────
   This whole card is Admin-only: hidden behind a PIN prompt in the
   UI, AND the same PIN is sent to the Edge Function on every call,
   which independently checks it against db.settings.adminPin (the
   real boundary — see index.ts's requireAdmin()). _adminPin lives
   in memory only (never localStorage) so it's gone on reload/close;
   PIN_SESSION_KEY is a short-lived sessionStorage stash just to
   survive the Google OAuth redirect round-trip. */
let _adminPin = null;
const PIN_SESSION_KEY = 'google_drive_admin_pin_session';

const GOOGLE_CLIENT_ID_KEY = 'google_drive_client_id';
/* Replace with your own OAuth 2.0 Client ID (Google Cloud Console →
   APIs & Services → Credentials → OAuth client ID → Web application).
   Leave the placeholder and use the Settings input instead if you'd
   rather not commit it. */
const DEFAULT_GOOGLE_CLIENT_ID = '36704237826-j7qahq626hlh16k1ppl68nq1a0nu4b25.apps.googleusercontent.com';

const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.appdata',
  'openid', 'email',
].join(' ');

const STATE_KEY = 'google_drive_oauth_state';

function getClientId() {
  return (repoGetLocal(GOOGLE_CLIENT_ID_KEY) || '').trim() || DEFAULT_GOOGLE_CLIENT_ID;
}

export function driveSaveClientId() {
  const input = document.getElementById('drive-client-id-input');
  const id = (input?.value || '').trim();
  if (!id) return;
  repoSetLocal(GOOGLE_CLIENT_ID_KEY, id);
  driveShowUnlinked();
}

function redirectUri() {
  return window.location.origin + window.location.pathname;
}

function functionUrl() {
  /* Same Supabase project as Cloud Sync — Project URL + '/functions/v1/<name>' */
  return dbxGetAppKey().replace(/\/+$/, '') + '/functions/v1/google-drive';
}

async function callFunction(body) {
  const resp = await fetch(functionUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getAnonKey()}`,
      'apikey': getAnonKey(),
    },
    body: JSON.stringify({ ...body, pin: _adminPin }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `Request failed (${resp.status})`);
  return data;
}

function setStatus(text, type = 'ok') {
  const el = document.getElementById('drive-status-text');
  const icon = document.getElementById('drive-status-icon');
  if (el) el.textContent = text;
  if (icon) icon.textContent = type === 'ok' ? '✓' : type === 'error' ? '✕' : '⟳';
}

export function driveShowLinked(email) {
  document.getElementById('drive-state-locked')?.classList.add('hidden');
  document.getElementById('drive-state-unlinked')?.classList.add('hidden');
  document.getElementById('drive-state-linked')?.classList.remove('hidden');
  const acc = document.getElementById('drive-account-name');
  if (acc) acc.textContent = email || 'Connected';
}

export function driveShowUnlinked() {
  document.getElementById('drive-state-locked')?.classList.add('hidden');
  document.getElementById('drive-state-unlinked')?.classList.remove('hidden');
  document.getElementById('drive-state-linked')?.classList.add('hidden');
}

function driveShowLocked() {
  document.getElementById('drive-state-locked')?.classList.remove('hidden');
  document.getElementById('drive-state-unlinked')?.classList.add('hidden');
  document.getElementById('drive-state-linked')?.classList.add('hidden');
}

/* Button inside the locked state. On a correct PIN, reveals the real
   card and loads its live status; on a wrong one, stays locked. */
export async function driveUnlock() {
  const pin = prompt('Admin PIN required for Google Drive Backup:');
  if (pin === null) return;
  if (!checkAdminPin(pin)) { alert('Incorrect Admin PIN.'); return; }
  _adminPin = pin;
  await driveRefreshStatus();
}

export async function driveRefreshStatus() {
  try {
    const s = await callFunction({ action: 'status' });
    if (s.connected) {
      driveShowLinked(s.email);
      setStatus(s.lastBackupAt ? `Last backup: ${new Date(s.lastBackupAt).toLocaleString()}` : 'Connected — no backups yet', 'ok');
    } else {
      driveShowUnlinked();
    }
  } catch (err) {
    console.warn('[Drive] status check failed:', err.message);
    if (/unauthorized/i.test(err.message)) {
      /* Locally-entered PIN (e.g. the emergency master PIN) didn't
         match the real db.settings.adminPin the server checks —
         re-lock rather than show a card that can't actually do anything. */
      _adminPin = null;
      driveShowLocked();
      alert("That PIN isn't authorized for Google Drive Backup.");
    }
  }
}

/* Redirects to Google's consent screen. access_type=offline +
   prompt=consent is what forces a refresh_token back on every
   connect (not just the very first time — see the Edge Function's
   oauth_callback comment). */
export function driveConnectStart() {
  const clientId = getClientId();
  if (!clientId || clientId.startsWith('YOUR_GOOGLE_OAUTH_CLIENT_ID')) {
    alert('Set your Google OAuth Client ID first (paste it in the box below).');
    return;
  }
  const state = crypto.randomUUID();
  sessionStorage.setItem(STATE_KEY, state);
  /* Full-page redirect wipes the in-memory _adminPin — stash it (this
     tab only, cleared the moment driveInit() reads it back) so the
     return trip can still call oauth_callback without re-prompting. */
  sessionStorage.setItem(PIN_SESSION_KEY, _adminPin || '');

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', OAUTH_SCOPES);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  window.location.href = url.toString();
}

export async function driveBackupNow() {
  setStatus('Backing up…', 'busy');
  try {
    const r = await callFunction({ action: 'backup' });
    setStatus(`Backed up at ${new Date(r.backedUpAt).toLocaleTimeString()}`, 'ok');
  } catch (err) {
    console.error('[Drive] backup failed:', err);
    setStatus(`Backup failed: ${err.message.substring(0, 60)}`, 'error');
  }
}

export async function driveDisconnect() {
  if (!confirm('Disconnect Google Drive backup? Existing backup files in Drive are left as-is.')) return;
  try {
    await callFunction({ action: 'disconnect' });
    driveShowUnlinked();
  } catch (err) {
    alert('Failed to disconnect: ' + err.message);
  }
}

/* Runs once at boot (see components.js, alongside dbxInit()/authInit()).
   Finishes the OAuth redirect if we just came back from Google with a
   ?code=, then reflects current connection status either way. */
export async function driveInit() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');

  if (code) {
    const expectedState = sessionStorage.getItem(STATE_KEY);
    const stashedPin = sessionStorage.getItem(PIN_SESSION_KEY);
    sessionStorage.removeItem(STATE_KEY);
    sessionStorage.removeItem(PIN_SESSION_KEY);
    /* Strip ?code=&state= from the URL either way, so a page refresh
       never tries to redeem the same code twice. */
    window.history.replaceState({}, '', redirectUri());

    if (state && state === expectedState && stashedPin && checkAdminPin(stashedPin)) {
      _adminPin = stashedPin;
      setStatus('Finishing connection…', 'busy');
      try {
        const r = await callFunction({ action: 'oauth_callback', code, redirectUri: redirectUri() });
        driveShowLinked(r.email);
        setStatus('Connected', 'ok');
        return;
      } catch (err) {
        alert('Google Drive connection failed: ' + err.message);
      }
    }
  }

  /* Default boot state: locked. Nobody sees connection status, the
     linked email, or the backup/disconnect controls until driveUnlock()
     verifies the Admin PIN — no automatic status call before that. */
  driveShowLocked();
}

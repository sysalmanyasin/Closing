/* ═══════════════════════════════════════════════════════════════
   FLOOR 1 (Extension) — SUPABASE CLOUD SYNC ENGINE
   Client-side only, no OAuth — just a Project URL + anon key. Reads/
   writes via repoReplaceDB()/repoPersist() only.

   STORAGE MODEL — db.sheets / db.creditLedger / db.settings /
   db.activityLog are decomposed into real Postgres tables (see
   supabase/schema.sql) instead of one JSON blob file. Every function
   here still takes the FULL in-memory `db` object as input/output —
   nothing in state.js/actions.js/pages.js changed — this file is
   just the translation layer between that shape and four tables.

   REALTIME — a single channel subscribes to changes on all four
   tables and triggers a debounced pull, so other devices update
   within ~1s instead of only on tab-focus/reconnect.
═══════════════════════════════════════════════════════════════ */

import { repoGetLocal, repoRemoveLocal, repoReplaceDB, repoSetLocal } from './repository.js';
import { db, session, isSeedSettings } from './state.js';
import { buildCalendar, renderFinalSummaryCard, renderManifest } from './pages.js';
import { showAlert, showConfirm } from './notify.js';
import { refreshOpenLedgerFromSync } from './actions.js';
import { SUPA_URL_KEY, SUPA_ANON_KEY, getSupaUrl, getSupaAnonKey, getSupabaseClient, resetSupabaseClient } from './supabase-client.js';

/* ── CONFIGURATION ─────────────────────────────────────── */
/* URL/anon-key storage + the shared client itself now live in
   supabase-client.js so auth.js and this file use the exact same
   Supabase client/session instead of two independent ones — see
   that file's header comment for why that duplication was a bug. */

/* How many of this device's local db.activityLog entries have
   already been INSERTed into the activity_log table. Persisted so a
   page reload doesn't re-push (harmless, just noisy) duplicates. */
const SUPA_AL_PUSHED_KEY = 'supabase_al_pushed_count';

/* ── RETRY CONFIG ───────────────────────────────────────── */
const QUICK_RETRIES  = 3;
const QUICK_DELAY_MS = 5000;
const BACKOFF_DELAYS = [30000, 120000, 300000];

export function supaGetAppKey() { return getSupaUrl(); }
export function getAnonKey()    { return getSupaAnonKey(); }

/* ── STATE ──────────────────────────────────────────────── */
const supaState = {
  client:          null,  /* supabase-js client */
  channel:         null,  /* realtime channel */
  busy:            false,
  retryTimer:      null,
  backoffIndex:    0,
  quickRetryCount: 0,
  pullDebounce:    null,
  /* True only once a syncPullFromCloud() has completed WITHOUT
     throwing at least once this session, so we've actually seen what
     the cloud has for settings (or confirmed there's genuinely
     nothing there yet). db.settings starts life as a hardcoded
     default object (state.js) on any fresh/empty local storage —
     incognito, cleared storage, a brand-new device. persist() stamps
     db.settings._updatedAt on EVERY save (not just a Settings edit),
     so if something gets saved before the first pull has confirmed
     reality, syncPushToCloud() would previously blind-upsert those
     still-default values over real cloud settings — which is exactly
     what corrupted the settings row on 2026-08-27. Gating the push
     on this flag closes that hole without changing any other sync
     behavior (sheets/ledger/etc. still push immediately as before). */
  settingsHydrated: false,
  /* true while a save is waiting to reach the cloud (offline, or the
     last push failed). Drives the "Offline, will sync" / "Sync failed,
     tap to retry" chip and the automatic flush when the network is back. */
  pendingPush: false
};

/* Accessor for Actions (Floor 3) — see scheduleSyncPush() in
   actions.js — instead of it reaching into supaState directly. */
export function syncIsReady() { return !!supaState.client; }

/* ── UI HELPERS ─────────────────────────────────────────── */
/* Network check that is safe under the Node test stub (no navigator.onLine there). */
export function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/* Pure: turns a raw sync status into the short chip a cashier reads at a
   glance. States: ok → "Saved ✓", busy → "Syncing…", offline → "Offline,
   will sync", error → "Sync failed, tap to retry", warn → live updates off
   (saves still sync), info → any other message shown as-is. The full
   technical text stays available in `detail` (chip tooltip + Settings). */
export function syncChipFor(type, text, offline = false) {
  const raw = String(text || '');
  if(type === 'offline' || (offline && type === 'error')) {
    return { state: 'offline', icon: '⏸', label: 'Offline, will sync', detail: raw };
  }
  if(type === 'busy') return { state: 'busy', icon: '⟳', label: 'Syncing…', detail: raw };
  if(type === 'ok') {
    if(/^Synced/i.test(raw)) return { state: 'ok', icon: '☁', label: 'Saved ✓', detail: raw };
    return { state: 'info', icon: '☁', label: raw.length > 40 ? raw.substring(0, 38) + '…' : raw, detail: raw };
  }
  if(/^Live sync unavailable/i.test(raw)) {
    return { state: 'warn', icon: '!', label: 'Live updates off, saves still sync', detail: raw };
  }
  return { state: 'error', icon: '✕', label: 'Sync failed, tap to retry', detail: raw };
}

export function supaSetStatus(text, type = 'ok', spinner = false) {
  /* The Settings card has no "offline" style — show it as the calm amber one. */
  const lineType = type === 'offline' ? 'busy' : type;
  const line = document.getElementById('sync-status-line');
  const icon = document.getElementById('sync-status-icon');
  const msg  = document.getElementById('sync-status-text');
  if(line) {
    line.className = 'sync-status-line status-' + lineType;
    icon.innerHTML = spinner
      ? '<span class="sync-spinner">⟳</span>'
      : (lineType === 'ok' ? '✓' : lineType === 'error' ? '✕' : '⟳');
    msg.textContent = text;
  }
  const tb     = document.getElementById('sync-topbar');
  const tbIcon = document.getElementById('sync-tb-icon');
  const tbText = document.getElementById('sync-tb-text');
  if(tb) {
    const chip = syncChipFor(type, text, isOffline());
    tb.className = 'tb-show tb-' + chip.state;
    document.body.classList.add('topbar-on');
    tbIcon.innerHTML = chip.state === 'busy'
      ? '<span class="tb-spin">⟳</span>'
      : chip.icon;
    tbText.textContent = chip.label;
    tb.title = chip.detail ? chip.detail + ' — tap to sync now' : 'Tap to sync now';
  }
}

export function supaSetOffline() {
  supaSetStatus('Offline — changes are saved on this device and will sync when you reconnect', 'offline');
}

/* Tap handler for the status chip: retry what actually failed. */
export async function syncTopbarTap() {
  if(!supaState.client) {
    /* Never connected this session (or init failed) — try the connection again. */
    if(supaGetAppKey() && getAnonKey()) {
      if(isOffline()) { supaSetOffline(); return; }
      supaState.quickRetryCount = 0;
      supaState.backoffIndex    = 0;
      await supaInit();
    }
    return;
  }
  if(isOffline()) { supaSetOffline(); return; }
  if(supaState.pendingPush) await syncPushToCloud(true);
  await syncPullFromCloud(true);
}

export function supaSetBusy(busy) {
  supaState.busy = busy;
  const btnPull = document.getElementById('btn-pull');
  const btnPush = document.getElementById('btn-push');
  if(btnPull) btnPull.disabled = busy;
  if(btnPush) btnPush.disabled = busy;
}

export function supaShowLinked(label) {
  const u = document.getElementById('sync-state-unlinked');
  const l = document.getElementById('sync-state-linked');
  const a = document.getElementById('sync-account-name');
  if(u) u.classList.add('hidden');
  if(l) l.classList.remove('hidden');
  if(a) a.textContent = label || 'Connected';
}

export function supaShowUnlinked() {
  const u = document.getElementById('sync-state-unlinked');
  const l = document.getElementById('sync-state-linked');
  if(u) u.classList.remove('hidden');
  if(l) l.classList.add('hidden');
}

/* ── CREDENTIAL STORAGE ─────────────────────────────────────
   Project URL + anon key are the whole trust model — anyone who has
   both can read/write. Keep the anon key off public repos/
   screenshots. ─────────────────────────────────────────────── */
export function supaClearToken() {
  repoRemoveLocal(SUPA_ANON_KEY);
  /* SUPA_URL_KEY intentionally NOT cleared — the user keeps their
     project link even after disconnecting the anon key. */
}

export function supaShowKeyError(msg) {
  const el = document.getElementById('supa-key-error');
  if(el) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; }
}

/* Reads the two connect-card inputs (Project URL + anon key) and
   connects immediately — no OAuth redirect needed for Supabase. */
export function supaSaveAppKey() {
  const urlInp  = document.getElementById('supa-url-input');
  const keyInp  = document.getElementById('supa-anon-key-input');
  const url     = (urlInp?.value || '').trim().replace(/\/+$/, '');
  const anonKey = (keyInp?.value || '').trim();
  if(!url || !anonKey) { supaShowKeyError('Please paste both the Project URL and the anon key.'); return; }
  if(!/^https:\/\/.+\.supabase\.co$/.test(url)) {
    supaShowKeyError('That doesn\'t look like a Supabase Project URL (should end in .supabase.co).');
    return;
  }
  repoSetLocal(SUPA_URL_KEY, url);
  repoSetLocal(SUPA_ANON_KEY, anonKey);
  supaShowKeyError('');
  supaInit();
}

/* Kept so index.html doesn't need to drop the "Change key" link
   wiring — just re-shows the setup form. */
export function supaShowConnectStep() {
  document.getElementById('sync-setup-step')?.classList.remove('hidden');
  document.getElementById('sync-connect-step')?.classList.add('hidden');
}
export async function supaAuthStart() {
  /* No OAuth step for Supabase — Save & Connect (supaSaveAppKey) does
     the whole job. Kept as a no-op alias in case anything still calls it. */
  supaShowConnectStep();
}

export function supaClearAppKey() {
  repoRemoveLocal(SUPA_URL_KEY);
  supaClearToken();
  _teardownClient();
  supaShowUnlinked();
  document.getElementById('sync-setup-step')?.classList.remove('hidden');
  document.getElementById('sync-connect-step')?.classList.add('hidden');
}

function _teardownClient() {
  if(supaState.channel) {
    try { supaState.client?.removeChannel(supaState.channel); } catch(e) { /* ignore */ }
  }
  supaState.client  = null;
  supaState.channel = null;
  supaState.settingsHydrated = false; /* require a fresh confirmed pull before trusting local settings again */
  resetSupabaseClient(); /* force a fresh client (and session) next getSupabaseClient() call */
}

/* ── CLIENT INIT ──────────────────────────────────────────
   Runs on every app load and on retry. Builds the client, does an
   initial pull, and opens the realtime channel. ─────────────────── */
export async function supaInit() {
  const url     = supaGetAppKey();
  const anonKey = getAnonKey();

  const urlInput = document.getElementById('supa-url-input');
  if(urlInput && url) urlInput.value = url;
  const keyInput = document.getElementById('supa-anon-key-input');
  if(keyInput && anonKey) keyInput.value = anonKey;

  if(!url || !anonKey) { supaShowUnlinked(); return; }

  try {
    if(typeof window.supabase?.createClient !== 'function') {
      supaSetStatus('Supabase library failed to load — check your connection.', 'error');
      return;
    }
    /* Shared with auth.js — one client, one session. See
       supabase-client.js header for why this used to be two
       independent clients and what that broke. */
    supaState.client = getSupabaseClient({
      realtime: { params: { eventsPerSecond: 5 } }
    });
    if(!supaState.client) {
      supaSetStatus('Supabase library failed to load — check your connection.', 'error');
      return;
    }

    supaShowLinked('Connected');
    supaSetStatus('Checking for updates…', 'busy', true);

    await syncPullFromCloud(false);
    if(supaState.pendingPush) syncPushToCloud(false).catch(() => {});

    supaState.backoffIndex = 0;
    if(supaState.retryTimer) { clearTimeout(supaState.retryTimer); supaState.retryTimer = null; }

    _openRealtimeChannel();

  } catch(err) {
    console.warn('[Supabase] Init failed:', err);
    supaSetStatus('Supabase unreachable — retrying…', 'error');
    supaScheduleRetry();
  }
}

/* ── REALTIME ─────────────────────────────────────────────
   One channel, four tables. Any change anywhere triggers a debounced
   pull rather than reasoning about the individual payload — the
   existing conflict logic in syncPullFromCloud() already knows how
   to merge safely, so we just ask it to run again. */
function _openRealtimeChannel() {
  if(!supaState.client || supaState.channel) return;
  const channel = supaState.client.channel('closing-app-sync');
  ['settings', 'sheets', 'credit_ledger', 'activity_log', 'deleted_records'].forEach(table => {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
      clearTimeout(supaState.pullDebounce);
      supaState.pullDebounce = setTimeout(() => {
        syncPullFromCloud(false).catch(() => {});
      }, 800);
    });
  });
  channel.subscribe((status, err) => {
    console.log('[Supabase Realtime] channel status:', status, err || '');
    if(status === 'SUBSCRIBED') {
      supaSetStatus('Live sync connected', 'ok');
    } else if(status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      supaSetStatus('Live sync unavailable — ' + (err?.message || status) + ' (still syncing on save/reload)', 'error');
      supaState.channel = null; /* let a future supaHealConnection() retry cleanly */
    } else if(status === 'CLOSED') {
      supaState.channel = null;
    }
  });
  supaState.channel = channel;
}

/* ── RETRY SCHEDULER ────────────────────────────────────── */
export function supaScheduleRetry() {
  if(supaState.retryTimer) clearTimeout(supaState.retryTimer);
  let delay;
  if(supaState.quickRetryCount < QUICK_RETRIES) {
    delay = QUICK_DELAY_MS;
    supaState.quickRetryCount++;
  } else {
    delay = BACKOFF_DELAYS[Math.min(supaState.backoffIndex, BACKOFF_DELAYS.length - 1)];
    supaState.backoffIndex++;
  }
  supaState.retryTimer = setTimeout(() => {
    supaState.retryTimer = null;
    if(supaGetAppKey() && getAnonKey()) supaInit();
  }, delay);
}

function supaHealConnection(reason) {
  if(!supaGetAppKey() || !getAnonKey() || supaState.client) return;
  console.log(`[Supabase] ${reason} — healing connection…`);
  if(supaState.retryTimer) { clearTimeout(supaState.retryTimer); supaState.retryTimer = null; }
  supaState.quickRetryCount = 0;
  supaState.backoffIndex    = 0;
  supaInit();
}
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'visible') supaHealConnection('Tab focused');
});
window.addEventListener('online', () => {
  if(supaState.client) {
    if(supaState.pendingPush) syncPushToCloud(false).catch(() => {});
  } else {
    supaHealConnection('Network back online');
  }
});
window.addEventListener('offline', () => {
  if(supaGetAppKey() && getAnonKey()) supaSetOffline();
});
window.addEventListener('pageshow', (e) => {
  if(e.persisted) supaHealConnection('Page restored from bfcache');
});

/* ── EXPORT / IMPORT CONNECTION (move credentials to another
   device via a copy-pasted token) ───────────────────────────────── */
export function supaExportConnection() {
  const url = supaGetAppKey(), anonKey = getAnonKey();
  if(!url || !anonKey) { showAlert('No active connection to export.'); return; }
  const payload = btoa(JSON.stringify({ url, anonKey }));
  navigator.clipboard.writeText(payload).then(() => {
    supaSetStatus('Connection token copied! Paste it on your other device.', 'ok');
  }).catch(() => {
    prompt('Copy this connection token:', payload);
  });
}

export function supaShowImport() {
  const box = document.getElementById('sync-import-box');
  if(box) box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

export async function supaImportConnection() {
  const raw = (document.getElementById('sync-import-input')?.value || '').trim();
  await _applyImportToken(raw);
}
export async function supaImportConnectionUnlinked() {
  const raw = (document.getElementById('sync-import-input-unlinked')?.value || '').trim();
  await _applyImportToken(raw);
}
async function _applyImportToken(raw) {
  if(!raw) { showAlert('Please paste a connection token first.'); return; }
  let parsed;
  try { parsed = JSON.parse(atob(raw)); }
  catch(e) { showAlert('Invalid token — please copy it again from the source device.'); return; }
  const { url, anonKey } = parsed;
  if(!url || !anonKey) { showAlert('Token is incomplete. Please export again from the source device.'); return; }
  repoSetLocal(SUPA_URL_KEY, url);
  repoSetLocal(SUPA_ANON_KEY, anonKey);
  const i1 = document.getElementById('sync-import-input');
  const i2 = document.getElementById('sync-import-input-unlinked');
  if(i1) i1.value = '';
  if(i2) i2.value = '';
  const box = document.getElementById('sync-import-box');
  if(box) box.style.display = 'none';
  supaState.quickRetryCount = 0;
  supaState.backoffIndex    = 0;
  await supaInit();
}

/* ── DISCONNECT ─────────────────────────────────────────── */
export async function supaDisconnect() {
  if(!await showConfirm('Disconnect Supabase sync?\n\nYour local data will not be deleted. You can re-link at any time.', { tone: 'warn', confirmLabel: 'Disconnect' })) return;
  supaClearToken();
  _teardownClient();
  supaShowUnlinked();
}

/* ── PUSH: Local → Cloud ────────────────────────────────────
   sheets / credit_ledger / settings are upserted wholesale each push
   (cheap, idempotent, same "latest wins" semantics the blob had).
   activity_log is APPEND-ONLY — only rows not yet pushed by this
   device are inserted, tracked by a locally-persisted counter. ──── */
export async function syncPushToCloud(manual = false) {
  if(!supaState.client) return false;
  if(supaState.busy && !manual) return false;
  if(isOffline()) {
    /* No point trying — keep the save pending and say so plainly. */
    supaState.pendingPush = true;
    supaSetOffline();
    return false;
  }
  supaSetBusy(true);
  supaSetStatus('Syncing to cloud…', 'busy', true);

  try {
    const sheetRows = Object.entries(db.sheets || {}).map(([key, rec]) => ({
      key,
      date: key.split('_')[0],
      shift: key.split('_').slice(1).join('_'),
      draft: !!rec.draft, data: rec, updated_at: new Date().toISOString()
    }));
    if(sheetRows.length) {
      const { error } = await supaState.client.from('sheets').upsert(sheetRows, { onConflict: 'key' });
      if(error) throw error;
    }

    const clRows = (db.creditLedger || []).map(rec => ({
      key: rec.key, date: rec.date, shift: rec.shift, data: rec,
      saved_at: rec.savedAt ? new Date(rec.savedAt).toISOString() : null,
      updated_at: new Date().toISOString()
    }));
    if(clRows.length) {
      const { error } = await supaState.client.from('credit_ledger').upsert(clRows, { onConflict: 'key' });
      if(error) throw error;
    }

    /* Only push settings once we've actually confirmed (via a
       successful pull) what the cloud currently has — see
       settingsHydrated's definition above for why. Everything else
       in this function (sheets, credit_ledger, tombstones, activity
       log) is unaffected and still pushes immediately as before;
       this guard is deliberately scoped to settings only, since that
       was the only table a stale local default could silently
       clobber wholesale. */
    if(supaState.settingsHydrated && !isSeedSettings(db.settings)) {
      const { error: setErr } = await supaState.client.from('settings').upsert(
        { id: 1, data: db.settings || {}, updated_at: db.settings?._updatedAt || 0 },
        { onConflict: 'id' }
      );
      if(setErr) throw setErr;
    }

    /* Tombstones: keys deleted locally. Upserted (never appended blindly,
       so re-pushing after a reload doesn't duplicate rows) to a small
       `deleted_records` table, THEN best-effort hard-deleted from the
       real tables. The upsert happens first and unconditionally — even
       if the hard-delete below fails or is blocked by RLS, the tombstone
       still lets every pull (this device's and everyone else's) filter
       the record out, which is what actually prevents resurrection. */
    /* Un-tombstone: any key that's currently a real sheet on this
       device was, by definition, deliberately (re)saved — so if it
       was ever deleted before (this device or another), that OLD
       cloud tombstone must be cleared now, or the very next pull
       would immediately wipe out the save that's just about to
       happen below. actions.js already drops the LOCAL db.deletedKeys
       entry when a key is re-saved, but the cloud row survives until
       we explicitly delete it here — best-effort, same as the
       hard-delete calls below. */
    const liveKeys = Object.keys(db.sheets || {});
    if(liveKeys.length) {
      try { await supaState.client.from('deleted_records').delete().in('key', liveKeys); } catch(e) { /* best-effort */ }
    }

    const delRows = (db.deletedKeys || []).map(d => ({
      key: d.key, deleted_at: new Date(d.deletedAt).toISOString()
    }));
    if(delRows.length) {
      const { error } = await supaState.client.from('deleted_records').upsert(delRows, { onConflict: 'key' });
      if(error) throw error;
      const keys = delRows.map(r => r.key);
      /* Best-effort — ignore errors here (e.g. no DELETE policy yet);
         the tombstone above is what actually guarantees correctness. */
      try { await supaState.client.from('sheets').delete().in('key', keys); } catch(e) { /* tombstone still covers it */ }
      try { await supaState.client.from('credit_ledger').delete().in('key', keys); } catch(e) { /* tombstone still covers it */ }
    }

    /* Activity log: only push entries this device hasn't pushed yet */
    const alAll = Array.isArray(db.activityLog) ? db.activityLog : [];
    const pushedCount = parseInt(repoGetLocal(SUPA_AL_PUSHED_KEY) || '0', 10);
    const newEntries = alAll.slice(pushedCount);
    if(newEntries.length) {
      const alRows = newEntries.map(e => ({ ts: e.ts, actor: e.actor, key: e.key, action: e.action, changes: e.changes }));
      const { error } = await supaState.client.from('activity_log').insert(alRows);
      if(error) throw error;
      repoSetLocal(SUPA_AL_PUSHED_KEY, String(alAll.length));
    }

    const ts = new Date().toLocaleTimeString('en-PK');
    supaState.pendingPush = false;
    supaSetStatus(`Synced at ${ts}`, 'ok');
    if(manual) {
      const statusEl = document.getElementById('sync-status-line');
      if(statusEl) {
        statusEl.style.background = 'rgba(74,222,128,.08)';
        setTimeout(() => { if(statusEl) statusEl.style.background = ''; }, 1200);
      }
    }
    return true;
  } catch(err) {
    console.error('[Supabase] Push failed:', err);
    supaState.pendingPush = true;
    supaSetStatus(`Upload failed: ${(err?.message || 'Unknown error').substring(0,50)}`, 'error');
    return false;
  } finally {
    supaSetBusy(false);
  }
}

/* ── VERIFIED CLOSE: upload + confirm the ntfy notification ─────────
   "Save & Close This Shift" must not finalize unless (a) the closing
   reached the cloud and (b) the closing-ntfy-notify call it triggers
   was confirmed successful. The notification itself is fired by the DB
   trigger notify_admin_shift_saved() (net.http_post), so the app learns
   the outcome through the RPC public.closing_notify_status(p_key) —
   see supabase/closing_notify_ack.sql, which must be applied first.

   Order matters: the FINAL record is upserted on its own (before any
   local commit) so a failure leaves this device untouched; if the
   notification is not confirmed the cloud row is put back to what it
   was (or a draft) so a failed close never leaves a "saved" closing
   behind. The caller then commits the very same record locally, so the
   later wholesale push carries identical data and the trigger's
   "data changed" condition does not re-notify. */
export const NOTIFY_ACK_TIMEOUT_MS  = 30000;
export const NOTIFY_ACK_INTERVAL_MS = 1500;

/* Pure-ish poller (fetchStatus + sleep injected so it is unit-tested).
   fetchStatus() → { log_id, status_code, ok, error } | null.
   Resolves { ok:true } | { ok:false, message }. */
export async function _waitForNotifyAck(fetchStatus, baselineId, opts = {}) {
  const timeoutMs  = opts.timeoutMs  ?? NOTIFY_ACK_TIMEOUT_MS;
  const intervalMs = opts.intervalMs ?? NOTIFY_ACK_INTERVAL_MS;
  const sleep = opts.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  let waited = 0;
  for(;;) {
    const st = await fetchStatus();
    if(st && Number(st.log_id) > baselineId && st.status_code != null) {
      if(st.ok) return { ok: true };
      return { ok: false, message: `The ntfy notification failed (server replied ${st.status_code}${st.error ? ': ' + String(st.error).substring(0, 80) : ''}).` };
    }
    if(waited >= timeoutMs) {
      return { ok: false, message: 'The ntfy notification was not confirmed in time.' };
    }
    await sleep(intervalMs);
    waited += intervalMs;
  }
}

function _notifyRpcMessage(err) {
  const m = String(err?.message || err || 'unknown error');
  if(/could not find the function|does not exist|PGRST202|42883/i.test(m + ' ' + (err?.code || ''))) {
    return 'The notification check is not installed on the server (run supabase/closing_notify_ack.sql once).';
  }
  return `Could not check the notification status (${m.substring(0, 80)}).`;
}

export async function syncSaveClosingVerified(key, record, previous, opts = {}) {
  const client = supaState.client;
  if(!client) return { ok: false, message: 'Cloud sync is not connected on this device.' };
  if(isOffline()) return { ok: false, message: 'This device is offline.' };

  const statusOf = async () => {
    const { data, error } = await client.rpc('closing_notify_status', { p_key: key });
    if(error) throw error;
    return data || null;
  };

  let baselineId = 0;
  try {
    const base = await statusOf();
    baselineId = Number(base?.log_id) || 0;
  } catch(err) {
    return { ok: false, message: _notifyRpcMessage(err) };
  }

  const row = (rec, draft) => ({
    key, date: key.split('_')[0], shift: key.split('_').slice(1).join('_'),
    draft, data: rec, updated_at: new Date().toISOString()
  });

  try {
    const { error } = await client.from('sheets').upsert(row(record, false), { onConflict: 'key' });
    if(error) throw error;
  } catch(err) {
    return { ok: false, message: `The closing could not be uploaded (${String(err?.message || err).substring(0, 80)}).` };
  }

  let ack;
  try {
    ack = await _waitForNotifyAck(statusOf, baselineId, opts);
  } catch(err) {
    ack = { ok: false, message: _notifyRpcMessage(err) };
  }
  if(ack.ok) return { ok: true };

  /* Not confirmed → put the cloud row back (previous record, or this
     one as a draft) so no finalized-but-unnotified closing is left. */
  try {
    const back = previous || { ...record, draft: true, locked: false, savedAt: undefined };
    await client.from('sheets').upsert(row(back, !!back.draft), { onConflict: 'key' });
  } catch(e) { console.error('[Supabase] Could not revert closing after failed notify:', e); }
  return { ok: false, message: ack.message };
}

/* Settings merge (pure, unit-tested). Decides whether the cloud's or this
   device's settings survive a pull.

   HARD RULE: factory-default settings (a wiped browser, new phone,
   reinstalled PWA) can NEVER overwrite real settings, whatever their
   timestamp says. Before this rule existed, every save stamped
   settings._updatedAt = now, so a wiped device's defaults looked newer
   than the cloud's real settings, won this merge, and were pushed up —
   resetting every inventory price/name/group (2026-08-27 and again
   2026-09-28). */
export function _mergeSettings(local, cloud) {
  if(!cloud) return { settings: local, keptLocal: !isSeedSettings(local) }; /* nothing in cloud yet */
  if(!local) return { settings: cloud, keptLocal: false };
  if(isSeedSettings(local) && !isSeedSettings(cloud)) return { settings: cloud, keptLocal: false };
  if((local._updatedAt || 0) > (cloud._updatedAt || 0)) return { settings: local, keptLocal: true };
  return { settings: cloud, keptLocal: false };
}

/* ── PULL: Cloud → Local ─────────────────────────────────────
   Reassembles the same `{settings, sheets, creditLedger,
   activityLog, deletedKeys}` shape state.js/actions.js already
   expect.

   MERGE STRATEGY — per-record last-write-wins, NOT the old "cloud
   wins whenever its sheet COUNT is >= local's" rule. The count-based
   rule looked plausible but silently threw away data in ordinary
   use: editing an ALREADY-saved sheet (or re-saving a shift so its
   credit_ledger snapshot gets replaced) never changes the sheet
   COUNT, so a same-count/higher-count pull would wholesale-replace
   db.sheets/db.creditLedger with the older cloud copy and your just-
   made, not-yet-pushed edit would vanish with no error — exactly the
   kind of thing that must never happen to closing/cash data. The old
   "local count is higher → just push" branch had the mirror problem:
   it never actually pulled anything down, so any record that existed
   ONLY in the cloud (added by another device) could get permanently
   stranded — invisible on this device forever — as long as this
   device's local count stayed higher.
   Every sheet/credit-ledger key is now compared individually using
   its own `_updatedAt` (sheets) / `savedAt` (credit ledger, always
   set — these only exist for non-draft saves) timestamp, and
   whichever side is newer wins FOR THAT KEY ONLY. Settings keeps its
   existing single-timestamp rule (it's one object, not a keyed
   collection). Activity log is append-only, so it's a straight
   union instead of a pick-one-side comparison. */
export function _mergeByKey(localMap, cloudMap, tsOf, isDraft) {
  const merged = {};
  let localWonSomething = false;
  /* Keys where the CLOUD side won and actually differed from what
     was already stored locally — i.e. a real incoming change, not
     just this device re-confirming its own data. Callers use this to
     know which records need their on-screen view refreshed right now
     rather than silently updated in memory. */
  const cloudWonKeys = [];
  const allKeys = new Set([...Object.keys(localMap), ...Object.keys(cloudMap)]);
  allKeys.forEach(key => {
    const l = localMap[key], c = cloudMap[key];
    if(l && !c)      { merged[key] = l; localWonSomething = true; }
    else if(!l && c) { merged[key] = c; cloudWonKeys.push(key); }
    else {
      /* A finalized record (draft: false — an actual Shift/Final
         Closing save) must ALWAYS beat a draft, regardless of which
         one has the later raw timestamp. Without this, a device that
         still has the sheet open keeps autosaving a draft every 3s
         (actions.js scheduleAutoSave), and that draft's _updatedAt
         can easily land AFTER another device's genuine save landed —
         timestamp comparison alone would then let the draft win the
         merge and get pushed straight back to the cloud, silently
         reverting someone else's just-finished closing back to a
         draft. isDraft is only passed for sheets; credit_ledger rows
         are never drafts (see savedAt comment above), so for that
         merge lIsDraft/cIsDraft are always false/false and this
         branch falls straight through to the normal timestamp rule
         below — no behavior change there. */
      const lIsDraft = isDraft ? !!isDraft(l) : false;
      const cIsDraft = isDraft ? !!isDraft(c) : false;
      if(lIsDraft !== cIsDraft) {
        if(!lIsDraft) { merged[key] = l; localWonSomething = true; }
        else          { merged[key] = c; cloudWonKeys.push(key); }
        return;
      }
      const lt = tsOf(l) || 0, ct = tsOf(c) || 0;
      if(lt > ct) { merged[key] = l; localWonSomething = true; }
      else        { merged[key] = c; if(ct > lt) cloudWonKeys.push(key); }
    }
  });
  return { merged, localWonSomething, cloudWonKeys };
}

export async function syncPullFromCloud(_manual = false) {
  if(!supaState.client) return;
  supaSetBusy(true);
  supaSetStatus('Checking for updates…', 'busy', true);

  try {
    const [sheetsRes, clRes, settingsRes, alRes, delRes] = await Promise.all([
      supaState.client.from('sheets').select('key, data'),
      supaState.client.from('credit_ledger').select('key, data'),
      supaState.client.from('settings').select('data, updated_at').eq('id', 1).maybeSingle(),
      supaState.client.from('activity_log').select('ts, actor, key, action, changes').order('ts', { ascending: true }),
      supaState.client.from('deleted_records').select('key, deleted_at')
    ]);
    if(sheetsRes.error) throw sheetsRes.error;
    if(clRes.error) throw clRes.error;
    if(settingsRes.error) throw settingsRes.error;
    if(alRes.error) throw alRes.error;
    /* deleted_records is a newer table — if it hasn't been created yet
       in this project, treat "missing table" as "no tombstones" rather
       than failing the whole pull, so nothing breaks before the SQL
       migration has been run. */
    if(delRes.error && delRes.error.code !== '42P01') throw delRes.error;

    /* Union of cloud tombstones and any not-yet-pushed local ones —
       covers the case where this device deleted something while
       offline and hasn't successfully pushed the tombstone yet. */
    const tombstones = new Map((delRes.data || []).map(r => [r.key, r.deleted_at]));
    (db.deletedKeys || []).forEach(d => {
      if(!tombstones.has(d.key)) tombstones.set(d.key, new Date(d.deletedAt).toISOString());
    });

    const cloudSheetsRaw = Object.fromEntries((sheetsRes.data || []).filter(r => !tombstones.has(r.key)).map(r => [r.key, r.data]));
    const cloudCLRaw     = Object.fromEntries((clRes.data || []).filter(r => !tombstones.has(r.key)).map(r => [r.key, r.data]));
    const localSheets     = { ...(db.sheets || {}) };
    const localCL         = Object.fromEntries((db.creditLedger || []).map(r => [r.key, r]));
    tombstones.forEach((_v, key) => { delete localSheets[key]; delete localCL[key]; });

    const sheetMerge = _mergeByKey(localSheets, cloudSheetsRaw, r => r._updatedAt || r.savedAt || 0, r => !!r.draft);
    const clMerge     = _mergeByKey(localCL, cloudCLRaw, r => r.savedAt || 0);

    /* Activity log: append-only, so union by identity (ts+actor+key+action)
       rather than picking one side — a not-yet-pushed local entry must
       never be discarded just because a pull happened to land first. */
    const localAl  = Array.isArray(db.activityLog) ? db.activityLog : [];
    const cloudAl  = alRes.data || [];
    const alPushedCount = parseInt(repoGetLocal(SUPA_AL_PUSHED_KEY) || '0', 10);
    const unpushedLocalAl = localAl.slice(alPushedCount);
    const mergedAl = cloudAl.concat(unpushedLocalAl);

    const cloudDb = {
      settings:     settingsRes.data?.data || null,
      sheets:       sheetMerge.merged,
      creditLedger: Object.values(clMerge.merged),
      activityLog:  mergedAl,
      deletedKeys:  Array.from(tombstones.entries()).map(([key, deleted_at]) => ({ key, deletedAt: new Date(deleted_at).getTime() }))
    };

    const settingsMerge = _mergeSettings(db.settings, cloudDb.settings);
    cloudDb.settings = settingsMerge.settings;
    const keptLocalSettings = settingsMerge.keptLocal;

    /* We've now genuinely seen what the cloud has (or confirmed it's
       empty) — from here on db.settings can be trusted enough to
       push. See settingsHydrated's definition for the full story. */
    supaState.settingsHydrated = true;

    repoReplaceDB(cloudDb);
    /* Only entries that actually came back FROM the cloud are "known
       pushed" — the unpushed local tail we just re-appended above is
       still pending, so the next push must still send it. */
    repoSetLocal(SUPA_AL_PUSHED_KEY, String(cloudAl.length));

    buildCalendar();
    renderManifest();
    renderFinalSummaryCard();
    const ts = new Date().toLocaleTimeString('en-PK');
    const recordCount = Object.keys(cloudDb.sheets).length;
    supaSetStatus(`Synced at ${ts} (${recordCount} records)`, 'ok');

    /* If the shift the user has open right now was just overwritten by
       a NEWER cloud version that's actually saved (draft: false —
       either a plain Shift Closing or a Final Closing), reflect that
       immediately on screen instead of leaving the open ledger showing
       stale data until the person navigates away and back. A draft
       arriving from elsewhere is left alone here — only a genuine save
       forces the open view to update, so an in-progress edit is never
       silently interrupted by someone else's unfinished draft. */
    if(session.activeKey && sheetMerge.cloudWonKeys.includes(session.activeKey)) {
      const nowSaved = cloudDb.sheets[session.activeKey];
      if(nowSaved && nowSaved.draft === false) {
        refreshOpenLedgerFromSync(session.activeKey);
      }
    }

    /* If local had anything the merge kept (an unpushed edit, a
       record cloud didn't have yet, a pending tombstone, unpushed
       settings, or unpushed log lines), push it back up now so the
       cloud — and every other device — converges on the same state. */
    if(sheetMerge.localWonSomething || clMerge.localWonSomething || keptLocalSettings || unpushedLocalAl.length || (db.deletedKeys || []).length) {
      await syncPushToCloud(false);
    }

  } catch(err) {
    console.error('[Supabase] Pull failed:', err);
    supaSetStatus(`Sync error: ${(err?.message || 'Network error').substring(0,50)}`, 'error');
    supaScheduleRetry();
  } finally {
    supaSetBusy(false);
  }
}

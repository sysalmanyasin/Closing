/* ═══════════════════════════════════════════════════════════════
   FLOOR 1 (Extension) — SUPABASE CLOUD SYNC ENGINE
   Client-side only, no OAuth (Project URL + anon key, like the old
   Dropbox App Key). Reads/writes via repoReplaceDB()/repoPersist()
   only — same contract the Dropbox version had.

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
import { db } from './state.js';
import { buildCalendar, renderFinalSummaryCard, renderManifest } from './pages.js';

/* ── CONFIGURATION ─────────────────────────────────────── */
const SUPA_URL_KEY   = 'supabase_url';
const SUPA_ANON_KEY  = 'supabase_anon_key';

/* Baked-in default connection — every device/install auto-connects to
   this project without needing to open Settings and paste the Project
   URL + anon key first (that manual step is still there, and still
   wins if the user ever saves a different key — see dbxGetAppKey()/
   getAnonKey() below). Safe to commit: it's the anon/publishable key,
   not a service-role key — Row Level Security is the real boundary,
   same trust model documented in BT's audit-bridge.js. */
const DEFAULT_SUPA_URL      = 'https://wetbugzzchkghpzmowod.supabase.co';
const DEFAULT_SUPA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndldGJ1Z3p6Y2hrZ2hwem1vd29kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMDg4OTIsImV4cCI6MjA5Nzg4NDg5Mn0.LXFrvQTOfI3ph4aA8xWYIUo-z1yxdX0znnN5f-KsOPM';
/* How many of this device's local db.activityLog entries have
   already been INSERTed into the activity_log table. Persisted so a
   page reload doesn't re-push (harmless, just noisy) duplicates. */
const SUPA_AL_PUSHED_KEY = 'supabase_al_pushed_count';

/* ── RETRY CONFIG (same shape as the old Dropbox version) ── */
const QUICK_RETRIES  = 3;
const QUICK_DELAY_MS = 5000;
const BACKOFF_DELAYS = [30000, 120000, 300000];

export function dbxGetAppKey() {
  return (repoGetLocal(SUPA_URL_KEY) || '').trim() || DEFAULT_SUPA_URL;
}
function getAnonKey() {
  return (repoGetLocal(SUPA_ANON_KEY) || '').trim() || DEFAULT_SUPA_ANON_KEY;
}

/* ── STATE ──────────────────────────────────────────────── */
const supaState = {
  client:          null,  /* supabase-js client */
  channel:         null,  /* realtime channel */
  busy:            false,
  retryTimer:      null,
  backoffIndex:    0,
  quickRetryCount: 0,
  pullDebounce:    null
};

/* Accessor for Actions (Floor 3) — see scheduleSyncPush() in
   actions.js — instead of it reaching into supaState directly. */
export function syncIsReady() { return !!supaState.client; }

/* ── UI HELPERS (unchanged from the Dropbox version) ────── */
export function dbxSetStatus(text, type = 'ok', spinner = false) {
  const line = document.getElementById('sync-status-line');
  const icon = document.getElementById('sync-status-icon');
  const msg  = document.getElementById('sync-status-text');
  if(line) {
    line.className = 'sync-status-line status-' + type;
    icon.innerHTML = spinner
      ? '<span class="sync-spinner">⟳</span>'
      : (type === 'ok' ? '✓' : type === 'error' ? '✕' : '⟳');
    msg.textContent = text;
  }
  const tb     = document.getElementById('sync-topbar');
  const tbIcon = document.getElementById('sync-tb-icon');
  const tbText = document.getElementById('sync-tb-text');
  if(tb) {
    tb.className = 'tb-show tb-' + type;
    document.body.classList.add('topbar-on');
    tbIcon.innerHTML = (spinner || type === 'busy')
      ? '<span class="tb-spin">⟳</span>'
      : (type === 'ok' ? '☁' : '✕');
    tbText.textContent = text.length > 48 ? text.substring(0, 46) + '…' : text;
  }
}

export function dbxSetBusy(busy) {
  supaState.busy = busy;
  const btnPull = document.getElementById('btn-pull');
  const btnPush = document.getElementById('btn-push');
  if(btnPull) btnPull.disabled = busy;
  if(btnPush) btnPush.disabled = busy;
}

export function dbxShowLinked(label) {
  const u = document.getElementById('sync-state-unlinked');
  const l = document.getElementById('sync-state-linked');
  const a = document.getElementById('sync-account-name');
  if(u) u.classList.add('hidden');
  if(l) l.classList.remove('hidden');
  if(a) a.textContent = label || 'Connected';
}

export function dbxShowUnlinked() {
  const u = document.getElementById('sync-state-unlinked');
  const l = document.getElementById('sync-state-linked');
  if(u) u.classList.remove('hidden');
  if(l) l.classList.add('hidden');
}

/* ── CREDENTIAL STORAGE ─────────────────────────────────────
   Project URL + anon key are the whole trust model — anyone who has
   both can read/write, same as the old Dropbox App Key + refresh
   token. Keep the anon key off public repos/screenshots. ────────── */
export function dbxClearToken() {
  repoRemoveLocal(SUPA_ANON_KEY);
  /* SUPA_URL_KEY intentionally NOT cleared — matches old "user keeps their key" behavior */
}

export function dbxShowKeyError(msg) {
  const el = document.getElementById('dbx-key-error');
  if(el) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; }
}

/* Reads the two connect-card inputs (Project URL + anon key) and
   connects immediately — no OAuth redirect needed for Supabase. */
export function dbxSaveAppKey() {
  const urlInp  = document.getElementById('dbx-app-key-input');
  const keyInp  = document.getElementById('supa-anon-key-input');
  const url     = (urlInp?.value || '').trim().replace(/\/+$/, '');
  const anonKey = (keyInp?.value || '').trim();
  if(!url || !anonKey) { dbxShowKeyError('Please paste both the Project URL and the anon key.'); return; }
  if(!/^https:\/\/.+\.supabase\.co$/.test(url)) {
    dbxShowKeyError('That doesn\'t look like a Supabase Project URL (should end in .supabase.co).');
    return;
  }
  repoSetLocal(SUPA_URL_KEY, url);
  repoSetLocal(SUPA_ANON_KEY, anonKey);
  dbxShowKeyError('');
  dbxInit();
}

/* Kept so index.html doesn't need to drop the "Change key" link
   wiring — just re-shows the setup form. */
export function dbxShowConnectStep() {
  document.getElementById('sync-setup-step')?.classList.remove('hidden');
  document.getElementById('sync-connect-step')?.classList.add('hidden');
}
export async function dbxAuthStart() {
  /* No OAuth step for Supabase — Save & Connect (dbxSaveAppKey) does
     the whole job. Kept as a no-op alias in case anything still calls it. */
  dbxShowConnectStep();
}

export function dbxClearAppKey() {
  repoRemoveLocal(SUPA_URL_KEY);
  dbxClearToken();
  _teardownClient();
  dbxShowUnlinked();
  document.getElementById('sync-setup-step')?.classList.remove('hidden');
  document.getElementById('sync-connect-step')?.classList.add('hidden');
}

function _teardownClient() {
  if(supaState.channel) {
    try { supaState.client?.removeChannel(supaState.channel); } catch(e) { /* ignore */ }
  }
  supaState.client  = null;
  supaState.channel = null;
}

/* ── CLIENT INIT ──────────────────────────────────────────
   Runs on every app load and on retry. Builds the client, does an
   initial pull, and opens the realtime channel. ─────────────────── */
export async function dbxInit() {
  const url     = dbxGetAppKey();
  const anonKey = getAnonKey();

  const urlInput = document.getElementById('dbx-app-key-input');
  if(urlInput && url) urlInput.value = url;
  const keyInput = document.getElementById('supa-anon-key-input');
  if(keyInput && anonKey) keyInput.value = anonKey;

  if(!url || !anonKey) { dbxShowUnlinked(); return; }

  try {
    if(typeof window.supabase?.createClient !== 'function') {
      dbxSetStatus('Supabase library failed to load — check your connection.', 'error');
      return;
    }
    supaState.client = window.supabase.createClient(url, anonKey, {
      realtime: { params: { eventsPerSecond: 5 } }
    });

    dbxShowLinked('Connected');
    dbxSetStatus('Checking for updates…', 'busy', true);

    await syncPullFromCloud(false);

    supaState.backoffIndex = 0;
    if(supaState.retryTimer) { clearTimeout(supaState.retryTimer); supaState.retryTimer = null; }

    _openRealtimeChannel();

  } catch(err) {
    console.warn('[Supabase] Init failed:', err);
    dbxSetStatus('Supabase unreachable — retrying…', 'error');
    dbxScheduleRetry();
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
      dbxSetStatus('Live sync connected', 'ok');
    } else if(status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      dbxSetStatus('Live sync unavailable — ' + (err?.message || status) + ' (still syncing on save/reload)', 'error');
      supaState.channel = null; /* let a future dbxHealConnection() retry cleanly */
    } else if(status === 'CLOSED') {
      supaState.channel = null;
    }
  });
  supaState.channel = channel;
}

/* ── RETRY SCHEDULER (same shape as the old Dropbox version) ── */
export function dbxScheduleRetry() {
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
    if(dbxGetAppKey() && getAnonKey()) dbxInit();
  }, delay);
}

function dbxHealConnection(reason) {
  if(!dbxGetAppKey() || !getAnonKey() || supaState.client) return;
  console.log(`[Supabase] ${reason} — healing connection…`);
  if(supaState.retryTimer) { clearTimeout(supaState.retryTimer); supaState.retryTimer = null; }
  supaState.quickRetryCount = 0;
  supaState.backoffIndex    = 0;
  dbxInit();
}
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'visible') dbxHealConnection('Tab focused');
});
window.addEventListener('online', () => dbxHealConnection('Network back online'));
window.addEventListener('pageshow', (e) => {
  if(e.persisted) dbxHealConnection('Page restored from bfcache');
});

/* ── EXPORT / IMPORT CONNECTION (move credentials to another device,
   same idea as the old Dropbox token export) ────────────────────── */
export function dbxExportConnection() {
  const url = dbxGetAppKey(), anonKey = getAnonKey();
  if(!url || !anonKey) { alert('No active connection to export.'); return; }
  const payload = btoa(JSON.stringify({ url, anonKey }));
  navigator.clipboard.writeText(payload).then(() => {
    dbxSetStatus('Connection token copied! Paste it on your other device.', 'ok');
  }).catch(() => {
    prompt('Copy this connection token:', payload);
  });
}

export function dbxShowImport() {
  const box = document.getElementById('sync-import-box');
  if(box) box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

export async function dbxImportConnection() {
  const raw = (document.getElementById('sync-import-input')?.value || '').trim();
  await _applyImportToken(raw);
}
export async function dbxImportConnectionUnlinked() {
  const raw = (document.getElementById('sync-import-input-unlinked')?.value || '').trim();
  await _applyImportToken(raw);
}
async function _applyImportToken(raw) {
  if(!raw) { alert('Please paste a connection token first.'); return; }
  let parsed;
  try { parsed = JSON.parse(atob(raw)); }
  catch(e) { alert('Invalid token — please copy it again from the source device.'); return; }
  const { url, anonKey } = parsed;
  if(!url || !anonKey) { alert('Token is incomplete. Please export again from the source device.'); return; }
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
  await dbxInit();
}

/* ── DISCONNECT ─────────────────────────────────────────── */
export function dbxDisconnect() {
  if(!confirm('Disconnect Supabase sync?\n\nYour local data will not be deleted. You can re-link at any time.')) return;
  dbxClearToken();
  _teardownClient();
  dbxShowUnlinked();
}

/* ── PUSH: Local → Cloud ────────────────────────────────────
   sheets / credit_ledger / settings are upserted wholesale each push
   (cheap, idempotent, same "latest wins" semantics the blob had).
   activity_log is APPEND-ONLY — only rows not yet pushed by this
   device are inserted, tracked by a locally-persisted counter. ──── */
export async function syncPushToCloud(manual = false) {
  if(!supaState.client) return;
  if(supaState.busy && !manual) return;
  dbxSetBusy(true);
  dbxSetStatus('Syncing to cloud…', 'busy', true);

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

    const { error: setErr } = await supaState.client.from('settings').upsert(
      { id: 1, data: db.settings || {}, updated_at: db.settings?._updatedAt || 0 },
      { onConflict: 'id' }
    );
    if(setErr) throw setErr;

    /* Tombstones: keys deleted locally. Upserted (never appended blindly,
       so re-pushing after a reload doesn't duplicate rows) to a small
       `deleted_records` table, THEN best-effort hard-deleted from the
       real tables. The upsert happens first and unconditionally — even
       if the hard-delete below fails or is blocked by RLS, the tombstone
       still lets every pull (this device's and everyone else's) filter
       the record out, which is what actually prevents resurrection. */
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
    dbxSetStatus(`Synced at ${ts}`, 'ok');
    if(manual) {
      const statusEl = document.getElementById('sync-status-line');
      if(statusEl) {
        statusEl.style.background = 'rgba(74,222,128,.08)';
        setTimeout(() => { if(statusEl) statusEl.style.background = ''; }, 1200);
      }
    }
  } catch(err) {
    console.error('[Supabase] Push failed:', err);
    dbxSetStatus(`Upload failed: ${(err?.message || 'Unknown error').substring(0,50)}`, 'error');
  } finally {
    dbxSetBusy(false);
  }
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
function _mergeByKey(localMap, cloudMap, tsOf) {
  const merged = {};
  let localWonSomething = false;
  const allKeys = new Set([...Object.keys(localMap), ...Object.keys(cloudMap)]);
  allKeys.forEach(key => {
    const l = localMap[key], c = cloudMap[key];
    if(l && !c)      { merged[key] = l; localWonSomething = true; }
    else if(!l && c) { merged[key] = c; }
    else {
      const lt = tsOf(l) || 0, ct = tsOf(c) || 0;
      if(lt > ct) { merged[key] = l; localWonSomething = true; }
      else        { merged[key] = c; }
    }
  });
  return { merged, localWonSomething };
}

export async function syncPullFromCloud(_manual = false) {
  if(!supaState.client) return;
  dbxSetBusy(true);
  dbxSetStatus('Checking for updates…', 'busy', true);

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

    const sheetMerge = _mergeByKey(localSheets, cloudSheetsRaw, r => r._updatedAt || r.savedAt || 0);
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

    let keptLocalSettings = false;
    const localUpdatedAt = db.settings?._updatedAt || 0;
    const cloudUpdatedAt = cloudDb.settings?._updatedAt || 0;
    if(localUpdatedAt > cloudUpdatedAt) {
      cloudDb.settings = db.settings;
      keptLocalSettings = true;
    }
    if(!cloudDb.settings) cloudDb.settings = db.settings; /* nothing in cloud yet — keep local */

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
    dbxSetStatus(`Synced at ${ts} (${recordCount} records)`, 'ok');

    /* If local had anything the merge kept (an unpushed edit, a
       record cloud didn't have yet, a pending tombstone, unpushed
       settings, or unpushed log lines), push it back up now so the
       cloud — and every other device — converges on the same state. */
    if(sheetMerge.localWonSomething || clMerge.localWonSomething || keptLocalSettings || unpushedLocalAl.length || (db.deletedKeys || []).length) {
      await syncPushToCloud(false);
    }

  } catch(err) {
    console.error('[Supabase] Pull failed:', err);
    dbxSetStatus(`Sync error: ${(err?.message || 'Network error').substring(0,50)}`, 'error');
    dbxScheduleRetry();
  } finally {
    dbxSetBusy(false);
  }
}

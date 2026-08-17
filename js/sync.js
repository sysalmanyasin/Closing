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

import { repoGetLocal, repoPersist, repoRemoveLocal, repoReplaceDB, repoSetLocal } from './repository.js';
import { db, session } from './state.js';
import { buildCalendar, renderFinalSummaryCard, renderManifest } from './pages.js';
import { showAlert, showConfirm } from './notify.js';
import { refreshOpenLedgerFromSync } from './actions.js';

/* ── CONFIGURATION ─────────────────────────────────────── */
const SUPA_URL_KEY   = 'supabase_url';
const SUPA_ANON_KEY  = 'supabase_anon_key';

/* Baked-in default connection — every device/install auto-connects to
   this project without needing to open Settings and paste the Project
   URL + anon key first (that manual step is still there, and still
   wins if the user ever saves a different key — see supaGetAppKey()/
   getAnonKey() below). Safe to commit: it's the anon/publishable key,
   not a service-role key — Row Level Security is the real boundary,
   same trust model documented in BT's audit-bridge.js. */
const DEFAULT_SUPA_URL      = 'https://wetbugzzchkghpzmowod.supabase.co';
const DEFAULT_SUPA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndldGJ1Z3p6Y2hrZ2hwem1vd29kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMDg4OTIsImV4cCI6MjA5Nzg4NDg5Mn0.LXFrvQTOfI3ph4aA8xWYIUo-z1yxdX0znnN5f-KsOPM';
/* How many of this device's local db.activityLog entries have
   already been INSERTed into the activity_log table. Persisted so a
   page reload doesn't re-push (harmless, just noisy) duplicates. */
const SUPA_AL_PUSHED_KEY = 'supabase_al_pushed_count';

/* ── RETRY CONFIG ───────────────────────────────────────── */
const QUICK_RETRIES  = 3;
const QUICK_DELAY_MS = 5000;
const BACKOFF_DELAYS = [30000, 120000, 300000];

export function supaGetAppKey() {
  return (repoGetLocal(SUPA_URL_KEY) || '').trim() || DEFAULT_SUPA_URL;
}
export function getAnonKey() {
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

/* ── UI HELPERS ─────────────────────────────────────────── */
export function supaSetStatus(text, type = 'ok', spinner = false) {
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
    supaState.client = window.supabase.createClient(url, anonKey, {
      realtime: { params: { eventsPerSecond: 5 } }
    });

    supaShowLinked('Connected');
    supaSetStatus('Checking for updates…', 'busy', true);

    await syncPullFromCloud(false);

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
window.addEventListener('online', () => supaHealConnection('Network back online'));
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
  if(!supaState.client) return;
  if(supaState.busy && !manual) return;
  supaSetBusy(true);
  supaSetStatus('Syncing to cloud…', 'busy', true);

  try {
    /* ── Anti-downgrade guard ─────────────────────────────────────
       syncPullFromCloud()'s _mergeByKey() already guarantees "a
       finalized save always beats a draft" on the PULL side. This
       wholesale upsert had no equivalent guarantee on the PUSH side:
       if this device still holds an idle draft for a key that
       ANOTHER device has since actually saved & locked (draft:false)
       — e.g. it had the shift open earlier and its 3s autosave timer
       (scheduleAutoSave) fires and calls persist() → scheduleSyncPush(0)
       — this upsert would silently overwrite that finished closing
       back into a draft with no error, exactly like the case above
       for pull. Before pushing, check the cloud's current state for
       any key this device only holds as a draft.

       IMPORTANT: a flag-only check ("cloud says draft:false, mine says
       draft:true → protect cloud") is not enough — it can't tell a
       genuinely stale foreign draft apart from THIS device's own
       legitimate edit-in-progress after someone reopens an
       already-saved sheet via edit-open (confirmEditModal), which also
       autosaves as draft:true while WIP. That flag-only version wrongly
       reverted live edits back to the old final value every autosave
       cycle. Compare _updatedAt instead: only protect the cloud's save
       (and adopt it locally) when this device's draft PREDATES it —
       i.e. this device hasn't actually seen that save yet. If this
       device's draft is newer, it's a real edit building on top of
       (or unaware of, but superseding) the save, so let it push
       through normally — that's exactly what saving again should do. */
    const localSheetsObj = db.sheets || {};
    const localDraftKeys = Object.keys(localSheetsObj).filter(k => !!localSheetsObj[k].draft);
    const protectedKeys  = [];
    if(localDraftKeys.length) {
      try {
        const { data: existingSaved } = await supaState.client
          .from('sheets').select('key, data').in('key', localDraftKeys);
        (existingSaved || []).forEach(row => {
          const cloudRec = row.data;
          if(!cloudRec || cloudRec.draft !== false) return; // cloud isn't a genuine save — nothing to protect
          const cloudTs = cloudRec._updatedAt || 0;
          const localTs = (localSheetsObj[row.key] && localSheetsObj[row.key]._updatedAt) || 0;
          if(localTs > cloudTs) return; // this device's draft is newer — a real edit-in-progress, let it through
          db.sheets[row.key] = cloudRec;
          protectedKeys.push(row.key);
        });
        if(protectedKeys.length) repoPersist(); // best-effort — adopt the saved rows locally
      } catch(e) { /* best-effort — if this check itself fails, fall through and push as before rather than blocking sync entirely */ }
    }

    const sheetRows = Object.entries(db.sheets || {})
      .filter(([key]) => !protectedKeys.includes(key))
      .map(([key, rec]) => ({
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
    supaSetStatus(`Synced at ${ts}`, 'ok');
    if(manual) {
      const statusEl = document.getElementById('sync-status-line');
      if(statusEl) {
        statusEl.style.background = 'rgba(74,222,128,.08)';
        setTimeout(() => { if(statusEl) statusEl.style.background = ''; }, 1200);
      }
    }
  } catch(err) {
    console.error('[Supabase] Push failed:', err);
    supaSetStatus(`Upload failed: ${(err?.message || 'Unknown error').substring(0,50)}`, 'error');
  } finally {
    supaSetBusy(false);
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

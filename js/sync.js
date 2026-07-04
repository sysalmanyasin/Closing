/* ═══════════════════════════════════════════════════════════════
   FLOOR 1 (Extension) — DROPBOX CLOUD SYNC ENGINE
   OAuth2 PKCE, client-side only, no backend.
   Reads/writes via repoReplaceDB() / repoPersist() only.
═══════════════════════════════════════════════════════════════ */

/* ── CONFIGURATION ─────────────────────────────────────── */
const DBX_APP_KEY_STORE   = 'dropbox_app_key';
const DBX_SYNC_PATH       = '/pharmpos_sync_data.json';
const DBX_REFRESH_KEY     = 'dropbox_refresh_token';
const DBX_ACCOUNT_KEY     = 'dropbox_account_name';
const DBX_VERIFIER_KEY    = 'dropbox_pkce_verifier';

/* ── RETRY CONFIG ───────────────────────────────────────── */
const DBX_QUICK_RETRIES   = 3;    /* fast retries on load */
const DBX_QUICK_DELAY_MS  = 5000; /* 5s between quick retries */
/* After quick retries: exponential backoff — 30s, 2min, 5min */
const DBX_BACKOFF_DELAYS  = [30000, 120000, 300000];

function dbxGetAppKey() {
  return (repoGetLocal(DBX_APP_KEY_STORE) || '').trim();
}

/* ── STATE ──────────────────────────────────────────────── */
const dbxState = {
  client:          null,  /* Dropbox API client (files, account info) */
  auth:            null,  /* DropboxAuth instance — holds refresh-token renewal logic */
  busy:            false,
  retryTimer:      null,  /* handle for clearTimeout */
  backoffIndex:    0,     /* which backoff step we're on */
  quickRetryCount: 0
};

/* Accessor for Actions (Floor 3) — see scheduleSyncPush() in
   actions.js — instead of it reaching into dbxState directly. */
function syncIsReady() { return !!dbxState.client; }

/* ── UI HELPERS ─────────────────────────────────────────── */
function dbxSetStatus(text, type = 'ok', spinner = false) {
  /* ── in-card status ── */
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
  /* ── top mini-bar ── */
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
  /* ── a11y: announce only settled states (not every spinner tick,
     to avoid noisy repeated announcements) ── */
  if (!spinner && (type === 'ok' || type === 'error')) {
    const live = document.getElementById('sync-live-region');
    if (live) live.textContent = 'Sync: ' + text;
  }
}

function dbxSetBusy(busy) {
  dbxState.busy = busy;
  const btnPull = document.getElementById('btn-pull');
  const btnPush = document.getElementById('btn-push');
  if(btnPull) btnPull.disabled = busy;
  if(btnPush) btnPush.disabled = busy;
}

function dbxShowLinked(accountName) {
  const u = document.getElementById('sync-state-unlinked');
  const l = document.getElementById('sync-state-linked');
  const a = document.getElementById('sync-account-name');
  if(u) u.classList.add('hidden');
  if(l) l.classList.remove('hidden');
  if(a) a.textContent = accountName || '';
}

function dbxShowUnlinked() {
  const u = document.getElementById('sync-state-unlinked');
  const l = document.getElementById('sync-state-linked');
  if(u) u.classList.remove('hidden');
  if(l) l.classList.add('hidden');
}

/* ── REFRESH-TOKEN STORAGE ──────────────────────────────────
   Only the refresh token is persisted. It does not expire and
   is not single-use, so capturing it once at connect time is
   enough — the SDK mints short-lived access tokens from it in
   memory for the lifetime of the page, and we re-supply it to
   a fresh DropboxAuth on every app load. ──────────────────── */
function dbxSaveRefreshToken(token) {
  repoSetLocal(DBX_REFRESH_KEY, token);
}
function dbxGetRefreshToken() {
  return repoGetLocal(DBX_REFRESH_KEY) || null;
}
function dbxClearToken() {
  repoRemoveLocal(DBX_REFRESH_KEY);
  repoRemoveLocal(DBX_ACCOUNT_KEY);
  repoRemoveLocal(DBX_VERIFIER_KEY);
  /* Note: DBX_APP_KEY_STORE is intentionally NOT cleared here — user keeps their key */
}

/* ── APP KEY SETUP ──────────────────────────────────────── */
function dbxShowKeyError(msg) {
  const el = document.getElementById('dbx-key-error');
  if(el) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; }
}

function dbxSaveAppKey() {
  const inp = document.getElementById('dbx-app-key-input');
  const key = (inp?.value || '').trim();
  if(!key) { dbxShowKeyError('Please paste your App Key first.'); return; }
  repoSetLocal(DBX_APP_KEY_STORE, key);
  dbxShowKeyError('');
  /* Immediately start auth */
  dbxAuthStart();
}

/* ── OAUTH2 PKCE START ───────────────────────────────────────
   Requests offline access so Dropbox issues a refresh token
   alongside the short-lived access token. The PKCE code
   verifier must survive the full-page redirect, so it's saved
   to localStorage (the SDK only keeps it in memory). ───────── */
async function dbxAuthStart() {
  const appKey = dbxGetAppKey();
  if(!appKey) {
    /* Show the App Key input panel instead of the connect button */
    document.getElementById('sync-setup-step').classList.remove('hidden');
    document.getElementById('sync-connect-step').classList.add('hidden');
    return;
  }
  const redirectUri = window.location.href.split('#')[0].split('?')[0];
  const auth = new Dropbox.DropboxAuth({ clientId: appKey });

  const authUrl = await auth.getAuthenticationUrl(
    redirectUri,
    undefined,        // state
    'code',           // response_type — authorization code, not implicit token
    'offline',        // token_access_type — REQUESTS THE REFRESH TOKEN
    undefined,         // scope (use app's configured default scopes)
    undefined,
    true              // usePKCE
  );

  /* Persist the verifier the SDK just generated so we can hand it
     back to a brand-new DropboxAuth instance after the redirect. */
  repoSetLocal(DBX_VERIFIER_KEY, auth.getCodeVerifier());
  window.location.href = authUrl.toString ? authUrl.toString() : authUrl;
}

function dbxShowConnectStep() {
  document.getElementById('sync-setup-step').classList.add('hidden');
  document.getElementById('sync-connect-step').classList.remove('hidden');
}

function dbxClearAppKey() {
  repoRemoveLocal(DBX_APP_KEY_STORE);
  dbxClearToken();
  dbxState.client = null;
  dbxState.auth = null;
  dbxShowUnlinked();
  document.getElementById('sync-setup-step').classList.add('hidden');
  document.getElementById('sync-connect-step').classList.remove('hidden');
}

/* ── OAUTH2 REDIRECT: pull ?code= from the URL ──────────── */
function dbxParseCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if(code) {
    /* Strip the code from the URL bar immediately so refresh/back-nav can't resubmit it */
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  }
  return code || null;
}

/* ── CLIENT INITIALISATION ──────────────────────────────────
   Runs on every app load and on retry.
   NEVER clears the refresh token on network errors —
   only on confirmed 401 invalid_grant from Dropbox. ───────── */
async function dbxInit() {
  const appKey = dbxGetAppKey();

  const keyInput = document.getElementById('dbx-app-key-input');
  if(keyInput && appKey) keyInput.value = appKey;
  const hintEl = document.getElementById('dbx-redirect-hint');
  if(hintEl) hintEl.textContent = window.location.href.split('#')[0].split('?')[0];

  /* 1. Returning from the OAuth redirect with a one-time code? */
  const code = dbxParseCodeFromUrl();
  if(code && appKey) {
    try {
      dbxSetStatus('Finishing Dropbox connection…', 'busy', true);
      const verifier = repoGetLocal(DBX_VERIFIER_KEY);
      const auth = new Dropbox.DropboxAuth({ clientId: appKey });
      if(verifier) auth.setCodeVerifier(verifier);
      const redirectUri = window.location.href.split('#')[0].split('?')[0];
      const tokenResult = await auth.getAccessTokenFromCode(redirectUri, code);
      const refreshToken = tokenResult?.result?.refresh_token;
      repoRemoveLocal(DBX_VERIFIER_KEY);
      if(refreshToken) dbxSaveRefreshToken(refreshToken);
    } catch(err) {
      console.warn('[DBX] Code exchange failed:', err);
      dbxSetStatus('Dropbox connection failed — please try Link again.', 'error');
    }
  }

  /* 2. Do we have a refresh token to resume from? */
  const refreshToken = dbxGetRefreshToken();
  if(!refreshToken) {
    dbxShowUnlinked();
    if(appKey) {
      document.getElementById('sync-setup-step')?.classList.add('hidden');
      document.getElementById('sync-connect-step')?.classList.remove('hidden');
    }
    return;
  }
  if(!appKey) { dbxShowUnlinked(); return; }

  /* 3. Build auth + client — trust the token, don't verify via account call.
        The SDK will silently refresh the access token on first API use. */
  try {
    dbxState.auth = new Dropbox.DropboxAuth({
      clientId:     appKey,
      refreshToken: refreshToken
    });
    dbxState.client = new Dropbox.Dropbox({ auth: dbxState.auth });

    /* 4. Show linked immediately using cached name — no network call needed */
    const cachedName = repoGetLocal(DBX_ACCOUNT_KEY) || 'Dropbox';
    dbxShowLinked(cachedName);
    dbxSetStatus('Checking for updates…', 'busy', true);

    /* 5. Background pull — this is where the token gets truly exercised */
    await syncPullFromCloud(false);

    /* Success — reset backoff */
    dbxState.backoffIndex = 0;
    if(dbxState.retryTimer) { clearTimeout(dbxState.retryTimer); dbxState.retryTimer = null; }

    /* 6. Refresh account name silently in background (non-blocking) */
    dbxState.client.usersGetCurrentAccount().then(account => {
      const name = account.result?.name?.display_name || account.result?.email || 'Dropbox User';
      repoSetLocal(DBX_ACCOUNT_KEY, name);
      const el = document.getElementById('sync-account-name');
      if(el) el.textContent = name;
    }).catch(() => { /* non-critical — ignore */ });

  } catch(err) {
    console.warn('[DBX] Init failed:', err);
    const summary = err?.error?.error_summary || err?.message || '';

    /* Only a genuine auth rejection should force reconnect */
    const isAuthError = err?.status === 401 ||
      (typeof summary === 'string' && (summary.includes('invalid_grant') || summary.includes('expired_access_token')));

    if(isAuthError) {
      /* Token truly revoked — must re-authenticate */
      dbxClearToken();
      dbxState.client = null;
      dbxState.auth   = null;
      dbxShowUnlinked();
      dbxSetStatus('Session expired — please reconnect Dropbox.', 'error');
    } else {
      /* Network/transient error — keep token, schedule retry */
      dbxSetStatus('Dropbox unreachable — retrying…', 'error');
      dbxScheduleRetry();
    }
  }
}

/* ── SMART RETRY SCHEDULER ──────────────────────────────────
   3 quick retries (5s apart), then exponential backoff
   (30s → 2min → 5min). Also retries when tab regains focus. ─ */

function dbxScheduleRetry() {
  if(dbxState.retryTimer) clearTimeout(dbxState.retryTimer);

  let delay;
  if(dbxState.quickRetryCount < DBX_QUICK_RETRIES) {
    delay = DBX_QUICK_DELAY_MS;
    dbxState.quickRetryCount++;
    console.log(`[DBX] Quick retry ${dbxState.quickRetryCount}/${DBX_QUICK_RETRIES} in ${delay/1000}s`);
  } else {
    delay = DBX_BACKOFF_DELAYS[Math.min(dbxState.backoffIndex, DBX_BACKOFF_DELAYS.length - 1)];
    dbxState.backoffIndex++;
    console.log(`[DBX] Backoff retry in ${delay/1000}s`);
  }

  dbxState.retryTimer = setTimeout(() => {
    dbxState.retryTimer = null;
    if(dbxGetRefreshToken()) dbxInit();
  }, delay);
}

/* Tab-focus heal: instantly retry when user switches back to the tab */
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'visible' && dbxGetRefreshToken() && !dbxState.client) {
    console.log('[DBX] Tab focused — healing connection…');
    if(dbxState.retryTimer) { clearTimeout(dbxState.retryTimer); dbxState.retryTimer = null; }
    dbxState.quickRetryCount = 0;
    dbxState.backoffIndex    = 0;
    dbxInit();
  }
});

/* ── EXPORT / IMPORT CONNECTION TOKEN ───────────────────────
   Lets the user move their refresh token to another device
   without going through the full OAuth flow again. The token
   is base64-encoded (not encrypted) so treat it like a password.
   It only works with the same App Key. ───────────────────────── */
function dbxExportConnection() {
  const appKey      = dbxGetAppKey();
  const refreshToken = dbxGetRefreshToken();
  if(!refreshToken || !appKey) {
    alert('No active connection to export.');
    return;
  }
  const payload = btoa(JSON.stringify({ appKey, refreshToken }));
  navigator.clipboard.writeText(payload).then(() => {
    dbxSetStatus('Connection token copied! Paste it on your other device.', 'ok');
  }).catch(() => {
    /* Fallback: show in a prompt so user can copy manually */
    prompt('Copy this connection token:', payload);
  });
}

function dbxShowImport() {
  const box = document.getElementById('sync-import-box');
  if(box) box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

async function dbxImportConnection() {
  const raw = (document.getElementById('sync-import-input')?.value || '').trim();
  await _dbxApplyImportToken(raw);
}

async function dbxImportConnectionUnlinked() {
  const raw = (document.getElementById('sync-import-input-unlinked')?.value || '').trim();
  await _dbxApplyImportToken(raw);
}

async function _dbxApplyImportToken(raw) {
  if(!raw) { alert('Please paste a connection token first.'); return; }
  let parsed;
  try {
    parsed = JSON.parse(atob(raw));
  } catch(e) {
    alert('Invalid token — please copy it again from the source device.');
    return;
  }
  const { appKey, refreshToken } = parsed;
  if(!appKey || !refreshToken) {
    alert('Token is incomplete. Please export again from the source device.');
    return;
  }
  /* Save both key and token */
  repoSetLocal(DBX_APP_KEY_STORE, appKey);
  dbxSaveRefreshToken(refreshToken);
  /* Clear import inputs */
  const i1 = document.getElementById('sync-import-input');
  const i2 = document.getElementById('sync-import-input-unlinked');
  if(i1) i1.value = '';
  if(i2) i2.value = '';
  const box = document.getElementById('sync-import-box');
  if(box) box.style.display = 'none';
  /* Re-init with imported credentials */
  dbxState.quickRetryCount = 0;
  dbxState.backoffIndex    = 0;
  await dbxInit();
}

/* ── DISCONNECT ─────────────────────────────────────────── */
function dbxDisconnect() {
  if(!confirm('Disconnect Dropbox?\n\nYour local data will not be deleted. You can re-link at any time.')) return;
  dbxClearToken();
  dbxState.client = null;
  dbxState.auth = null;
  dbxShowUnlinked();
}

/* ── PUSH: Local → Cloud ────────────────────────────────── */
async function syncPushToCloud(manual = false) {
  if(!dbxState.client) return;
  if(dbxState.busy && !manual) return;     /* skip silent push if already busy */
  dbxSetBusy(true);
  dbxSetStatus('Uploading to cloud…', 'busy', true);

  try {
    const payload = JSON.stringify(db);
    const blob    = new Blob([payload], { type: 'application/json' });
    const file    = new File([blob], 'pharmpos_sync_data.json');

    await dbxState.client.filesUpload({
      path:       DBX_SYNC_PATH,
      contents:   file,
      mode:       { '.tag': 'overwrite' },
      autorename: false,
      mute:       true
    });

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
    console.error('[DBX] Push failed:', err);
    const status = err?.status || err?.error?.status;
    const msg = err?.error?.error_summary || err?.message || 'Unknown error';
    if(status === 400 || (typeof msg === 'string' && msg.includes('400'))) {
      dbxSetStatus('Upload failed: Missing file permissions — go to apps.dropbox.com → Permissions tab → enable files.content.write', 'error');
    } else {
      dbxSetStatus(`Upload failed: ${msg.substring(0,50)}`, 'error');
    }
  } finally {
    dbxSetBusy(false);
  }
}

/* ── PULL: Cloud → Local ────────────────────────────────── */
async function syncPullFromCloud(manual = false) {
  if(!dbxState.client) return;
  dbxSetBusy(true);
  dbxSetStatus('Checking for updates…', 'busy', true);

  try {
    const response = await dbxState.client.filesDownload({ path: DBX_SYNC_PATH });
    const fileBlob = response.result.fileBlob;

    const text     = await fileBlob.text();
    const cloudDb  = JSON.parse(text);

    /* ── Conflict Resolution ── */
    const localSheetCount = Object.keys(db.sheets || {}).length;
    const cloudSheetCount = Object.keys(cloudDb.sheets || {}).length;

    if(cloudSheetCount >= localSheetCount) {
      /* Cloud is equal or ahead — adopt cloud state */
      repoReplaceDB(cloudDb);
      /* Refresh live UI */
      buildCalendar();
      renderManifest();
      const ts = new Date().toLocaleTimeString('en-PK');
      dbxSetStatus(`Pulled from cloud at ${ts} (${cloudSheetCount} records)`, 'ok');
    } else {
      /* Local is ahead — push local up to cloud */
      dbxSetStatus('Local data is newer — uploading…', 'busy', true);
      dbxSetBusy(false);      /* release lock before recursive push */
      await syncPushToCloud(false);
    }

  } catch(err) {
    /* Handle file not found (first run) — seed cloud with local data */
    const summary = err?.error?.error_summary || '';
    if(summary.includes('not_found') || summary.includes('path/not_found') || err?.status === 409) {
      dbxSetStatus('No cloud file yet — uploading baseline…', 'busy', true);
      dbxSetBusy(false);
      await syncPushToCloud(false);
    } else {
      console.error('[DBX] Pull failed:', err);
      const status = err?.status || err?.error?.status;
      const msg = err?.error?.error_summary || err?.message || 'Network error';
      if(status === 400 || (typeof msg === 'string' && msg.includes('400'))) {
        dbxSetStatus('Sync error: Missing permissions — go to apps.dropbox.com → Permissions tab → enable files.content.read & files.content.write, then Disconnect & reconnect here', 'error');
      } else {
        dbxSetStatus(`Sync error: ${msg.substring(0,50)}`, 'error');
      }
      dbxSetBusy(false);
    }
  } finally {
    dbxSetBusy(false);
  }
}

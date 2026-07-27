/* ═══════════════════════════════════════════════════════════════
   GOOGLE DRIVE BACKUP — Edge Function
   Deploy with: supabase functions deploy google-drive
   Requires secrets: supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
   (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by
   the Edge Function runtime — do not set those yourself.)

   The refresh token never leaves this function. The browser only
   ever calls this endpoint with an { action, ... } body and gets
   back status info — never a token. See google_drive_backup.sql
   for why that's safe even if someone reads the anon key.

   Actions (every one requires either { pin } matching db.settings.
   adminPin, or — 'backup' only — { autoKey } matching this row's
   stored auto_key, see requireBackupAuth()):
     status         → { connected, email, lastBackupAt }
     oauth_callback → exchanges a Google `code` for tokens, stores them
     backup         → pulls current data from Supabase, uploads a NEW
                       timestamped JSON file to Drive (versioned —
                       nothing is ever overwritten), prunes anything
                       past MAX_VERSIONS_KEPT
     list_versions  → { versions: [{id, name, createdTime, size}] }
     restore        → { fileId } — downloads that version and replaces
                       ALL current data with it (sheets, credit ledger,
                       settings, activity log, deleted-record tombstones)
     set_auto_key   → { autoKey } — manually overrides the auto_key
                       (rotation utility; normally generated automatically
                       by oauth_callback and read by the Postgres trigger
                       that actually calls 'backup' on every shift save)
     disconnect     → revokes the token with Google and clears the row
═══════════════════════════════════════════════════════════════ */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GOOGLE_CLIENT_ID     = Deno.env.get('GOOGLE_CLIENT_ID')!;
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!;
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
}

/* Every action below is gated on the SAME Admin PIN already used
   in-app for Settings / Final Closing (db.settings.adminPin, in the
   `settings` table's row id=1 `data` column — see sync.js). Reading
   it live off the DB (rather than baking it in as a separate Edge
   Function secret) means there's one source of truth: whatever the
   owner sets as their Admin PIN in Settings is immediately what
   authorizes Drive Backup too, with nothing extra to keep in sync.
   This is the REAL boundary — the client-side lock in drive-backup.js
   is only there to keep the UI tidy for everyone else; without this
   check here, anyone who found the public anon key (shipped in every
   page load, same as before) could call backup/disconnect directly. */
async function getAdminPin(): Promise<string | null> {
  const { data } = await admin().from('settings').select('data').eq('id', 1).maybeSingle();
  return data?.data?.adminPin || null;
}

function unauthorized(): never {
  throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

async function requireAdmin(pin: unknown) {
  const adminPin = await getAdminPin();
  if (!adminPin || typeof pin !== 'string' || pin !== adminPin) unauthorized();
}

/* 'backup' alone gets a second door: the per-install auto-backup key
   (google_drive_backup.auto_key), generated server-side the moment
   Drive is connected (see handleOauthCallback below) and read directly
   off this row by a Postgres trigger on the `sheets` table
   (drive_backup_on_shift_save() in google_drive_backup.sql) — that's
   what lets an ordinary shift-closing save, from ANY device, trigger
   a backup with no Admin PIN and nothing stored in any browser. It
   only ever authorizes 'backup' — status/oauth_callback/disconnect/
   list_versions/restore still need the real Admin PIN below. */
async function requireBackupAuth(pin: unknown, autoKey: unknown) {
  if (typeof autoKey === 'string' && autoKey.length > 0) {
    const row = await getRow();
    if (row?.auto_key && autoKey === row.auto_key) return;
  }
  await requireAdmin(pin);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

async function getRow() {
  const { data } = await admin().from('google_drive_backup').select('*').eq('id', 1).maybeSingle();
  return data;
}

/* Returns a live access token, refreshing it first if it's expired
   or about to expire. Persists the refreshed token + new expiry. */
async function getAccessToken(row: Record<string, unknown>) {
  const expiresAt = row.access_token_expires_at ? new Date(row.access_token_expires_at as string).getTime() : 0;
  if (row.access_token && expiresAt - Date.now() > 60_000) {
    return row.access_token as string;
  }
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: row.refresh_token as string,
      grant_type:    'refresh_token',
    }),
  });
  const tok = await resp.json();
  if (!resp.ok) throw new Error(tok.error_description || tok.error || 'Token refresh failed');

  const expiresAtIso = new Date(Date.now() + tok.expires_in * 1000).toISOString();
  await admin().from('google_drive_backup').update({
    access_token: tok.access_token,
    access_token_expires_at: expiresAtIso,
  }).eq('id', 1);

  return tok.access_token as string;
}

async function handleOauthCallback(code: string, redirectUri: string) {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri:  redirectUri,
      grant_type:    'authorization_code',
    }),
  });
  const tok = await resp.json();
  if (!resp.ok) throw new Error(tok.error_description || tok.error || 'Code exchange failed');
  if (!tok.refresh_token) {
    /* Happens if the user had already granted consent before without
       revoking it — Google only issues a refresh_token on the FIRST
       consent unless prompt=consent is forced (which the client
       always sends — see drive-backup.js). Surfacing this clearly
       beats silently storing no refresh token at all. */
    throw new Error('Google did not return a refresh token — revoke access at myaccount.google.com/permissions and try connecting again.');
  }

  let email: string | null = null;
  try {
    const ui = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    }).then(r => r.json());
    email = ui.email || null;
  } catch (_e) { /* non-fatal — email is cosmetic only */ }

  const existing = await getRow();
  await admin().from('google_drive_backup').upsert({
    id: 1,
    refresh_token: tok.refresh_token,
    access_token: tok.access_token,
    access_token_expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
    connected_email: email,
    /* Generated once per connection — see requireBackupAuth() and the
       drive_backup_on_shift_save() Postgres trigger (google_drive_backup.sql),
       which is what actually calls 'backup' using this value on every
       completed shift save, from any device. */
    auto_key: existing?.auto_key || crypto.randomUUID(),
    updated_at: new Date().toISOString(),
  });

  return { connected: true, email };
}

/* Kept as a prefix so list_versions can find our files among anything
   else Drive might ever put in appDataFolder, and so the timestamp in
   each name is human-readable if anyone ever inspects Drive directly
   (appDataFolder is hidden from the normal Drive UI, but visible via
   the API/"Manage Apps" screen). */
const BACKUP_FILE_PREFIX = 'closing-backup-';
const MAX_VERSIONS_KEPT = 30;

async function driveFilesList(accessToken: string) {
  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('spaces', 'appDataFolder');
  url.searchParams.set('fields', 'files(id,name,createdTime,size)');
  url.searchParams.set('orderBy', 'createdTime desc');
  url.searchParams.set('pageSize', '100');
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Drive list failed: ${JSON.stringify(data)}`);
  return (data.files || []).filter((f: { name: string }) => f.name.startsWith(BACKUP_FILE_PREFIX));
}

async function handleBackup() {
  const row = await getRow();
  if (!row?.refresh_token) throw new Error('Google Drive is not connected.');
  const accessToken = await getAccessToken(row);

  /* Same four tables sync.js's pull already reads — see sync.js
     header comment for why this is the full picture of app data. */
  const client = admin();
  const [sheets, creditLedger, settings, activityLog, deleted] = await Promise.all([
    client.from('sheets').select('key, data'),
    client.from('credit_ledger').select('key, data'),
    client.from('settings').select('data').eq('id', 1).maybeSingle(),
    client.from('activity_log').select('ts, actor, key, action, changes').order('ts', { ascending: true }),
    client.from('deleted_records').select('key, deleted_at'),
  ]);
  for (const r of [sheets, creditLedger, settings, activityLog]) {
    if (r.error) throw r.error;
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    settings: settings.data?.data || null,
    sheets: Object.fromEntries((sheets.data || []).map(r => [r.key, r.data])),
    creditLedger: (creditLedger.data || []).map(r => r.data),
    activityLog: activityLog.data || [],
    deletedKeys: deleted.data || [],
  };
  const body = JSON.stringify(payload, null, 2);

  /* Versioned: every backup is its OWN file (name carries the
     timestamp), never overwritten — so "restore" can offer a real
     history instead of just the last snapshot. Lives in the app's
     hidden "appDataFolder" so it doesn't clutter the visible Drive
     (requires the drive.appdata scope — see drive-backup.js). */
  const fileName = `${BACKUP_FILE_PREFIX}${payload.exportedAt.replace(/[:.]/g, '-')}.json`;
  const boundary = 'closingbackupboundary';
  const metadata = { name: fileName, parents: ['appDataFolder'] };
  const multipartBody =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipartBody,
  });
  const created = await resp.json();
  if (!resp.ok) throw new Error(`Drive create failed: ${JSON.stringify(created)}`);

  const lastBackupAt = new Date().toISOString();
  await client.from('google_drive_backup').update({ drive_file_id: created.id, last_backup_at: lastBackupAt }).eq('id', 1);

  /* Prune anything past MAX_VERSIONS_KEPT, oldest first — best-effort,
     a failed delete here shouldn't fail the backup that just succeeded. */
  try {
    const files = await driveFilesList(accessToken);
    const stale = files.slice(MAX_VERSIONS_KEPT);
    for (const f of stale) {
      await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => {});
    }
  } catch (_e) { /* pruning is best-effort */ }

  return { backedUpAt: lastBackupAt };
}

async function handleListVersions() {
  const row = await getRow();
  if (!row?.refresh_token) throw new Error('Google Drive is not connected.');
  const accessToken = await getAccessToken(row);
  const files = await driveFilesList(accessToken);
  return {
    versions: files.map((f: { id: string; name: string; createdTime: string; size?: string }) => ({
      id: f.id, name: f.name, createdTime: f.createdTime, size: f.size ? Number(f.size) : null,
    })),
  };
}

/* Replaces ALL current data (sheets, credit ledger, settings, activity
   log, deleted-record tombstones) with the contents of one backup
   file. Deliberately wholesale, mirroring how sync.js's push/pull
   already treats these four tables as one unit — a partial restore
   would leave the app in a state that was never actually saved. */
async function handleRestore(fileId: string) {
  const row = await getRow();
  if (!row?.refresh_token) throw new Error('Google Drive is not connected.');
  if (!fileId) throw new Error('Missing fileId.');
  const accessToken = await getAccessToken(row);

  const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) throw new Error(`Drive download failed: ${await resp.text()}`);
  const payload = await resp.json();

  const client = admin();
  const sheetRows = Object.entries(payload.sheets || {}).map(([key, data]) => ({ key, data }));
  const clRows = (payload.creditLedger || []).map((data: { key: string }) => ({ key: data.key, data }));
  const delRows = (payload.deletedKeys || []).map((d: { key: string; deletedAt: number }) => ({ key: d.key, deleted_at: new Date(d.deletedAt).toISOString() }));

  /* Wholesale replace: clear each table, then insert the backup's
     rows — same "delete what's not in the new set" shape sync.js's
     push already uses, just applied to everything instead of a diff. */
  await client.from('sheets').delete().neq('key', '__none__');
  await client.from('credit_ledger').delete().neq('key', '__none__');
  await client.from('deleted_records').delete().neq('key', '__none__');
  await client.from('activity_log').delete().neq('ts', -1);

  if (sheetRows.length) { const { error } = await client.from('sheets').insert(sheetRows); if (error) throw error; }
  if (clRows.length)    { const { error } = await client.from('credit_ledger').insert(clRows); if (error) throw error; }
  if (delRows.length)   { const { error } = await client.from('deleted_records').insert(delRows); if (error) throw error; }
  if (payload.activityLog?.length) { const { error } = await client.from('activity_log').insert(payload.activityLog); if (error) throw error; }
  await client.from('settings').upsert({ id: 1, data: payload.settings || {}, updated_at: Date.now() });

  return { restoredFrom: fileId, exportedAt: payload.exportedAt };
}

async function handleSetAutoKey(autoKey: string) {
  if (!autoKey || typeof autoKey !== 'string') throw new Error('Missing autoKey.');
  await admin().from('google_drive_backup').update({ auto_key: autoKey }).eq('id', 1);
  return { ok: true };
}

async function handleDisconnect() {
  const row = await getRow();
  if (row?.refresh_token) {
    try {
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: row.refresh_token as string }),
      });
    } catch (_e) { /* best-effort — clearing our row below is what actually matters locally */ }
  }
  await admin().from('google_drive_backup').delete().eq('id', 1);
  return { connected: false };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    }});
  }
  try {
    const { action, code, redirectUri, pin, autoKey, fileId } = await req.json();

    if (action === 'backup') {
      await requireBackupAuth(pin, autoKey);
      return json(await handleBackup());
    }

    /* Everything else — including 'status' — is Admin-PIN only. */
    await requireAdmin(pin);

    if (action === 'status') {
      const row = await getRow();
      return json({ connected: !!row?.refresh_token, email: row?.connected_email || null, lastBackupAt: row?.last_backup_at || null });
    }
    if (action === 'oauth_callback')  return json(await handleOauthCallback(code, redirectUri));
    if (action === 'disconnect')      return json(await handleDisconnect());
    if (action === 'list_versions')   return json(await handleListVersions());
    if (action === 'restore')         return json(await handleRestore(fileId));
    if (action === 'set_auto_key')    return json(await handleSetAutoKey(autoKey));

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    if (err instanceof Response) return err; /* thrown by requireAdmin() — already a proper 403 */
    console.error('[google-drive]', err);
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});


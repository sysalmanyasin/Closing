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

   Actions:
     status         → { connected, email, lastBackupAt }
     oauth_callback → exchanges a Google `code` for tokens, stores them
     backup         → pulls current data from Supabase, uploads/updates
                       a JSON file in the connected Google Drive
     disconnect     → revokes the token with Google and clears the row
═══════════════════════════════════════════════════════════════ */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GOOGLE_CLIENT_ID     = Deno.env.get('GOOGLE_CLIENT_ID')!;
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!;
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const BACKUP_FILE_NAME = 'closing-backup.json';

function admin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
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

  await admin().from('google_drive_backup').upsert({
    id: 1,
    refresh_token: tok.refresh_token,
    access_token: tok.access_token,
    access_token_expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
    connected_email: email,
    updated_at: new Date().toISOString(),
  });

  return { connected: true, email };
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

  if (row.drive_file_id) {
    /* Update the existing file in place, so Drive doesn't accumulate
       a new file every backup. */
    const resp = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${row.drive_file_id}?uploadType=media`,
      { method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body }
    );
    if (!resp.ok) throw new Error(`Drive update failed: ${await resp.text()}`);
  } else {
    /* First backup ever — create the file, in the app's own hidden
       "appDataFolder" so it doesn't clutter the user's visible Drive
       (requires the drive.appdata scope alongside drive.file — see
       drive-backup.js's OAuth scope list). */
    const boundary = 'closingbackupboundary';
    const metadata = { name: BACKUP_FILE_NAME, parents: ['appDataFolder'] };
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
    await client.from('google_drive_backup').update({ drive_file_id: created.id }).eq('id', 1);
  }

  const lastBackupAt = new Date().toISOString();
  await client.from('google_drive_backup').update({ last_backup_at: lastBackupAt }).eq('id', 1);
  return { backedUpAt: lastBackupAt };
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
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    }});
  }
  try {
    const { action, code, redirectUri } = await req.json();

    if (action === 'status') {
      const row = await getRow();
      return json({ connected: !!row?.refresh_token, email: row?.connected_email || null, lastBackupAt: row?.last_backup_at || null });
    }
    if (action === 'oauth_callback') return json(await handleOauthCallback(code, redirectUri));
    if (action === 'backup')         return json(await handleBackup());
    if (action === 'disconnect')     return json(await handleDisconnect());

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    console.error('[google-drive]', err);
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});

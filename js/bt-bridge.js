/* ═══════════════════════════════════════════════════════════════
   BT BRIDGE — the Closing App ↔ BT Sale Data integration.

   READ-ONLY, ONE DIRECTION ONLY: this file fetches the shared
   bt_staff roster (BT owns it — Closing App never writes to it) for
   the Settings "Sync from BT Staff" / "Load active names from BT
   Staff" helpers and the Responsible Closing Person dropdown.

   There is deliberately NO write path back into BT Sale Data from
   here — no Quick Add, no automatic per-save forwarding of named
   credits, staff credit, JazzCash, expenses, or anything else. That
   used to exist (btBridgeQuickAdd + btBridgeSyncRecord, pushing into
   bt_inbox_ledger / bt_inbox_staff_credit / bt_inbox_unmatched) and
   was removed by request — the Closing App and BT Sale Data's own
   ledgers are meant to stay two independent records, not one
   auto-merged into the other. If a two-way sync is ever wanted again,
   it needs to be designed and turned back on deliberately, not
   re-added as a side effect of some other change.
═══════════════════════════════════════════════════════════════ */

import { repoGetLocal } from './repository.js';

const SUPA_URL_KEY  = 'supabase_url';
const SUPA_ANON_KEY = 'supabase_anon_key';

/* Same baked-in default as sync.js/auth.js — see sync.js's
   DEFAULT_SUPA_URL/DEFAULT_SUPA_ANON_KEY comment for why this is safe
   to commit. Duplicated here rather than imported, matching how this
   file already duplicates the storage keys instead of importing
   sync.js's getters. */
const DEFAULT_SUPA_URL      = 'https://wetbugzzchkghpzmowod.supabase.co';
const DEFAULT_SUPA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndldGJ1Z3p6Y2hrZ2hwem1vd29kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMDg4OTIsImV4cCI6MjA5Nzg4NDg5Mn0.LXFrvQTOfI3ph4aA8xWYIUo-z1yxdX0znnN5f-KsOPM';

let _client = null;
let _staffCache = null;       /* [{id, name, active}] */
let _staffCacheAt = 0;

function getClient() {
  if (_client) return _client;
  const url = (repoGetLocal(SUPA_URL_KEY) || '').trim() || DEFAULT_SUPA_URL;
  const key = (repoGetLocal(SUPA_ANON_KEY) || '').trim() || DEFAULT_SUPA_ANON_KEY;
  if (!url || !key || typeof window.supabase?.createClient !== 'function') return null;
  _client = window.supabase.createClient(url, key);
  return _client;
}

/* ── Shared staff roster (read-only) ───────────────────────────── */
export async function fetchStaff(force = false) {
  const client = getClient();
  if (!client) return [];
  if (!force && _staffCache && (Date.now() - _staffCacheAt) < 60000) return _staffCache;
  const { data, error } = await client.from('bt_staff').select('id, data');
  if (error) { console.warn('[BT Bridge] Could not fetch bt_staff:', error.message); return _staffCache || []; }
  _staffCache = (data || []).map(r => ({
    id: r.id,
    name: r.data?.name || r.id,
    active: r.data?.active !== false
  }));
  _staffCacheAt = Date.now();
  return _staffCache;
}

/* Settings helper — fills a tier group's textbox with comma-joined
   active staff names from BT's shared roster. The admin then edits
   down to whichever subset belongs in that group. Read-only, same as
   fetchStaff() above — this only ever populates a local text field. */
export async function loadTierNamesFromBtStaff(tierIdx) {
  const input = document.getElementById(`cfg-tier-names-${tierIdx + 1}`);
  if (!input) return;
  const client = getClient();
  if (!client) { alert('Cloud Sync isn\'t set up yet — set that up first.'); return; }
  const staff = await fetchStaff(true);
  if (!staff.length) { alert('No staff found in BT Sale Data yet, or the connection failed.'); return; }
  input.value = staff.filter(s => s.active).map(s => s.name).join(', ');
}

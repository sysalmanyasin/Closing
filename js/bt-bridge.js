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

/* ── ACTIVE, DEDUPED STAFF LIST ────────────────────────────────
   The one list every UI in this app should build from. Raw
   fetchStaff() just mirrors bt_staff as-is — including inactive rows
   and, in practice, occasional duplicate rows for the same person
   (e.g. someone re-added under a new row instead of reactivating
   their original one after being marked inactive). Left unfiltered,
   that shows up as: an inactive name still selectable as Responsible
   Closing Person, a name appearing twice in that same dropdown, two
   separate rows for one person in the Permissions grid, and
   duplicate blank-PIN rows created by "Sync from BT Staff" (its own
   existingNames check only guards against names already saved
   locally — it never caught two BT rows with the same name arriving
   in the same fetch, since both pass that check independently).

   This collapses fetchStaff()'s raw rows down to ACTIVE ONLY, one
   entry per person — matched case-/whitespace-insensitively on name
   — so every consumer below gets a clean list without each having to
   reimplement the same filtering. Keeps the FIRST active row seen
   for a given name and logs the rest to the console so an Admin can
   go clean up the BT registry itself; this is a display-layer
   safeguard against bad source data, not a fix to bt_staff itself
   (this app never writes to it — see the file header). */
export async function fetchActiveStaff(force = false) {
  const raw = await fetchStaff(force);
  const active = raw.filter(s => s.active && (s.name || '').trim());
  const byName = new Map(); /* normalized name -> kept row */
  const duplicates = [];
  active.forEach(s => {
    const key = s.name.trim().toLowerCase();
    if(byName.has(key)) duplicates.push(s);
    else byName.set(key, s);
  });
  if(duplicates.length) {
    console.warn('[BT Bridge] Duplicate active staff names in bt_staff (keeping the first row for each, ignoring the rest):',
      duplicates.map(s => `${s.name} (id ${s.id})`).join(', '));
  }
  return Array.from(byName.values());
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
  const staff = await fetchActiveStaff(true);
  if (!staff.length) { alert('No active staff found in BT Sale Data yet, or the connection failed.'); return; }
  input.value = staff.map(s => s.name).join(', ');
}

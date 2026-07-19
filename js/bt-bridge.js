/* ═══════════════════════════════════════════════════════════════
   BT BRIDGE — the Closing App ↔ BT Sale Data integration.

   Two jobs:
   1. Read-only: fetch the shared bt_staff roster (BT owns it —
      Closing App never writes to it) for the Settings "Load active
      names from BT Staff" helper.
   2. Write-only, one direction: after every save, push any NEW
      JazzCash-flagged / Expense-flagged named-credit entries and any
      new staff-credit entries into bt_inbox_ledger /
      bt_inbox_staff_credit — which BT's own triggers fold into its
      real ledger (see supabase/phase1_bt_integration.sql).

   Never touches db.sheets/db.settings itself — those stay exactly
   what state.js/actions.js already produce. This is purely a
   one-way tap on top of them.
═══════════════════════════════════════════════════════════════ */

import { repoGetLocal, repoSetLocal } from './repository.js';
import { db } from './state.js';

const SUPA_URL_KEY  = 'supabase_url';
const SUPA_ANON_KEY = 'supabase_anon_key';
const PUSHED_KEY    = 'bt_bridge_pushed_ids'; /* localStorage: JSON array of composite ids already forwarded */

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

function loadPushedSet() {
  try { return new Set(JSON.parse(repoGetLocal(PUSHED_KEY) || '[]')); }
  catch { return new Set(); }
}
function savePushedSet(set) {
  repoSetLocal(PUSHED_KEY, JSON.stringify(Array.from(set)));
}

/* ── Shared staff roster (read-only) ───────────────────────────── */
async function fetchStaff(force = false) {
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

function findStaffByName(staffList, name) {
  const norm = String(name || '').trim().toLowerCase();
  if (!norm) return null;
  return staffList.find(s => s.name.trim().toLowerCase() === norm) || null;
}

/* Settings helper — fills a tier group's textbox with comma-joined
   active staff names from BT's shared roster. The admin then edits
   down to whichever subset belongs in that group. */
export async function loadTierNamesFromBtStaff(tierIdx) {
  const input = document.getElementById(`cfg-tier-names-${tierIdx + 1}`);
  if (!input) return;
  const client = getClient();
  if (!client) { alert('Cloud Sync isn\'t set up yet — set that up first.'); return; }
  const staff = await fetchStaff(true);
  if (!staff.length) { alert('No staff found in BT Sale Data yet, or the connection failed.'); return; }
  input.value = staff.filter(s => s.active).map(s => s.name).join(', ');
}

/* ── Push logic ─────────────────────────────────────────────────
   Called after every save (draft, save, save-final) with the sheet
   key and the just-saved record. Only pushes entries not pushed
   before (tracked by a local id set) — safe to call on every save,
   including autosaves, without creating duplicates in BT's ledger. */
export async function btBridgeSyncRecord(key, record) {
  const client = getClient();
  if (!client || !record) return;

  const [entryDate, shift] = [key.split('_')[0], key.split('_').slice(1).join('_')];
  const pushed = loadPushedSet();
  let changed = false;
  const warnings = [];

  // Named credits → JazzCash / Expense
  for (const nc of (record.namedCredits || [])) {
    if (!nc.val) continue;
    const compId = `${key}:namedCredits:${nc.id}`;
    if (pushed.has(compId)) continue;
    const account = db.settings.namedCredits[nc.idx];
    const target = account?.syncTarget || 'none';
    if (target === 'none') continue;

    const row = target === 'jazzcash'
      ? { ledger_type: 'jazzcash', category_id: 'credit', amount: nc.val, description: nc.desc || '', group_label: nc.lbl || account.label, shift, entry_date: entryDate }
      : { ledger_type: 'expense', category_id: account.expenseCategory || 'bill', amount: nc.val, description: nc.desc || '', group_label: nc.lbl || account.label, shift: null, entry_date: entryDate };

    const { error } = await client.from('bt_inbox_ledger').insert(row);
    if (error) { warnings.push(`${nc.lbl || account.label}: ${error.message}`); continue; }
    pushed.add(compId);
    changed = true;
  }

  // Tier credits (fixed 3 slots) + aux credits (free label) → staff credit
  const staffList = await fetchStaff();
  const tierAndAux = [
    ...(record.tierCredits || []).map(tc => ({ id: `tier${tc.tIdx}`, name: tc.name, val: tc.val })),
    ...(record.auxCredits  || []).map(ac => ({ id: `aux${ac.id}`,  name: ac.lbl,  val: ac.val }))
  ];
  for (const entry of tierAndAux) {
    if (!entry.val || !entry.name) continue;
    const compId = `${key}:staffCredit:${entry.id}`;
    if (pushed.has(compId)) continue;
    const staffMatch = findStaffByName(staffList, entry.name);
    if (!staffMatch) {
      const { error } = await client.from('bt_inbox_unmatched').insert({
        kind: 'staffCredit', raw_label: entry.name, amount: entry.val,
        description: '', entry_date: entryDate, shift
      });
      if (error) warnings.push(`${entry.name}: could not forward even to Unmatched — ${error.message}`);
      else { pushed.add(compId); changed = true; }
      continue;
    }

    const { error } = await client.from('bt_inbox_staff_credit').insert({
      staff_id: staffMatch.id, amount: entry.val, description: '', entry_date: entryDate
    });
    if (error) { warnings.push(`${entry.name}: ${error.message}`); continue; }
    pushed.add(compId);
    changed = true;
  }

  if (changed) savePushedSet(pushed);
  if (warnings.length) console.warn('[BT Bridge] Some entries were not forwarded:\n' + warnings.join('\n'));
}

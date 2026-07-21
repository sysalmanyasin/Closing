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

import { repoGetLocal } from './repository.js';
import { db } from './state.js';
import { persist } from './actions.js';

const SUPA_URL_KEY  = 'supabase_url';
const SUPA_ANON_KEY = 'supabase_anon_key';
/* Legacy localStorage key — was the ONLY dedup record before this file
   started storing the same info on the record itself (record._btPushed,
   see btBridgeSyncRecord below). Left read-only, as a one-time migration
   source, so upgrading doesn't cause a burst of duplicate re-forwards
   for entries this exact device already forwarded under the old scheme.
   BUG THIS REPLACES: this key never left localStorage, so it never
   synced across devices. Opening the same already-saved closing on a
   second device (or a fresh install / cleared browser storage on the
   same device) had NO record of what was already forwarded, and would
   re-insert every named-credit/tier-credit/aux-credit line into BT's
   JazzCash/Expense/staff-credit ledgers again — silently double-
   counting real money. Storing the marker on the record instead means
   it rides along with the now-correctly-synced sheet (see sync.js's
   per-key merge), so every device agrees on what's already forwarded. */
const LEGACY_PUSHED_KEY = 'bt_bridge_pushed_ids';

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
let _customTypesCache = null; /* [{ledgerType, label, categories:[{id,label,sign,icon,color}]}] */
let _customTypesCacheAt = 0;

function getClient() {
  if (_client) return _client;
  const url = (repoGetLocal(SUPA_URL_KEY) || '').trim() || DEFAULT_SUPA_URL;
  const key = (repoGetLocal(SUPA_ANON_KEY) || '').trim() || DEFAULT_SUPA_ANON_KEY;
  if (!url || !key || typeof window.supabase?.createClient !== 'function') return null;
  _client = window.supabase.createClient(url, key);
  return _client;
}

/* Pushed-set for one record — seeded from record._btPushed (synced,
   authoritative) unioned with any matching legacy localStorage ids
   (this device's pre-upgrade history for this same key), so nothing
   already forwarded under the old scheme gets forwarded twice. */
function loadPushedSet(key, record) {
  const set = new Set(record._btPushed || []);
  try {
    const legacy = JSON.parse(repoGetLocal(LEGACY_PUSHED_KEY) || '[]');
    legacy.filter(id => id.startsWith(`${key}:`)).forEach(id => set.add(id));
  } catch { /* no legacy data on this device — fine */ }
  return set;
}

/* Persists the updated pushed-set back onto the record (and therefore
   into db.sheets, so the next persist()/push carries it to the cloud —
   see the persist() call at the end of btBridgeSyncRecord). */
function savePushedSet(record, set) {
  record._btPushed = Array.from(set);
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

function findStaffByName(staffList, name) {
  const norm = String(name || '').trim().toLowerCase();
  if (!norm) return null;
  return staffList.find(s => s.name.trim().toLowerCase() === norm) || null;
}

/* ── Built-in Quick Add categories ─────────────────────────────────
   Mirrors BT's own js/ledger-store.js LEDGER_CATEGORIES exactly (ids
   are the contract with bt_fold_ledger_inbox() — it stores category_id
   verbatim, so these must match BT's real ids or entries will land
   with an id BT's own UI doesn't recognize). Kept as a small static
   copy here rather than fetched live, since these are code-defined on
   BT's side and change rarely — if BT ever renames/adds a built-in
   category id, this list needs a matching update. Custom "Other
   Sections" types (unlike these) ARE fetched live below, since those
   are genuinely dynamic/user-created and can't be hardcoded. */
export const BT_BUILTIN_CATEGORIES = {
  jazzcash: [
    { id: 'credit',     label: 'Received (+)' },
    { id: 'debit',      label: 'Patty Incentive (−)' },
    { id: 'withdrawal', label: 'Generic Incentive (−)' },
    { id: 'commission', label: 'Strips / Adjustments (−)' },
    { id: 'transfer',   label: 'Transfer (−)' },
  ],
  expense: [
    { id: 'bill',           label: 'Bill Amount' },
    { id: 'fuel',           label: 'Fuel/HO' },
    { id: 'soap',           label: 'Soap/Tissue' },
    { id: 'refresh',        label: 'Refreshment' },
    { id: 'extra',          label: 'Extra' },
    { id: 'guardIncentive', label: 'Guard Incentive' },
    { id: 'pattyHO',        label: 'Patty H/O (received)' },
  ],
};

/* ── Custom "Other Sections" (read-only) ───────────────────────────
   BT's user-created ledger types (Pharmacy, Miscellaneous, etc. — see
   BT's js/ledger-store.js createCustomLedgerType) live in
   bt_ledger_custom_types, one row per section: {type: 'custom:xxx',
   data: {label, categories:[{id,label,sign,icon,color}]}}. Read-only
   here, same trust model as fetchStaff() above — RLS scopes what an
   anon/authenticated request can see, this bridge never writes here. */
export async function fetchCustomLedgerTypes(force = false) {
  const client = getClient();
  if (!client) return [];
  if (!force && _customTypesCache && (Date.now() - _customTypesCacheAt) < 60000) return _customTypesCache;
  const { data, error } = await client.from('bt_ledger_custom_types').select('type, data');
  if (error) { console.warn('[BT Bridge] Could not fetch bt_ledger_custom_types:', error.message); return _customTypesCache || []; }
  _customTypesCache = (data || []).map(r => ({
    ledgerType: r.type,
    label: r.data?.label || r.type,
    categories: Array.isArray(r.data?.categories) ? r.data.categories : []
  }));
  _customTypesCacheAt = Date.now();
  return _customTypesCache;
}

/* ── Quick Add — ad-hoc, independent of the shift-save cycle ───────
   Inserts directly into the same three inbox tables btBridgeSyncRecord()
   already writes to after a save, so it rides the same already-live,
   confirmed-generic Postgres triggers (bt_fold_ledger_inbox /
   bt_fold_staff_credit_inbox / bt_fold_unmatched_inbox — verified via
   direct SQL inspection: bt_fold_ledger_inbox stores new.ledger_type /
   new.category_id verbatim with no hardcoded type check, so a custom
   "Other Sections" ledger_type like 'custom:pharmacy' folds in exactly
   the same way 'jazzcash'/'expense' do — no BT-side change needed).

   input: { section: 'jazzcash'|'expense'|'staffCredit'|'custom:<id>',
            categoryId, staffId, amount, desc, date, shift }
   Returns { ok:true } or { ok:false, error }. Never throws — callers
   (the Quick Add widget) just check .ok and show .error if not. */
export async function btBridgeQuickAdd(input) {
  const client = getClient();
  if (!client) return { ok: false, error: "Cloud Sync isn't set up yet — set that up first." };

  const { section, categoryId, staffId, amount, desc, date, shift } = input || {};
  const amt = parseFloat(amount) || 0;
  if (!amt)     return { ok: false, error: 'Amount is required.' };
  if (!date)    return { ok: false, error: 'Date is required.' };
  if (!section) return { ok: false, error: 'Pick a section first.' };

  if (section === 'staffCredit') {
    if (!staffId) return { ok: false, error: 'Pick a staff member first.' };
    const { error } = await client.from('bt_inbox_staff_credit').insert({
      staff_id: staffId, amount: amt, description: desc || '', entry_date: date, source: 'closing_quickadd'
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  /* jazzcash / expense / any 'custom:<id>' type — all fold generically */
  if (!categoryId) return { ok: false, error: 'Pick a category first.' };
  const row = {
    ledger_type: section,
    category_id: categoryId,
    amount: amt,
    description: desc || '',
    group_label: null,
    shift: section === 'jazzcash' ? (shift || null) : null,
    entry_date: date,
    source: 'closing_quickadd'
  };
  const { error } = await client.from('bt_inbox_ledger').insert(row);
  return error ? { ok: false, error: error.message } : { ok: true };
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
   before — tracked on the record itself (record._btPushed, synced
   like the rest of the sheet) rather than a per-device localStorage
   set, so re-opening the same saved closing on a different device
   doesn't re-forward everything and double-count it in BT's ledger. */
export async function btBridgeSyncRecord(key, record) {
  const client = getClient();
  if (!client || !record) return;

  const [entryDate, shift] = [key.split('_')[0], key.split('_').slice(1).join('_')];
  const pushed = loadPushedSet(key, record);
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
      ? { ledger_type: 'jazzcash', category_id: account.jazzcashCategory || 'credit', amount: nc.val, description: nc.desc || '', group_label: nc.lbl || account.label, shift, entry_date: entryDate }
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

  if (changed) {
    savePushedSet(record, pushed);
    /* record is the exact object already sitting at db.sheets[key]
       (saveSheet() assigns it before calling this) — mutating it here
       and persisting is what makes the "already forwarded" marker
       ride along through cloud sync instead of staying device-local. */
    if (db.sheets[key] === record) persist();
  }
  if (warnings.length) console.warn('[BT Bridge] Some entries were not forwarded:\n' + warnings.join('\n'));
}

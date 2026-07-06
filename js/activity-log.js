/* ═══════════════════════════════════════════════════════════════
   FLOOR 3 (Extension) — ACTIVITY LOG
   Append-only audit trail (db.activityLog) of who did what, when —
   and for explicit saves, exactly which fields changed. Mirrors
   ledger-engine.js's own pattern: this is the only file that writes
   db.activityLog; Pages (Floor 5) only reads alAllEntries()/
   alEntriesForKey() to render the Activity Log view.

   IDENTITY comes from session.currentActor, set by checkPin() in
   state.js the moment someone unlocks anything with their PIN —
   there's no separate login step.

   DIFF TIMING — the one real design call here: only EXPLICIT
   actions get logged (Save Draft button, Save/Close, Edit-unlock,
   Delete, Archive). The silent 3-second debounce autosave in
   actions.js's scheduleAutoSave() logs NOTHING — logging every
   debounce tick while someone is actively typing would flood this
   trail with noise nobody asked for; it's plumbing, not something a
   person did.

   SESSION SNAPSHOTS — alBeginSession(key, rec) captures a deep copy
   of a record the moment it's loaded into the ledger for real
   editing (see initLedger() in actions.js). Each subsequent explicit
   commit (alCommit) diffs the just-built record against that
   snapshot, logs the result, then RE-CAPTURES the snapshot — so a
   second save in the same sitting reports what changed since that
   LAST save, not since the sheet was first opened. A record with no
   snapshot yet (its very first save) logs a plain 'create' event
   with no diff — diffing against nothing would just list every
   field as "added", which says nothing useful.

   ROW IDENTITY — free-form row arrays (hsRows, auxStrips, auxCredits,
   deposits, miscRows, namedCredits) are matched by their stable `id`
   (see genRowId() in state.js), never by array position — otherwise
   deleting row 2 of 4 would make every row after it look "changed".
═══════════════════════════════════════════════════════════════ */

import { db, session } from './state.js';

export function alEnsureArray() {
  if(!Array.isArray(db.activityLog)) db.activityLog = [];
}

/* In-memory only, never persisted — these are working snapshots for
   diffing, not data anyone needs after the tab closes. */
const _snapshots = new Map();

export function alBeginSession(key, rec) {
  _snapshots.set(key, rec ? JSON.parse(JSON.stringify(rec)) : null);
}

/* ── Friendly field labels ──────────────────────────────────────
   Covers the fields people actually care about seeing change in an
   audit trail. Anything not listed falls back to a camelCase→Title
   Case conversion so the log is never blank, just less polished for
   obscure/rarely-touched fields. */
const FIELD_LABELS = {
  inSysCash:      'Computer Cash Sale',
  outShiftSale:   'Shift Sale (POS delta)',
  inBook1:        'Sale Book 1',
  inBook2:        'Sale Book 2',
  outCust:        'Customers',
  inLastBillNum:  'Last Bill #',
  inLastBillAmt:  'Last Bill Amount',
  posRet1:        'Return 1',
  posRet2:        'Return 2',
  posRet3:        'Return 3',
  posRetSys:      'System Return',
  inAlfalah:      'Bank Alfalah',
  inKeenu:        'Keenu Machine',
  inCompSale:     'Computer Card Sale (−)',
  outCurrCC:      'Current CC',
  outPrevCC:      'Previous Day CC (carried)',
  outPrevCredit:  'Previous Credit (carried)',
  creditAdj:      'Credit Adjustment',
  outPrevDep:     'Previous Deposits (carried)',
  outPrevCash:    'Previous Cash Position (carried)',
  extraCash:      'Extra Cash Added',
  profileMode:    'Closing Type',
};
function fieldLabel(key) {
  if(FIELD_LABELS[key]) return FIELD_LABELS[key];
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).trim();
}

/* Fields that are noisy/derived/bookkeeping — never worth a diff line
   on their own (savedAt changes on every save by definition; locked
   flips with draft; finalDiffLabel is just finalDiff's text mirror). */
const SKIP_FIELDS = new Set(['draft', 'locked', 'savedAt', 'finalDiffLabel']);

/* Everything diffed separately below (row arrays / indexed arrays) —
   never through the flat scalar comparison. */
const ARRAY_FIELDS = new Set([
  'hsRows', 'stripQtys', 'stripPrices', 'auxStrips', 'tillValues', 'vaultValues',
  'namedCredits', 'tierCredits', 'auxCredits', 'deposits', 'miscRows'
]);

function isEmpty(v) { return v === undefined || v === '' || v === 0 || v === null; }

function diffScalars(before, after) {
  const changes = [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  keys.forEach(k => {
    if(SKIP_FIELDS.has(k) || ARRAY_FIELDS.has(k)) return;
    const b = before ? before[k] : undefined;
    const a = after  ? after[k]  : undefined;
    if(b === a) return;
    if(isEmpty(b) && isEmpty(a)) return; /* both effectively blank — not a real change */
    changes.push({ field: k, label: fieldLabel(k), from: isEmpty(b) ? '—' : b, to: isEmpty(a) ? '—' : a });
  });
  return changes;
}

/* Diff an id-keyed free-form row array. Rows are matched by their
   stable `id`, not position. rowLabel/rowValue are small formatters
   so each row array can describe itself sensibly ("HS: Water 1.5L",
   "Deposit: 914 Umer Block", etc). */
function diffRowArray(fieldName, before, after, rowLabel, rowValue) {
  const changes = [];
  const bMap = new Map((before || []).filter(r => r && r.id).map(r => [r.id, r]));
  const aMap = new Map((after  || []).filter(r => r && r.id).map(r => [r.id, r]));
  const allIds = new Set([...bMap.keys(), ...aMap.keys()]);
  allIds.forEach(id => {
    const b = bMap.get(id), a = aMap.get(id);
    if(b && !a) {
      changes.push({ field: fieldName, label: `${rowLabel(b)} — row removed`, from: rowValue(b), to: '—' });
    } else if(!b && a) {
      changes.push({ field: fieldName, label: `${rowLabel(a)} — row added`, from: '—', to: rowValue(a) });
    } else if(b && a) {
      const bv = rowValue(b), av = rowValue(a);
      if(bv !== av) changes.push({ field: fieldName, label: rowLabel(a), from: bv, to: av });
    }
  });
  return changes;
}

/* Diff a plain positional array (stripQtys/tillValues/vaultValues) —
   these ARE stable by position (index-matched to Settings or to the
   fixed till/vault denomination grid, never reordered), so a simple
   index comparison is accurate here, unlike the free-form row arrays. */
function diffIndexedArray(fieldName, label, before, after) {
  const changes = [];
  const len = Math.max((before || []).length, (after || []).length);
  for(let i = 0; i < len; i++) {
    const b = before?.[i] || 0, a = after?.[i] || 0;
    if(b !== a) changes.push({ field: `${fieldName}[${i}]`, label: `${label} #${i + 1}`, from: b, to: a });
  }
  return changes;
}

/* Full diff between two saved sheet records. Returns [] if `before`
   is null (nothing to diff against — the record's first save). */
export function diffRecords(before, after) {
  if(!before) return [];
  let changes = diffScalars(before, after);

  changes = changes.concat(diffRowArray('hsRows', before.hsRows, after.hsRows,
    r => `HS: ${r.lbl || 'Home Service'}`, r => `${r.val || 0}`));

  changes = changes.concat(diffRowArray('auxStrips', before.auxStrips, after.auxStrips,
    r => `Strip: ${r.label || 'Extra item'}`, r => `${r.p || 0} × ${r.q || 0}`));

  changes = changes.concat(diffRowArray('auxCredits', before.auxCredits, after.auxCredits,
    r => `Credit: ${r.lbl || 'Account'}`, r => `${r.val || 0}`));

  changes = changes.concat(diffRowArray('deposits', before.deposits, after.deposits,
    r => `Deposit: ${r.lbl || 'Entry'}`, r => `${r.val || 0}`));

  changes = changes.concat(diffRowArray('miscRows', before.miscRows, after.miscRows,
    r => `Misc: ${r.label || 'Charge'}`, r => `${r.val || 0}`));

  changes = changes.concat(diffRowArray('namedCredits', before.namedCredits, after.namedCredits,
    r => `${r.lbl || 'Named Account'}${r.desc ? ' — ' + r.desc : ''}`, r => `${r.val || 0}`));

  changes = changes.concat(diffIndexedArray('stripQtys', 'Strip Qty', before.stripQtys, after.stripQtys));
  changes = changes.concat(diffIndexedArray('tillValues', 'Till Cash', before.tillValues, after.tillValues));
  changes = changes.concat(diffIndexedArray('vaultValues', 'Vault Cash', before.vaultValues, after.vaultValues));

  /* Tier credits — fixed 3 slots, compare by position (never reordered) */
  (before.tierCredits || []).forEach((b, i) => {
    const a = (after.tierCredits || [])[i];
    if(!a) return;
    if((parseFloat(b.val) || 0) !== (parseFloat(a.val) || 0) || b.name !== a.name) {
      changes.push({
        field: `tierCredits[${i}]`,
        label: `Tier Credit #${i + 1}`,
        from: `${b.name || '—'} ${b.val || 0}`,
        to:   `${a.name || '—'} ${a.val || 0}`
      });
    }
  });

  return changes;
}

/* Append one entry directly. `changes` omitted for pure lifecycle
   events (create, delete, archive, edit-open) that have nothing to
   diff. Not usually called directly — see alCommit() below for the
   normal save-time path. */
export function alLog(action, key, changes = []) {
  alEnsureArray();
  db.activityLog.push({
    ts:     Date.now(),
    actor:  session.currentActor || 'Unknown',
    key,
    action, /* 'create' | 'save-draft' | 'save' | 'save-final' | 'edit-open' | 'delete' | 'archive' */
    changes
  });
}

/* The normal path for actions.js's explicit save points (saveDraft,
   saveSheet). Diffs `record` against whatever alBeginSession() last
   captured for this key, logs the result (or a plain 'create' if
   there's no snapshot yet), then re-captures the snapshot so the
   NEXT save in this sitting reports what changed since THIS one. */
export function alCommit(action, key, record) {
  const before  = _snapshots.has(key) ? _snapshots.get(key) : null;
  const changes = before ? diffRecords(before, record) : [];
  alLog(before ? action : 'create', key, changes);
  alBeginSession(key, record);
}

/* ── Read-side helpers for the Activity Log view (Pages/Floor 5) ──
   db.activityLog is already in chronological (oldest-first) order
   since entries are only ever appended — so newest-first is a plain
   reversal, not a sort. Sorting by `ts` descending looks equivalent
   but isn't: two commits landing in the same millisecond (easily
   possible — alCommit calls persist() right after logging) have a
   tied sort key, and a stable sort preserves their original
   (oldest-first) relative order within that tie — putting the
   actually-most-recent one LAST, not first. Reversal has no such
   edge case. */
export function alAllEntries() {
  alEnsureArray();
  return db.activityLog.slice().reverse();
}
export function alEntriesForKey(key) {
  return alAllEntries().filter(e => e.key === key);
}

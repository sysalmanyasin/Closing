/* ═══════════════════════════════════════════════════════════════
   FLOOR 3 (Extension) — LEDGER ENGINE
   The data/mutation layer for Credit Ledger and Misc/Ongoing
   Ledger snapshots. This is where db.creditLedger actually gets
   written — Pages (Floor 5) only reads these functions' results
   and renders them; it never touches db.creditLedger directly.

   Credit snapshots are a persisted, append-only array (db.creditLedger)
   because a shift's credit lines needed a stable historical record
   even if settings/labels change later. Misc/Ongoing snapshots don't
   need a separate array — they're derived live from db.sheets[key]
   .miscRows on every read, since that data never needs to outlive
   the sheet record itself.
═══════════════════════════════════════════════════════════════ */

import { db } from './state.js';
import { persist } from './actions.js';

export function clEnsureArray() {
  if(!Array.isArray(db.creditLedger)) db.creditLedger = [];
}

/* Build a credit snapshot from a saved sheet record + its key */
export function clBuildSnapshot(key, rec) {
  const parts = key.split('_');
  const date  = parts[0] || '';
  const shift = parts[1] || '';

  const lines = [];

  /* Named credits (non-zero only) */
  if(rec.namedCredits && rec.namedCredits.length) {
    rec.namedCredits.forEach(o => {
      const v = parseFloat(o.val) || 0;
      if(v !== 0) lines.push({ category: 'named', lbl: o.lbl || 'Named Account', desc: o.desc || '', val: v });
    });
  }

  /* Tier / staff credits (non-zero only) */
  if(rec.tierCredits && rec.tierCredits.length) {
    rec.tierCredits.forEach(o => {
      const v = parseFloat(o.val) || 0;
      if(v !== 0 && o.name) lines.push({ category: 'tier', lbl: o.name, val: v });
    });
  }

  /* Aux / free-label credits (non-zero only) */
  if(rec.auxCredits && rec.auxCredits.length) {
    rec.auxCredits.forEach(o => {
      const v = parseFloat(o.val) || 0;
      if(v !== 0) lines.push({ category: 'aux', lbl: o.lbl || 'Credit Entry', val: v });
    });
  }

  return {
    key,
    date,
    shift,
    mode:          rec.profileMode || 'shift',
    savedAt:       rec.savedAt || Date.now(),
    openingCredit: parseFloat(rec.outPrevCredit) || 0,
    creditAdj:     parseFloat(rec.creditAdj) || 0,
    totalCredit:   parseFloat(rec.outTotalE) || 0,
    lines
  };
}

/* Write a snapshot when a shift is explicitly saved.
   Called from actions.js's saveSheet() — persist() there covers
   both db.sheets and this db.creditLedger write in one go. */
export function clSaveSnapshot(key, rec) {
  clEnsureArray();
  /* Remove any existing snapshot for this key first */
  db.creditLedger = db.creditLedger.filter(s => s.key !== key);
  const snap = clBuildSnapshot(key, rec);
  db.creditLedger.push(snap);
}

/* Backfill: scan all saved (non-draft) sheets not yet in creditLedger */
export function clBackfillSnapshots() {
  clEnsureArray();
  const existingKeys = new Set(db.creditLedger.map(s => s.key));
  let changed = false;
  Object.entries(db.sheets || {}).forEach(([key, rec]) => {
    if(rec.draft) return;           /* skip drafts */
    if(existingKeys.has(key)) return; /* already snapshotted */
    db.creditLedger.push(clBuildSnapshot(key, rec));
    changed = true;
  });
  if(changed) persist();
}

/* Collect all unique account labels across all snapshots */
export function clAllLabels() {
  clEnsureArray();
  const seen = new Set();
  db.creditLedger.forEach(s => s.lines.forEach(l => seen.add(l.lbl)));
  return Array.from(seen).sort();
}

/* Sort snapshots newest-first, group by date. Shared by both
   Credit and Misc rendering — pure data shape, no DOM. */
export function clGroupByDate(snapshots) {
  const order = { Night: 0, Morning: 1, Evening: 2 };
  const sorted = [...snapshots].sort((a, b) => {
    if(b.date !== a.date) return b.date.localeCompare(a.date);
    return (order[b.shift] ?? 99) - (order[a.shift] ?? 99);
  });
  const groups = [];
  const seen   = {};
  sorted.forEach(s => {
    if(!seen[s.date]) { seen[s.date] = { date: s.date, snaps: [] }; groups.push(seen[s.date]); }
    seen[s.date].snaps.push(s);
  });
  return groups;
}

/* ═══════════════════════════════════════════
   MISC / ONGOING LEDGER — computed live from
   db.sheets (no separate persisted array needed,
   since miscRows are already saved per shift).
═══════════════════════════════════════════ */

export function mlAllSnapshots() {
  const out = [];
  Object.entries(db.sheets || {}).forEach(([key, rec]) => {
    if(!rec || rec.draft) return; /* skip drafts, same rule as Credit Ledger */
    const rows = (rec.miscRows || []).filter(r => (parseFloat(r.val) || 0) !== 0 || (r.label || '').trim());
    if(!rows.length) return;
    const parts = key.split('_');
    out.push({
      key,
      date:  parts[0] || '',
      shift: parts[1] || '',
      mode:  rec.profileMode || 'shift',
      lines: rows.map(r => ({ lbl: (r.label || '').trim() || 'Untitled', val: parseFloat(r.val) || 0 })),
      total: rows.reduce((s, r) => s + (parseFloat(r.val) || 0), 0)
    });
  });
  return out;
}

/* ═══════════════════════════════════════════
   DATA RETENTION — pure queries only. The actual
   delete (archiveOldRecords) is a mutation and
   lives in actions.js, PIN-gated like deleteSheet().
═══════════════════════════════════════════ */

/* YYYY-MM-DD cutoff: anything dated before this is "old" */
export function retentionCutoffDate(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

export function staleRecordKeys(months) {
  const cutoff = retentionCutoffDate(months);
  return Object.keys(db.sheets || {}).filter(key => {
    const ds = key.split('_')[0];
    return ds && ds < cutoff;
  });
}

export function countRecordsOlderThan(months) {
  return staleRecordKeys(months).length;
}

/* ═══════════════════════════════════════════════════════════════
   FLOOR 5 (Extension) — RETURNS / BOOK BILL / DEPOSIT HISTORY
   Third sub-report tab inside the Closing Book page (alongside
   Register Book and CC History). Unlike CC History (Evening only),
   this walks EVERY real slot for each day — Night, Morning, Evening,
   and any Handovers, via state.js's daySlots() — and lists these
   already-saved POS-block/Shift-block/Deposit-block fields:

     Return 1/2/3, System Return   → rec.posRet1 / posRet2 / posRet3 / posRetSys
     Book Bill 1/2                 → rec.inBook1 / inBook2
     Safe Deposit 1/2/3            → the first 3 non-deleted rows of
                                       rec.deposits[].val (each shift's
                                       OWN safe-drop entries — never the
                                       carried-forward total)
     Status                        → rec.profileMode ('final' → "Final",
                                       else → "Shift")

   Rows are ordered newest-first (latest date, then latest shift
   within that date) — the opposite direction from Closing Book/CC
   History's forward walk, per what this report is for: a quick
   "what happened most recently" read, not a chronological ledger.
═══════════════════════════════════════════════════════════════ */

import { db, daySlots } from './state.js';
import { showAlert } from './notify.js';
import { _cbLocalDateStr } from './closing-book.js';

/* This file's own transient state — file-local, never read by
   another floor directly. */
const rbdState = {
  fromDate: null,
  toDate:   null,
  rows:     []   /* last generated report, [] until first Generate */
};

/* ── Defaults when the tab is first opened ─────────────────── */
export function initRbdDefaults() {
  const fromEl = document.getElementById('rbd-from-date');
  if(fromEl && !fromEl.value) setRbdShortcut(30);
}

/* "Last N Days" shortcut — sets the range AND immediately refreshes
   the table (cheap in-memory computation, same reasoning as
   cc-history.js's setCcHistoryShortcut). */
export function setRbdShortcut(days) {
  const today = new Date();
  const from  = new Date(today);
  from.setDate(from.getDate() - (days - 1));
  document.getElementById('rbd-from-date').value = _cbLocalDateStr(from);
  document.getElementById('rbd-to-date').value   = _cbLocalDateStr(today);
  generateRbdReport();
}

/* ── Pure report builder — no DOM, safe to unit test directly ──
   Walks every calendar date in [fromDs, toDs] (inclusive), NEWEST
   date first; within each date, every real slot from daySlots() —
   Night/Morning/Evening always, plus any Handovers actually saved
   that day — in NEWEST-shift-first order (daySlots() is ascending
   by seq, so this just reverses it). A slot with no saved record
   still gets a row, marked hasData:false, so gaps are visible. */
export function buildRbdRows(fromDs, toDs) {
  const rows = [];
  if(!fromDs || !toDs) return rows;

  let d = new Date(fromDs + 'T00:00:00');
  const end = new Date(toDs + 'T00:00:00');
  if(isNaN(d) || isNaN(end) || d > end) return rows;

  const dates = [];
  while(d <= end) { dates.push(_cbLocalDateStr(d)); d.setDate(d.getDate() + 1); }
  dates.reverse(); /* latest date at the top */

  dates.forEach(ds => {
    const slots = daySlots(ds).slice().reverse(); /* latest shift of the day at the top */

    slots.forEach(slot => {
      const rec = db.sheets[`${ds}_${slot.shift}`];

      if(!rec) {
        rows.push({
          date: ds, shift: slot.shift, hasData: false, draft: false, status: '',
          ret1: 0, ret2: 0, ret3: 0, retSys: 0, book1: 0, book2: 0, dep1: 0, dep2: 0, dep3: 0
        });
        return;
      }

      const liveDeposits = Array.isArray(rec.deposits) ? rec.deposits.filter(x => !x.deleted) : [];

      rows.push({
        date:    ds,
        shift:   (rec.shiftLabel) || slot.shift, /* "Handover" for Handover slots, else the shift name itself */
        hasData: true,
        draft:   rec.draft === true,
        status:  rec.profileMode === 'final' ? 'Final' : 'Shift',
        ret1:    parseFloat(rec.posRet1)   || 0,
        ret2:    parseFloat(rec.posRet2)   || 0,
        ret3:    parseFloat(rec.posRet3)   || 0,
        retSys:  parseFloat(rec.posRetSys) || 0,
        book1:   parseFloat(rec.inBook1)   || 0,
        book2:   parseFloat(rec.inBook2)   || 0,
        dep1:    parseFloat(liveDeposits[0]?.val) || 0,
        dep2:    parseFloat(liveDeposits[1]?.val) || 0,
        dep3:    parseFloat(liveDeposits[2]?.val) || 0
      });
    });
  });

  return rows;
}

/* ── Format helpers (same conventions as cc-history.js) ──────── */
function rbdMoney(n) {
  return 'Rs. ' + (parseFloat(n) || 0).toLocaleString('en-PK');
}
function rbdFmtDate(ds) {
  try {
    return new Date(ds + 'T00:00:00').toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch(e) { return ds; }
}

/* ── Generate: read the range fields, validate, build + render ── */
export function generateRbdReport() {
  const fromDs = document.getElementById('rbd-from-date')?.value;
  const toDs   = document.getElementById('rbd-to-date')?.value;

  if(!fromDs || !toDs) { showAlert('Pick both a "From" and "To" date.'); return; }
  if(fromDs > toDs)     { showAlert('The "From" date must be before or equal to the "To" date.'); return; }

  rbdState.fromDate = fromDs;
  rbdState.toDate   = toDs;
  rbdState.rows     = buildRbdRows(fromDs, toDs);
  renderRbdTable(rbdState.rows);
}

/* ── Render ───────────────────────────────────────────────── */
export function renderRbdTable(rows) {
  const container = document.getElementById('rbd-table');
  const emptyEl   = document.getElementById('rbd-empty');
  const summaryEl = document.getElementById('rbd-summary-badge');
  const exportBtn = document.getElementById('rbd-export-btn');
  if(!container) return;

  if(!rows.length) {
    container.innerHTML = '';
    if(emptyEl)   emptyEl.classList.remove('hidden');
    if(summaryEl) summaryEl.textContent = '';
    if(exportBtn) exportBtn.disabled = true;
    return;
  }
  if(emptyEl) emptyEl.classList.add('hidden');

  const found = rows.filter(r => r.hasData);
  let tRet1=0, tRet2=0, tRet3=0, tRetSys=0, tBook1=0, tBook2=0, tDep1=0, tDep2=0, tDep3=0;
  found.forEach(r => {
    tRet1 += r.ret1; tRet2 += r.ret2; tRet3 += r.ret3; tRetSys += r.retSys;
    tBook1 += r.book1; tBook2 += r.book2;
    tDep1 += r.dep1; tDep2 += r.dep2; tDep3 += r.dep3;
  });

  /* Group header row — mirrors the merged "Returns / Refunds",
     "Book Bill", "Cash Deposit Details" header groups from the
     source spreadsheet this report is modelled on. */
  let html = `
    <div class="rbd-row rbd-group-row">
      <span class="rbd-cell rbd-group-blank"></span>
      <span class="rbd-cell rbd-group-label rbd-group-returns">Returns / Refunds</span>
      <span class="rbd-cell rbd-group-label rbd-group-book">Book Bill</span>
      <span class="rbd-cell rbd-group-label rbd-group-deposit">Cash Deposit Details</span>
    </div>
    <div class="rbd-row rbd-head-row">
      <span class="rbd-cell rbd-date">Date</span>
      <span class="rbd-cell rbd-closing">Closing</span>
      <span class="rbd-cell rbd-status">Status</span>
      <span class="rbd-cell rbd-num">Return 1</span>
      <span class="rbd-cell rbd-num">Return 2</span>
      <span class="rbd-cell rbd-num">Return 3</span>
      <span class="rbd-cell rbd-num">System Return</span>
      <span class="rbd-cell rbd-num">Book Bill 1</span>
      <span class="rbd-cell rbd-num">Book Bill 2</span>
      <span class="rbd-cell rbd-num">Safe Deposit 1</span>
      <span class="rbd-cell rbd-num">Safe Deposit 2</span>
      <span class="rbd-cell rbd-num">Safe Deposit 3</span>
    </div>`;

  rows.forEach(r => {
    if(!r.hasData) {
      html += `
        <div class="rbd-row rbd-row-missing">
          <span class="rbd-cell rbd-date">${rbdFmtDate(r.date)}</span>
          <span class="rbd-cell rbd-closing">${r.shift}</span>
          <span class="rbd-cell rbd-missing-note">No closing recorded</span>
        </div>`;
      return;
    }
    html += `
      <div class="rbd-row${r.draft ? ' rbd-row-draft' : ''}">
        <span class="rbd-cell rbd-date">${rbdFmtDate(r.date)}${r.draft ? ' <span class="rbd-draft-tag">Draft</span>' : ''}</span>
        <span class="rbd-cell rbd-closing">${r.shift}</span>
        <span class="rbd-cell rbd-status">${r.status}</span>
        <span class="rbd-cell rbd-num">${rbdMoney(r.ret1)}</span>
        <span class="rbd-cell rbd-num">${rbdMoney(r.ret2)}</span>
        <span class="rbd-cell rbd-num">${rbdMoney(r.ret3)}</span>
        <span class="rbd-cell rbd-num">${rbdMoney(r.retSys)}</span>
        <span class="rbd-cell rbd-num">${rbdMoney(r.book1)}</span>
        <span class="rbd-cell rbd-num">${rbdMoney(r.book2)}</span>
        <span class="rbd-cell rbd-num">${rbdMoney(r.dep1)}</span>
        <span class="rbd-cell rbd-num">${rbdMoney(r.dep2)}</span>
        <span class="rbd-cell rbd-num">${rbdMoney(r.dep3)}</span>
      </div>`;
  });

  html += `
    <div class="rbd-row rbd-total-row">
      <span class="rbd-cell rbd-total-label">TOTAL (${found.length} of ${rows.length} slot${rows.length !== 1 ? 's' : ''})</span>
      <span class="rbd-cell rbd-num">${rbdMoney(tRet1)}</span>
      <span class="rbd-cell rbd-num">${rbdMoney(tRet2)}</span>
      <span class="rbd-cell rbd-num">${rbdMoney(tRet3)}</span>
      <span class="rbd-cell rbd-num">${rbdMoney(tRetSys)}</span>
      <span class="rbd-cell rbd-num">${rbdMoney(tBook1)}</span>
      <span class="rbd-cell rbd-num">${rbdMoney(tBook2)}</span>
      <span class="rbd-cell rbd-num">${rbdMoney(tDep1)}</span>
      <span class="rbd-cell rbd-num">${rbdMoney(tDep2)}</span>
      <span class="rbd-cell rbd-num">${rbdMoney(tDep3)}</span>
    </div>`;

  container.innerHTML = html;

  if(summaryEl) summaryEl.textContent = `${found.length} of ${rows.length} closing${rows.length !== 1 ? 's' : ''} found`;
  if(exportBtn) exportBtn.disabled = false;
}

/* ── Export currently-generated report as CSV ───────────────── */
export function exportRbdCsv() {
  if(!rbdState.rows.length) return;

  const lines = ['Date,Closing,Status,Return 1,Return 2,Return 3,System Return,Book Bill 1,Book Bill 2,Safe Deposit 1,Safe Deposit 2,Safe Deposit 3'];
  rbdState.rows.forEach(r => {
    if(!r.hasData) { lines.push(`${r.date},${r.shift},,,,,,,,,,`); return; }
    lines.push([
      r.date, r.shift, r.status,
      r.ret1, r.ret2, r.ret3, r.retSys,
      r.book1, r.book2,
      r.dep1, r.dep2, r.dep3
    ].join(','));
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `returns-book-deposit_${rbdState.fromDate}_to_${rbdState.toDate}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

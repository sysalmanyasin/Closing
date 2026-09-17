/* ═══════════════════════════════════════════════════════════════
   FLOOR 5 (Extension) — MEDIQ HISTORY
   Fourth sub-report tab inside the Closing Book page, alongside
   Register Book, CC History, and Returns/Book/Deposit. Shows every
   MEDIQ COD order's EXTRA (collected − pharmacy bill) — see
   mediqExtraOf() in state.js for why that's the figure, not the
   gross COD amount.

   Two views over the same underlying rows, switched in place
   without leaving the tab:

     • Date-wise  — one row per real shift slot (Night/Morning/
       Evening/Handover) in the range, newest date & shift first.
       Same walk as rbd-history.js's buildRbdRows(), so a day with
       no saved record still gets a row marked hasData:false.

     • Month-wise — the same rows rolled up by calendar month
       (newest month first), because a MEDIQ COD business runs on
       month-end reconciliation as much as day-to-day closings.

   Pure builders (buildMediqHistoryRows / buildMediqMonthRows) are
   DOM-free, same split as rbd-history.js, so they're unit testable
   directly (see tests/mediq-history.test.mjs).
═══════════════════════════════════════════════════════════════ */

import { db, daySlots, mediqExtraOf } from './state.js';
import { showAlert } from './notify.js';
import { _cbLocalDateStr } from './closing-book.js';

/* This file's own transient state — file-local, never read by
   another floor directly. */
const mhState = {
  fromDate:  null,
  toDate:    null,
  view:      'date',  /* 'date' | 'month' */
  rows:      [],       /* date-wise rows — last generated report */
  monthRows: []         /* month-wise rollup of the same rows */
};

/* ── Defaults when the tab is first opened ─────────────────── */
export function initMediqHistoryDefaults() {
  const fromEl = document.getElementById('mh-from-date');
  if(fromEl && !fromEl.value) setMediqHistoryShortcut(30);
}

/* "Last N Days" shortcut — sets the range AND immediately refreshes. */
export function setMediqHistoryShortcut(days) {
  const today = new Date();
  const from  = new Date(today);
  from.setDate(from.getDate() - (days - 1));
  document.getElementById('mh-from-date').value = _cbLocalDateStr(from);
  document.getElementById('mh-to-date').value   = _cbLocalDateStr(today);
  generateMediqHistory();
}

/* ── Pure date-wise builder — no DOM ─────────────────────────
   Walks every calendar date in [fromDs, toDs] (inclusive), NEWEST
   date first; within each date, every real slot from daySlots(),
   newest-shift-first (mirrors buildRbdRows() exactly). Each order
   line's extra is collected − pharmacy bill; a row's own total is
   mediqExtraOf(rec), the single source of truth also used by the
   live card, the Closing Book summary tile, and Final aggregation. */
export function buildMediqHistoryRows(fromDs, toDs) {
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
          orderCount: 0, prevMediq: 0, extra: 0
        });
        return;
      }

      const liveOrders = Array.isArray(rec.mediqRows) ? rec.mediqRows.filter(o => !o.deleted) : [];

      rows.push({
        date:       ds,
        shift:      rec.shiftLabel || slot.shift,
        hasData:    true,
        draft:      rec.draft === true,
        status:     rec.profileMode === 'final' ? 'Final' : 'Shift',
        orderCount: liveOrders.length,
        prevMediq:  parseFloat(rec.outPrevMediq) || 0,
        extra:      mediqExtraOf(rec)
      });
    });
  });

  return rows;
}

/* ── Pure month-wise rollup — no DOM ──────────────────────────
   Groups the same date-wise rows by "YYYY-MM", newest month first.
   Only rows with hasData contribute to a month's figures, but a
   month with nothing saved at all still doesn't appear (unlike the
   date-wise view, which deliberately shows every empty slot) —
   there is no meaningful "empty month" row to show here. */
export function buildMediqMonthRows(rows) {
  const byMonth = new Map();

  rows.forEach(r => {
    if(!r.hasData) return;
    const monthKey = r.date.slice(0, 7); /* "YYYY-MM" */
    if(!byMonth.has(monthKey)) {
      byMonth.set(monthKey, { month: monthKey, shiftCount: 0, orderCount: 0, prevMediq: 0, extra: 0 });
    }
    const m = byMonth.get(monthKey);
    m.shiftCount++;
    m.orderCount += r.orderCount;
    m.prevMediq  += r.prevMediq;
    m.extra      += r.extra;
  });

  return Array.from(byMonth.values()).sort((a, b) => b.month.localeCompare(a.month));
}

/* ── Format helpers (same conventions as cc-history.js / rbd-history.js) ── */
function mhMoney(n) {
  return 'Rs. ' + (parseFloat(n) || 0).toLocaleString('en-PK');
}
function mhFmtDate(ds) {
  try {
    return new Date(ds + 'T00:00:00').toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch(e) { return ds; }
}
function mhFmtMonth(monthKey) {
  try {
    return new Date(monthKey + '-01T00:00:00').toLocaleDateString('en-PK', { month: 'long', year: 'numeric' });
  } catch(e) { return monthKey; }
}

/* ── Generate: read the range fields, validate, build both views,
   render whichever is currently active ─────────────────────── */
export function generateMediqHistory() {
  const fromDs = document.getElementById('mh-from-date')?.value;
  const toDs   = document.getElementById('mh-to-date')?.value;

  if(!fromDs || !toDs) { showAlert('Pick both a "From" and "To" date.'); return; }
  if(fromDs > toDs)     { showAlert('The "From" date must be before or equal to the "To" date.'); return; }

  mhState.fromDate  = fromDs;
  mhState.toDate    = toDs;
  mhState.rows      = buildMediqHistoryRows(fromDs, toDs);
  mhState.monthRows = buildMediqMonthRows(mhState.rows);
  renderActiveMediqView();
}

/* ── View toggle — Date-wise / Month-wise, same generated range ── */
export function switchMediqView(view) {
  mhState.view = view === 'month' ? 'month' : 'date';
  document.getElementById('mh-view-tab-date')?.classList.toggle('active', mhState.view === 'date');
  document.getElementById('mh-view-tab-month')?.classList.toggle('active', mhState.view === 'month');
  renderActiveMediqView();
}

function renderActiveMediqView() {
  if(mhState.view === 'month') renderMediqMonthTable(mhState.monthRows);
  else                         renderMediqHistoryTable(mhState.rows);
}

/* ── Render: Date-wise ────────────────────────────────────────
   Mirrors rbd-history.js's renderRbdTable structure/CSS classes
   (mh- prefix instead of rbd-) so both reports read as the same
   family of report inside Closing Book. */
export function renderMediqHistoryTable(rows) {
  const container = document.getElementById('mh-table');
  const emptyEl   = document.getElementById('mh-empty');
  const summaryEl = document.getElementById('mh-summary-badge');
  const exportBtn = document.getElementById('mh-export-btn');
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
  let tOrders = 0, tPrev = 0, tExtra = 0;
  found.forEach(r => { tOrders += r.orderCount; tPrev += r.prevMediq; tExtra += r.extra; });

  let html = `
    <div class="mh-row mh-head-row">
      <span class="mh-cell mh-date">Date</span>
      <span class="mh-cell mh-closing">Closing</span>
      <span class="mh-cell mh-status">Status</span>
      <span class="mh-cell mh-num">Orders</span>
      <span class="mh-cell mh-num">Previous MEDIQ</span>
      <span class="mh-cell mh-num mh-extra">Extra MEDIQ (I)</span>
    </div>`;

  rows.forEach(r => {
    if(!r.hasData) {
      html += `
        <div class="mh-row mh-row-missing">
          <span class="mh-cell mh-date">${mhFmtDate(r.date)}</span>
          <span class="mh-cell mh-closing">${r.shift}</span>
          <span class="mh-cell mh-missing-note">No closing recorded</span>
        </div>`;
      return;
    }
    html += `
      <div class="mh-row${r.draft ? ' mh-row-draft' : ''}">
        <span class="mh-cell mh-date">${mhFmtDate(r.date)}${r.draft ? ' <span class="mh-draft-tag">Draft</span>' : ''}</span>
        <span class="mh-cell mh-closing">${r.shift}</span>
        <span class="mh-cell mh-status">${r.status}</span>
        <span class="mh-cell mh-num">${r.orderCount}</span>
        <span class="mh-cell mh-num">${mhMoney(r.prevMediq)}</span>
        <span class="mh-cell mh-num mh-extra">${mhMoney(r.extra)}</span>
      </div>`;
  });

  html += `
    <div class="mh-row mh-total-row">
      <span class="mh-cell mh-total-label">TOTAL (${found.length} of ${rows.length} slot${rows.length !== 1 ? 's' : ''})</span>
      <span class="mh-cell mh-num">${tOrders}</span>
      <span class="mh-cell mh-num">${mhMoney(tPrev)}</span>
      <span class="mh-cell mh-num mh-extra">${mhMoney(tExtra)}</span>
    </div>`;

  container.innerHTML = html;

  if(summaryEl) summaryEl.textContent = `${found.length} of ${rows.length} closing${rows.length !== 1 ? 's' : ''} found`;
  if(exportBtn) exportBtn.disabled = false;
}

/* ── Render: Month-wise ───────────────────────────────────────
   Fewer, wider rows — one per calendar month with data — so this
   view reads as a reconciliation summary rather than a ledger. */
export function renderMediqMonthTable(monthRows) {
  const container = document.getElementById('mh-table');
  const emptyEl   = document.getElementById('mh-empty');
  const summaryEl = document.getElementById('mh-summary-badge');
  const exportBtn = document.getElementById('mh-export-btn');
  if(!container) return;

  if(!monthRows.length) {
    container.innerHTML = '';
    if(emptyEl)   emptyEl.classList.remove('hidden');
    if(summaryEl) summaryEl.textContent = '';
    if(exportBtn) exportBtn.disabled = true;
    return;
  }
  if(emptyEl) emptyEl.classList.add('hidden');

  let tShifts = 0, tOrders = 0, tPrev = 0, tExtra = 0;
  monthRows.forEach(m => { tShifts += m.shiftCount; tOrders += m.orderCount; tPrev += m.prevMediq; tExtra += m.extra; });

  let html = `
    <div class="mh-row mh-head-row mh-row-month">
      <span class="mh-cell mh-date">Month</span>
      <span class="mh-cell mh-num">Closings</span>
      <span class="mh-cell mh-num">Orders</span>
      <span class="mh-cell mh-num">Previous MEDIQ</span>
      <span class="mh-cell mh-num mh-extra">Extra MEDIQ (I)</span>
    </div>`;

  monthRows.forEach(m => {
    html += `
      <div class="mh-row mh-row-month">
        <span class="mh-cell mh-date">${mhFmtMonth(m.month)}</span>
        <span class="mh-cell mh-num">${m.shiftCount}</span>
        <span class="mh-cell mh-num">${m.orderCount}</span>
        <span class="mh-cell mh-num">${mhMoney(m.prevMediq)}</span>
        <span class="mh-cell mh-num mh-extra">${mhMoney(m.extra)}</span>
      </div>`;
  });

  html += `
    <div class="mh-row mh-total-row mh-row-month">
      <span class="mh-cell mh-total-label">TOTAL (${monthRows.length} month${monthRows.length !== 1 ? 's' : ''})</span>
      <span class="mh-cell mh-num">${tShifts}</span>
      <span class="mh-cell mh-num">${tOrders}</span>
      <span class="mh-cell mh-num">${mhMoney(tPrev)}</span>
      <span class="mh-cell mh-num mh-extra">${mhMoney(tExtra)}</span>
    </div>`;

  container.innerHTML = html;

  if(summaryEl) summaryEl.textContent = `${monthRows.length} month${monthRows.length !== 1 ? 's' : ''} found`;
  if(exportBtn) exportBtn.disabled = false;
}

/* ── Export currently-generated report as CSV — follows whichever
   view is active, same as the table currently on screen ───────── */
export function exportMediqHistoryCsv() {
  if(mhState.view === 'month') {
    if(!mhState.monthRows.length) return;
    const lines = ['Month,Closings,Orders,Previous MEDIQ,Extra MEDIQ (I)'];
    mhState.monthRows.forEach(m => {
      lines.push([mhFmtMonth(m.month), m.shiftCount, m.orderCount, m.prevMediq, m.extra].join(','));
    });
    downloadMhCsv(lines, `mediq-history-monthly_${mhState.fromDate}_to_${mhState.toDate}.csv`);
    return;
  }

  if(!mhState.rows.length) return;
  const lines = ['Date,Closing,Status,Orders,Previous MEDIQ,Extra MEDIQ (I)'];
  mhState.rows.forEach(r => {
    if(!r.hasData) { lines.push(`${r.date},${r.shift},,,,`); return; }
    lines.push([r.date, r.shift, r.status, r.orderCount, r.prevMediq, r.extra].join(','));
  });
  downloadMhCsv(lines, `mediq-history_${mhState.fromDate}_to_${mhState.toDate}.csv`);
}

function downloadMhCsv(lines, filename) {
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

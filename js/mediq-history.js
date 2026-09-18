/* ═══════════════════════════════════════════════════════════════
   FLOOR 5 (Extension) — MEDIQ HISTORY
   Fourth sub-report tab inside the Closing Book page, alongside
   Register Book, CC History, and Returns/Book/Deposit. Shows every
   MEDIQ COD order's EXTRA (collected − pharmacy bill) — see
   mediqExtraOf() in state.js for why that's the figure, not the
   gross COD amount.

   Two views over the same underlying rows, switched in place
   without leaving the tab:

     • Date-wise — a proper ORDER-LEVEL LEDGER: one collapsible
       card per calendar date (chevron toggles it), and inside each,
       one block per real shift slot (Night/Morning/Evening/
       Handover) with its own mini ledger table — Order ID, Bill
       Number, COD Collected, Pharmacy Bill, Extra — one row per
       order actually entered that shift. Same walk as
       rbd-history.js's buildRbdRows(): a day with no saved record
       still gets a row, marked hasData:false, so gaps stay visible.

     • Month-wise — the same shift-level totals rolled up by
       calendar month (newest month first), because a MEDIQ COD
       business reconciles month-end as much as day-to-day.

   Pure builders (buildMediqHistoryRows / groupMediqRowsByDate /
   buildMediqMonthRows) are DOM-free, same split as rbd-history.js,
   so they're unit testable directly (see tests/mediq-history.test.mjs).
═══════════════════════════════════════════════════════════════ */

import { db, daySlots, mediqExtraOf, escHtml } from './state.js';
import { showAlert } from './notify.js';
import { _cbLocalDateStr } from './closing-book.js';

/* This file's own transient state — file-local, never read by
   another floor directly. */
const mhState = {
  fromDate:  null,
  toDate:    null,
  view:      'date',       /* 'date' | 'month' */
  rows:      [],            /* date-wise rows — last generated report */
  groups:    [],            /* rows grouped by calendar date, for the ledger */
  monthRows: [],            /* month-wise rollup of the same rows */
  openDates: new Set()      /* which date-group cards are expanded */
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
   newest-shift-first (mirrors buildRbdRows() exactly). Each row
   that has a saved record also carries its own order-level detail
   (`orders`) so the ledger can render Order ID / Bill Number / COD
   Collected / Pharmacy Bill / Extra per line, not just a shift
   total. `orderId` is the cashier's own entered Order ID field (same
   free-text style as Bill Number) when they filled it in; rows saved
   before that field existed, or left blank, fall back to a per-shift
   sequence number ("#1", "#2", …) in entry order so every row still
   has something stable and readable to show. */
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
          orders: [], orderCount: 0, prevMediq: 0, extra: 0
        });
        return;
      }

      const liveOrders = Array.isArray(rec.mediqRows) ? rec.mediqRows.filter(o => !o.deleted) : [];
      const orders = liveOrders.map((o, idx) => {
        const val       = parseFloat(o.val) || 0;
        const pharmBill = parseFloat(o.pharmBill) || 0;
        const orderId   = (o.orderId ?? '').toString().trim();
        return {
          orderId:  orderId || `#${idx + 1}`,
          billNum:  (o.billNum ?? o.lbl ?? '').trim(),
          val, pharmBill,
          extra:    val - pharmBill
        };
      });

      rows.push({
        date:       ds,
        shift:      rec.shiftLabel || slot.shift,
        hasData:    true,
        draft:      rec.draft === true,
        status:     rec.profileMode === 'final' ? 'Final' : 'Shift',
        orders,
        orderCount: orders.length,
        prevMediq:  parseFloat(rec.outPrevMediq) || 0,
        extra:      mediqExtraOf(rec)
      });
    });
  });

  return rows;
}

/* ── Group the flat date-wise rows into one entry per calendar
   date, for the ledger's date-level accordion. Rows already arrive
   newest-date-first with same-date rows adjacent (see above), so
   this is a straight run-length grouping — no re-sorting needed. */
export function groupMediqRowsByDate(rows) {
  const groups = [];
  let current = null;
  rows.forEach(r => {
    if(!current || current.date !== r.date) {
      current = { date: r.date, shifts: [], dayExtra: 0, dayOrders: 0, dayPrev: 0, foundCount: 0 };
      groups.push(current);
    }
    current.shifts.push(r);
    if(r.hasData) {
      current.dayExtra += r.extra;
      current.dayOrders += r.orderCount;
      current.dayPrev += r.prevMediq;
      current.foundCount++;
    }
  });
  return groups;
}

/* ── Pure month-wise rollup — no DOM ──────────────────────────
   Groups the same date-wise rows by "YYYY-MM", newest month first.
   Only rows with hasData contribute to a month's figures, but a
   month with nothing saved at all still doesn't appear — there is
   no meaningful "empty month" row to show here. */
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
    return new Date(ds + 'T00:00:00').toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric', weekday: 'short' });
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
  mhState.groups    = groupMediqRowsByDate(mhState.rows);
  mhState.monthRows = buildMediqMonthRows(mhState.rows);

  /* Fresh range → start with just the most recent date open, so the
     ledger isn't a wall of expanded cards on first generate. Expand
     All / Collapse All (in the toolbar below) take it from there. */
  mhState.openDates = new Set(mhState.groups.length ? [mhState.groups[0].date] : []);

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

/* ── Accordion controls (date-wise ledger only) ───────────────── */
export function toggleMediqDateGroup(dateKey) {
  if(mhState.openDates.has(dateKey)) mhState.openDates.delete(dateKey);
  else mhState.openDates.add(dateKey);
  renderMediqHistoryTable(mhState.rows);
}
export function expandAllMediqDates() {
  mhState.openDates = new Set(mhState.groups.map(g => g.date));
  renderMediqHistoryTable(mhState.rows);
}
export function collapseAllMediqDates() {
  mhState.openDates = new Set();
  renderMediqHistoryTable(mhState.rows);
}

/* ── Render: Date-wise ledger ─────────────────────────────────
   One card per calendar date. The card header is the only thing
   visible when collapsed — date, a "found/total" closings badge,
   and the day's Extra MEDIQ total — with a chevron that rotates on
   open. Expanding it reveals one block per shift slot; a shift with
   orders gets its own mini ledger table (Order ID / Bill Number /
   COD Collected / Pharmacy Bill / Extra), a shift with none shows a
   quiet placeholder line, and a slot with no saved record at all
   shows "No closing recorded" exactly as the flat report used to. */
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

  const groups = mhState.groups.length ? mhState.groups : groupMediqRowsByDate(rows);
  const found  = rows.filter(r => r.hasData);

  const toolbar = `
    <div class="mh-toolbar">
      <button class="mh-toolbar-btn" onclick="expandAllMediqDates()">⤢ Expand all</button>
      <button class="mh-toolbar-btn" onclick="collapseAllMediqDates()">⤡ Collapse all</button>
    </div>`;

  const cardsHtml = groups.map(g => renderMediqDateCard(g)).join('');

  container.innerHTML = toolbar + `<div class="mh-ledger">${cardsHtml}</div>`;

  if(summaryEl) summaryEl.textContent = `${found.length} of ${rows.length} closing${rows.length !== 1 ? 's' : ''} found`;
  if(exportBtn) exportBtn.disabled = false;
}

function renderMediqDateCard(g) {
  const isOpen = mhState.openDates.has(g.date);
  const shiftsHtml = g.shifts.map(renderMediqShiftBlock).join('');

  return `
    <div class="mh-date-card${isOpen ? ' open' : ''}">
      <button class="mh-date-head" onclick="toggleMediqDateGroup('${g.date}')" type="button">
        <span class="mh-chevron">▸</span>
        <span class="mh-date-title">${mhFmtDate(g.date)}</span>
        <span class="mh-date-badge">${g.foundCount} of ${g.shifts.length} closing${g.shifts.length !== 1 ? 's' : ''}</span>
        <span class="mh-date-total${g.dayExtra !== 0 ? ' mh-date-total-pos' : ''}">${mhMoney(g.dayExtra)}</span>
      </button>
      <div class="mh-date-body">${shiftsHtml}</div>
    </div>`;
}

function renderMediqShiftBlock(r) {
  if(!r.hasData) {
    return `
      <div class="mh-shift-block mh-shift-missing">
        <div class="mh-shift-head">
          <span class="mh-shift-name">${escHtml(r.shift)}</span>
          <span class="mh-shift-missing-note">No closing recorded</span>
        </div>
      </div>`;
  }

  const statusClass = r.status === 'Final' ? 'mh-status-final' : 'mh-status-shift';
  const draftTag = r.draft ? ' <span class="mh-draft-tag">Draft</span>' : '';

  let body;
  if(r.orders.length === 0 && r.prevMediq === 0) {
    body = `<div class="mh-shift-empty">No MEDIQ activity this shift</div>`;
  } else {
    const orderRows = r.orders.map(o => `
      <div class="mh-order-row">
        <span class="mh-order-cell mh-order-id">${o.orderId}</span>
        <span class="mh-order-cell mh-order-bill">${o.billNum ? escHtml(o.billNum) : '—'}</span>
        <span class="mh-order-cell mh-order-num">${mhMoney(o.val)}</span>
        <span class="mh-order-cell mh-order-num">${mhMoney(o.pharmBill)}</span>
        <span class="mh-order-cell mh-order-num mh-order-extra">${mhMoney(o.extra)}</span>
      </div>`).join('');

    const carryRow = r.prevMediq !== 0 ? `
      <div class="mh-order-row mh-carry-row">
        <span class="mh-order-cell mh-order-id">—</span>
        <span class="mh-order-cell mh-order-bill">Previous MEDIQ (carried)</span>
        <span class="mh-order-cell mh-order-num">—</span>
        <span class="mh-order-cell mh-order-num">—</span>
        <span class="mh-order-cell mh-order-num mh-order-extra">${mhMoney(r.prevMediq)}</span>
      </div>` : '';

    body = `
      <div class="mh-order-table">
        <div class="mh-order-row mh-order-head">
          <span class="mh-order-cell mh-order-id">Order ID</span>
          <span class="mh-order-cell mh-order-bill">Bill Number</span>
          <span class="mh-order-cell mh-order-num">COD Collected</span>
          <span class="mh-order-cell mh-order-num">Pharmacy Bill</span>
          <span class="mh-order-cell mh-order-num">Extra</span>
        </div>
        ${orderRows}
        ${carryRow}
        <div class="mh-order-row mh-shift-total-row">
          <span class="mh-order-cell mh-order-total-label">Shift Extra MEDIQ</span>
          <span class="mh-order-cell mh-order-num mh-order-extra">${mhMoney(r.extra)}</span>
        </div>
      </div>`;
  }

  return `
    <div class="mh-shift-block">
      <div class="mh-shift-head">
        <span class="mh-shift-name">${escHtml(r.shift)}${draftTag}</span>
        <span class="mh-status-pill ${statusClass}">${r.status}</span>
      </div>
      ${body}
    </div>`;
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
      <span class="mh-cell mh-num mh-extra">Extra MEDIQ</span>
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
   view is active, same as the table currently on screen. The
   date-wise export is now order-level, matching the ledger: one
   line per order, plus a carried-forward line when Previous MEDIQ
   is non-zero, plus one placeholder line for a shift with neither
   (so every shift still contributes at least one row). ─────────── */
export function exportMediqHistoryCsv() {
  if(mhState.view === 'month') {
    if(!mhState.monthRows.length) return;
    const lines = ['Month,Closings,Orders,Previous MEDIQ,Extra MEDIQ'];
    mhState.monthRows.forEach(m => {
      lines.push([mhFmtMonth(m.month), m.shiftCount, m.orderCount, m.prevMediq, m.extra].join(','));
    });
    downloadMhCsv(lines, `mediq-history-monthly_${mhState.fromDate}_to_${mhState.toDate}.csv`);
    return;
  }

  if(!mhState.rows.length) return;
  const lines = ['Date,Closing,Status,Order ID,Bill Number,COD Collected,Pharmacy Bill,Extra'];
  mhState.rows.forEach(r => {
    if(!r.hasData) { lines.push(`${r.date},${r.shift},,,,,,`); return; }

    if(r.orders.length === 0 && r.prevMediq === 0) {
      lines.push(`${r.date},${r.shift},${r.status},,,,,0`);
      return;
    }
    r.orders.forEach(o => {
      lines.push([r.date, r.shift, r.status, o.orderId, o.billNum, o.val, o.pharmBill, o.extra].join(','));
    });
    if(r.prevMediq !== 0) {
      lines.push(`${r.date},${r.shift},${r.status},(carried),Previous MEDIQ,,,${r.prevMediq}`);
    }
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

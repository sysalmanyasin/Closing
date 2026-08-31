/* ═══════════════════════════════════════════════════════════════
   FLOOR 5 (Extension) — CC HISTORY
   Sub-report tab inside the Closing Book page. Walks a date range
   day-by-day and pulls ONLY the Evening (Closing 3) shift for each
   day — Night/Morning are never looked at here — reading the three
   POS-block fields that already exist on every saved sheet record:

     Bank Alfalah Card Machine   (A) → rec.inAlfalah
     Keenu Card Machine          (B) → rec.inKeenu
     Computer Card Sale          (C) → rec.inCompSale

   and computing CC = (A + B) − C for each day — the exact same
   formula actions.js's calc() already uses for "Card Sales This
   Shift (D)" (out-curr-cc), recomputed independently here from the
   saved inputs so this report never depends on that derived field
   having been present/correct at save time.

   Pure data logic (buildCcHistoryRows) is kept separate from DOM
   rendering, same split as ledger-engine.js/closing-book.js, so it
   can be unit tested directly (see tests/cc-history.test.mjs).
═══════════════════════════════════════════════════════════════ */

import { db } from './state.js';
import { showAlert } from './notify.js';
import { _cbLocalDateStr } from './closing-book.js';

/* This file's own transient state — file-local, never read by
   another floor directly. */
const cchState = {
  fromDate: null,
  toDate:   null,
  rows:     []   /* last generated report, [] until first Generate */
};

/* ── Defaults when the tab is first opened ───────────────────
   Only fills in blank fields — never clobbers a range the person
   already picked (mirrors initClosingBookDefaults' guard). */
export function initCcHistoryDefaults() {
  const fromEl = document.getElementById('cch-from-date');
  if(fromEl && !fromEl.value) setCcHistoryShortcut(30);
}

/* "Last N Days" shortcut — sets the range AND immediately refreshes
   the table. Unlike Closing Book's shortcuts (which just fill the
   fields, since assembling a book can be slow), this report is a
   cheap in-memory loop, so instant feedback is worth giving here. */
export function setCcHistoryShortcut(days) {
  const today = new Date();
  const from  = new Date(today);
  from.setDate(from.getDate() - (days - 1));
  document.getElementById('cch-from-date').value = _cbLocalDateStr(from);
  document.getElementById('cch-to-date').value   = _cbLocalDateStr(today);
  generateCcHistory();
}

/* ── Pure report builder — no DOM, safe to unit test directly ──
   Walks the range day-by-day (inclusive both ends) using the same
   timezone-safe local-date stepping Closing Book uses, and for
   each date looks ONLY at db.sheets[`${ds}_Evening`] — Evening is
   always "Closing 3" (SHIFT_SR.Evening === 3 in state.js), so this
   is exactly "evening shift 3 only, from every day", regardless of
   whether that day also had a Handover closing tacked on afterward.
   A day with no saved Evening closing still gets a row, marked
   hasData:false, so gaps in the history are visible rather than
   silently skipped. */
export function buildCcHistoryRows(fromDs, toDs) {
  const rows = [];
  if(!fromDs || !toDs) return rows;

  let d = new Date(fromDs + 'T00:00:00');
  const end = new Date(toDs + 'T00:00:00');
  if(isNaN(d) || isNaN(end) || d > end) return rows;

  while(d <= end) {
    const ds  = _cbLocalDateStr(d);
    const rec = db.sheets[`${ds}_Evening`];

    if(rec) {
      const alfalah  = parseFloat(rec.inAlfalah)  || 0;
      const keenu    = parseFloat(rec.inKeenu)    || 0;
      const compSale = parseFloat(rec.inCompSale) || 0;
      rows.push({
        date:     ds,
        hasData:  true,
        draft:    rec.draft === true,
        alfalah,
        keenu,
        compSale,
        cc: (alfalah + keenu) - compSale
      });
    } else {
      rows.push({ date: ds, hasData: false, draft: false, alfalah: 0, keenu: 0, compSale: 0, cc: 0 });
    }

    d.setDate(d.getDate() + 1);
  }

  return rows;
}

/* ── Format helpers (local to this report, same conventions as
   pages.js's clFmt/clFmtDate and ledger-nav.js's money()) ────── */
function cchMoney(n) {
  return 'Rs. ' + (parseFloat(n) || 0).toLocaleString('en-PK');
}
function cchFmtDate(ds) {
  try {
    return new Date(ds + 'T00:00:00').toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch(e) { return ds; }
}

/* ── Generate: read the range fields, validate, build + render ── */
export function generateCcHistory() {
  const fromDs = document.getElementById('cch-from-date')?.value;
  const toDs   = document.getElementById('cch-to-date')?.value;

  if(!fromDs || !toDs) { showAlert('Pick both a "From" and "To" date.'); return; }
  if(fromDs > toDs)     { showAlert('The "From" date must be before or equal to the "To" date.'); return; }

  cchState.fromDate = fromDs;
  cchState.toDate   = toDs;
  cchState.rows     = buildCcHistoryRows(fromDs, toDs);
  renderCcHistoryTable(cchState.rows);
}

/* ── Render ───────────────────────────────────────────────── */
export function renderCcHistoryTable(rows) {
  const container = document.getElementById('cch-table');
  const emptyEl   = document.getElementById('cch-empty');
  const summaryEl = document.getElementById('cch-summary-badge');
  const exportBtn = document.getElementById('cch-export-btn');
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
  let totalA = 0, totalB = 0, totalC = 0, totalCC = 0;
  found.forEach(r => { totalA += r.alfalah; totalB += r.keenu; totalC += r.compSale; totalCC += r.cc; });

  let html = `
    <div class="cch-row cch-head-row">
      <span class="cch-cell cch-date">Date</span>
      <span class="cch-cell cch-num">Bank Alfalah (A)</span>
      <span class="cch-cell cch-num">Keenu (B)</span>
      <span class="cch-cell cch-num">Comp. Card Sale (C)</span>
      <span class="cch-cell cch-num">CC = (A+B)−C</span>
    </div>`;

  rows.forEach(r => {
    if(!r.hasData) {
      html += `
        <div class="cch-row cch-row-missing">
          <span class="cch-cell cch-date">${cchFmtDate(r.date)}</span>
          <span class="cch-cell cch-missing-note">No Evening closing recorded</span>
        </div>`;
      return;
    }
    html += `
      <div class="cch-row${r.draft ? ' cch-row-draft' : ''}">
        <span class="cch-cell cch-date">${cchFmtDate(r.date)}${r.draft ? ' <span class="cch-draft-tag">Draft</span>' : ''}</span>
        <span class="cch-cell cch-num">${cchMoney(r.alfalah)}</span>
        <span class="cch-cell cch-num">${cchMoney(r.keenu)}</span>
        <span class="cch-cell cch-num">${cchMoney(r.compSale)}</span>
        <span class="cch-cell cch-num cch-cc${r.cc < 0 ? ' cch-neg' : ''}">${cchMoney(r.cc)}</span>
      </div>`;
  });

  html += `
    <div class="cch-row cch-total-row">
      <span class="cch-cell cch-date">TOTAL (${found.length} of ${rows.length} day${rows.length !== 1 ? 's' : ''})</span>
      <span class="cch-cell cch-num">${cchMoney(totalA)}</span>
      <span class="cch-cell cch-num">${cchMoney(totalB)}</span>
      <span class="cch-cell cch-num">${cchMoney(totalC)}</span>
      <span class="cch-cell cch-num${totalCC < 0 ? ' cch-neg' : ''}">${cchMoney(totalCC)}</span>
    </div>`;

  container.innerHTML = html;

  if(summaryEl) summaryEl.textContent = `${found.length} of ${rows.length} evening closing${rows.length !== 1 ? 's' : ''} found`;
  if(exportBtn) exportBtn.disabled = false;
}

/* ── Export currently-generated report as CSV ───────────────── */
export function exportCcHistoryCsv() {
  if(!cchState.rows.length) return;

  const lines = ['Date,Bank Alfalah Card Machine (A),Keenu Card Machine (B),Computer Card Sale (C),CC = (A+B)-C'];
  cchState.rows.forEach(r => {
    if(!r.hasData) { lines.push(`${r.date},,,,`); return; }
    lines.push(`${r.date},${r.alfalah},${r.keenu},${r.compSale},${r.cc}`);
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `cc-history_${cchState.fromDate}_to_${cchState.toDate}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ── Tab switcher between the two Closing Book sub-reports ──────
   "book" = the original flip-through register (unchanged);
   "cchistory" = this report. Lazily initializes + auto-generates
   CC History the first time it's opened, so switching to it always
   shows something immediately; after that it only re-generates on
   an explicit shortcut/Generate click, never overwriting a range
   the person is mid-edit on. */
export function switchClosingBookPanel(panel) {
  const bookPanel = document.getElementById('cb-book-panel');
  const cchPanel  = document.getElementById('cb-cchistory-panel');
  if(bookPanel) bookPanel.classList.toggle('hidden', panel !== 'book');
  if(cchPanel)  cchPanel.classList.toggle('hidden', panel !== 'cchistory');

  document.getElementById('cb-mode-tab-book')?.classList.toggle('active', panel === 'book');
  document.getElementById('cb-mode-tab-cchistory')?.classList.toggle('active', panel === 'cchistory');

  if(panel === 'cchistory') {
    initCcHistoryDefaults();
    if(!cchState.rows.length) generateCcHistory();
  }
}

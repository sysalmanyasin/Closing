/* ═══════════════════════════════════════════════════════════════════════
   CLOSING BOOK  —  Floor 5.5
   📖 Chronological paginated book reader for shift closing records.
   Reads directly from db.sheets (localStorage), renders data-first PDF-
   style pages without touching the live ledger DOM.
   ═══════════════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────────── */
const CB_SHIFTS      = ['Night', 'Morning', 'Evening'];
const CB_SHIFT_ORDER = { Night: 0, Morning: 1, Evening: 2 };
const CB_DENOMS      = [5000, 1000, 500, 100, 50, 20, 10, 1];
const CB_DENOM_LBLS  = [
  'Rs. 5,000 notes', 'Rs. 1,000 notes', 'Rs. 500 notes',
  'Rs. 100 notes', 'Rs. 50 notes', 'Rs. 20 notes', 'Rs. 10 notes', 'Coins'
];
const CB_STATE_KEY  = 'pharmpos_cb_state';

/* ─────────────────────────────────────────────────────────────
   STATE
───────────────────────────────────────────────────────────── */
let cbState = {
  fromDate  : '',
  fromShift : 'Night',
  toDate    : '',
  toShift   : 'Evening',
  pages     : [],   // assembled page descriptors
  currentPage: 0,
  zoom      : 1,
  readerOpen: false
};

/* touch / pinch tracking */
let _cbTouchX = 0, _cbTouchY = 0, _cbTouchActive = false;
let _cbPinchDist = 0, _cbPinchZoom = 1;

/* ─────────────────────────────────────────────────────────────
   DATE / KEY HELPERS
───────────────────────────────────────────────────────────── */
function cbFmt(ds) {
  try { return new Date(ds + 'T00:00:00').toLocaleDateString('en-PK', { day: 'numeric', month: 'long', year: 'numeric' }); }
  catch(e) { return ds; }
}
function cbFmtShort(ds) {
  try { return new Date(ds + 'T00:00:00').toLocaleDateString('en-PK', { day: 'numeric', month: 'short' }); }
  catch(e) { return ds; }
}
function cbShiftLabel(s) {
  return typeof srLabel === 'function' ? srLabel(s) : s;
}
function cbSortKey(ds, shift) {
  return ds + '_' + (CB_SHIFT_ORDER[shift] ?? 9);
}
function cbSheetKey(ds, shift) {
  return ds + '_' + shift;
}

/* All date-shift slots between (fromDate, fromShift) and (toDate, toShift) inclusive */
function cbGetSlots(fromDate, fromShift, toDate, toShift) {
  const fromSK = cbSortKey(fromDate, fromShift);
  const toSK   = cbSortKey(toDate,   toShift);
  const slots  = [];
  const cur    = new Date(fromDate + 'T00:00:00');
  const end    = new Date(toDate   + 'T00:00:00');

  while (cur <= end) {
    const ds = cur.toISOString().slice(0, 10);
    for (const shift of CB_SHIFTS) {
      const sk = cbSortKey(ds, shift);
      if (sk >= fromSK && sk <= toSK) {
        slots.push({ ds, shift, key: cbSheetKey(ds, shift) });
      }
    }
    cur.setDate(cur.getDate() + 1);
  }
  return slots;
}

/* ─────────────────────────────────────────────────────────────
   ENTRY POINT  —  called by the nav button in index.html
───────────────────────────────────────────────────────────── */
function goToClosingBook() {
  showPage('page-closing-book');
  _cbRestoreState();
  cbRenderLauncher();
}

/* ─────────────────────────────────────────────────────────────
   STATE PERSISTENCE
───────────────────────────────────────────────────────────── */
function _cbRestoreState() {
  try {
    const s = JSON.parse(localStorage.getItem(CB_STATE_KEY) || 'null');
    if (s) {
      cbState.fromDate   = s.fromDate   || '';
      cbState.fromShift  = s.fromShift  || 'Night';
      cbState.toDate     = s.toDate     || '';
      cbState.toShift    = s.toShift    || 'Evening';
      cbState.currentPage= s.currentPage || 0;
      cbState.zoom       = s.zoom        || 1;
    }
  } catch(e) {}
  if (!cbState.fromDate || !cbState.toDate) cbSetQuickRange(3);
}

function _cbSaveState() {
  try {
    localStorage.setItem(CB_STATE_KEY, JSON.stringify({
      fromDate   : cbState.fromDate,
      fromShift  : cbState.fromShift,
      toDate     : cbState.toDate,
      toShift    : cbState.toShift,
      currentPage: cbState.currentPage,
      zoom       : cbState.zoom
    }));
  } catch(e) {}
}

/* ─────────────────────────────────────────────────────────────
   QUICK RANGE SHORTCUTS
───────────────────────────────────────────────────────────── */
function cbSetQuickRange(days) {
  const today  = new Date();
  const from   = new Date(today);
  from.setDate(today.getDate() - (days - 1));
  cbState.toDate    = today.toISOString().slice(0, 10);
  cbState.toShift   = 'Evening';
  cbState.fromDate  = from.toISOString().slice(0, 10);
  cbState.fromShift = 'Night';
}

function cbQuick(days) {
  if (days === 30) {
    const today = new Date();
    const from  = new Date(today);
    from.setDate(today.getDate() - 30);
    cbState.toDate    = today.toISOString().slice(0, 10);
    cbState.toShift   = 'Evening';
    cbState.fromDate  = from.toISOString().slice(0, 10);
    cbState.fromShift = 'Night';
  } else {
    cbSetQuickRange(days);
  }
  _cbSaveState();
  cbRenderLauncher();
}

/* ─────────────────────────────────────────────────────────────
   LAUNCHER UI
───────────────────────────────────────────────────────────── */
function cbRenderLauncher() {
  const panel = document.getElementById('book-launcher');
  if (!panel) return;

  const savedHtml = _cbRecentHtml();

  panel.innerHTML = `
    <div class="cb-launcher-inner">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
        <div class="cb-launcher-title">📖 Closing Book</div>
        <button class="btn btn-ghost btn-sm" onclick="goToDashboard()" style="font-size:0.75rem;">← Dashboard</button>
      </div>
      <p class="cb-launcher-sub">Compile a chronological, print-ready PDF book of closing sheets for any date range.</p>

      <!-- Quick shortcuts -->
      <div class="cb-quick-row">
        <button class="cb-quick-btn" onclick="cbQuick(3)">3 Days</button>
        <button class="cb-quick-btn" onclick="cbQuick(7)">7 Days</button>
        <button class="cb-quick-btn" onclick="cbQuick(30)">1 Month</button>
      </div>

      <!-- Range picker -->
      <div class="cb-range-card">
        <div class="cb-range-row">
          <div class="cb-range-group">
            <div class="cb-range-label">From Date</div>
            <input type="date" id="cb-from-date" class="cb-date-input"
              value="${cbState.fromDate}"
              oninput="cbState.fromDate=this.value;_cbSaveState()">
          </div>
          <div class="cb-range-group">
            <div class="cb-range-label">From Shift</div>
            <select id="cb-from-shift" class="cb-shift-select"
              onchange="cbState.fromShift=this.value;_cbSaveState()">
              ${CB_SHIFTS.map(s => `<option value="${s}"${cbState.fromShift===s?' selected':''}>${s}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="cb-range-row">
          <div class="cb-range-group">
            <div class="cb-range-label">To Date</div>
            <input type="date" id="cb-to-date" class="cb-date-input"
              value="${cbState.toDate}"
              oninput="cbState.toDate=this.value;_cbSaveState()">
          </div>
          <div class="cb-range-group">
            <div class="cb-range-label">To Shift</div>
            <select id="cb-to-shift" class="cb-shift-select"
              onchange="cbState.toShift=this.value;_cbSaveState()">
              ${CB_SHIFTS.map(s => `<option value="${s}"${cbState.toShift===s?' selected':''}>${s}</option>`).join('')}
            </select>
          </div>
        </div>
        <button class="btn btn-teal btn-full" style="margin-top:14px;" onclick="cbOpenBook()">
          📖 Open Closing Book
        </button>
      </div>

      ${savedHtml}
    </div>`;
}

function _cbRecentHtml() {
  try {
    const s = JSON.parse(localStorage.getItem(CB_STATE_KEY) || 'null');
    if (!s || !s.fromDate || !s.toDate) return '';
    return `
      <div class="cb-recent-card">
        <div class="cb-recent-title">📑 Last Session</div>
        <div class="cb-recent-meta">
          ${cbFmt(s.fromDate)} (${s.fromShift})
          &nbsp;→&nbsp;
          ${cbFmt(s.toDate)} (${s.toShift})
        </div>
        <button class="btn btn-ghost btn-sm" style="margin-top:8px;" onclick="cbOpenBook()">Resume →</button>
      </div>`;
  } catch(e) { return ''; }
}

/* ─────────────────────────────────────────────────────────────
   ASSEMBLE PAGES
───────────────────────────────────────────────────────────── */
function cbAssemblePages() {
  const { fromDate, fromShift, toDate, toShift } = cbState;
  const slots  = cbGetSlots(fromDate, fromShift, toDate, toShift);
  if (!slots.length) return [];

  const pages = [];
  /* 0 — Cover */
  pages.push({ type: 'cover', pageLabel: 'Cover' });

  slots.forEach((slot, idx) => {
    const rec    = (typeof getRealSheet === 'function') ? getRealSheet(slot.key) : null;
    const isLast = idx === slots.length - 1;

    if (!rec) {
      pages.push({ type: 'placeholder', ...slot,
        pageLabel: `${cbFmtShort(slot.ds)} ${slot.shift}` });
    } else {
      pages.push({ type: 'shift', ...slot, rec,
        pageLabel: `${cbFmtShort(slot.ds)} ${slot.shift}` });

      /* Last slot always gets a Final Agg page; final-mode slots also get one */
      if (isLast || rec.profileMode === 'final') {
        pages.push({ type: 'final-agg', ...slot, rec,
          pageLabel: `${cbFmtShort(slot.ds)} ${slot.shift} (Agg)` });
      }
    }
  });

  return pages;
}

/* ─────────────────────────────────────────────────────────────
   OPEN BOOK
───────────────────────────────────────────────────────────── */
function cbOpenBook() {
  /* read current picker values */
  const fd = document.getElementById('cb-from-date');
  const fs = document.getElementById('cb-from-shift');
  const td = document.getElementById('cb-to-date');
  const ts = document.getElementById('cb-to-shift');
  if (fd) cbState.fromDate   = fd.value;
  if (fs) cbState.fromShift  = fs.value;
  if (td) cbState.toDate     = td.value;
  if (ts) cbState.toShift    = ts.value;

  if (!cbState.fromDate || !cbState.toDate) {
    alert('Please select both From and To dates.');
    return;
  }
  if (cbState.fromDate > cbState.toDate) {
    alert('From date must be before or equal to To date.');
    return;
  }

  _cbSaveState();
  cbState.pages = cbAssemblePages();

  if (cbState.pages.length <= 1) {
    alert('No closing records found in the selected range.\nSave some shifts first, then open the book.');
    return;
  }

  /* clamp saved page index */
  if (cbState.currentPage >= cbState.pages.length) cbState.currentPage = 0;

  _cbShowReader();
}

/* ─────────────────────────────────────────────────────────────
   READER LIFECYCLE
───────────────────────────────────────────────────────────── */
function _cbShowReader() {
  document.getElementById('book-launcher').classList.add('hidden');
  const reader = document.getElementById('book-reader');
  reader.classList.remove('hidden');
  cbState.readerOpen = true;

  _cbRenderPages();
  _cbGoToPage(cbState.currentPage, false);
  _cbUpdateUI();
  _cbInitGestures();
}

function cbCloseReader() {
  const reader   = document.getElementById('book-reader');
  const launcher = document.getElementById('book-launcher');
  reader.classList.add('hidden');
  launcher.classList.remove('hidden');
  cbState.readerOpen = false;
  _cbSaveState();
  cbRenderLauncher();
}

/* ─────────────────────────────────────────────────────────────
   PAGE RENDERING
───────────────────────────────────────────────────────────── */
function _cbRenderPages() {
  const track = document.getElementById('cb-pages-track');
  if (!track) return;
  track.innerHTML = '';
  const total = cbState.pages.length;
  cbState.pages.forEach((pg, idx) => {
    const div = document.createElement('div');
    div.className = 'cb-page';
    div.id = `cb-page-${idx}`;
    div.innerHTML = _cbBuildPageHTML(pg, idx + 1, total);
    track.appendChild(div);
  });
}

function _cbBuildPageHTML(pg, num, total) {
  switch(pg.type) {
    case 'cover':      return _cbCoverHTML(num, total);
    case 'placeholder':return _cbPlaceholderHTML(pg, num, total);
    case 'shift':      return _cbShiftHTML(pg, num, total);
    case 'final-agg':  return _cbFinalAggHTML(pg, num, total);
    default: return '';
  }
}

/* ── helpers ── */
const _cbN  = v => parseFloat(v) || 0;
const _cbFmt= v => _cbN(v).toLocaleString('en-PK');
/* Escape user-controlled strings before injecting into innerHTML */
const _cbEsc= s => String(s ?? '')
  .replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const _cbRow= (lbl, val, cls='') =>
  `<div class="cb-ps-row${cls?' '+cls:''}"><span>${_cbEsc(lbl)}</span><span>${_cbEsc(val)}</span></div>`;
const _cbRowIf= (lbl, v, cls='') => {
  const n = _cbN(v);
  return n !== 0 ? _cbRow(lbl, n.toLocaleString('en-PK'), cls) : _cbRow(lbl, '—', cls + ' cb-ps-empty');
};
const _cbBranchName = () => _cbEsc(
  (typeof db !== 'undefined' && db.settings && db.settings.branchName)
    ? db.settings.branchName
    : 'Bahria Town Branch'
);

/* ── COVER PAGE ── */
function _cbCoverHTML(num, total) {
  const { fromDate, fromShift, toDate, toShift } = cbState;
  const slots = cbGetSlots(fromDate, fromShift, toDate, toShift);
  let recorded = 0, finals = 0, netSale = 0, netCash = 0;
  slots.forEach(sl => {
    const r = (typeof getRealSheet === 'function') ? getRealSheet(sl.key) : null;
    if (r) {
      recorded++;
      if (r.profileMode === 'final') finals++;
      netSale += _cbN(r.outNetSale);
      netCash += _cbN(r.outNetCash);
    }
  });
  const missing  = slots.length - recorded;
  const genStamp = new Date().toLocaleString('en-PK', {
    day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });

  return `
    <div class="cb-ps-page cb-ps-cover">
      <div class="cb-ps-spine cb-ps-spine-cover">
        <div class="cb-ps-spine-label">Closing Book</div>
      </div>
      <div class="cb-ps-content">
        <div class="cb-cover-brand">
          <div class="cb-cover-emoji">💊</div>
          <h1>Fazal Din's Pharma Plus</h1>
          <p>${_cbBranchName()}</p>
        </div>

        <div class="cb-cover-title-box">
          <div class="cb-cover-big">CLOSING BOOK</div>
          <div class="cb-cover-range">
            ${cbFmt(fromDate)} <span class="cb-cover-shift-tag">${fromShift}</span>
            <span class="cb-cover-arrow">→</span>
            ${cbFmt(toDate)} <span class="cb-cover-shift-tag">${toShift}</span>
          </div>
        </div>

        <div class="cb-cover-stats-row">
          <div class="cb-cover-stat">
            <div class="cb-cover-stat-val">${slots.length}</div>
            <div class="cb-cover-stat-lbl">Total Slots</div>
          </div>
          <div class="cb-cover-stat">
            <div class="cb-cover-stat-val">${recorded}</div>
            <div class="cb-cover-stat-lbl">Recorded</div>
          </div>
          <div class="cb-cover-stat">
            <div class="cb-cover-stat-val">${finals}</div>
            <div class="cb-cover-stat-lbl">Finals</div>
          </div>
          <div class="cb-cover-stat" style="${missing>0?'color:#ef4444':''}">
            <div class="cb-cover-stat-val">${missing}</div>
            <div class="cb-cover-stat-lbl">Missing</div>
          </div>
        </div>

        <div class="cb-cover-totals">
          <div class="cb-cover-total-row">
            <span>Period Net Sale</span>
            <span>Rs. ${netSale.toLocaleString('en-PK')}</span>
          </div>
          <div class="cb-cover-total-row">
            <span>Period Net Cash</span>
            <span>Rs. ${netCash.toLocaleString('en-PK')}</span>
          </div>
        </div>

        <div class="cb-cover-foot">
          Generated ${genStamp} · Fazal Din's Pharma Plus — Shift Register
        </div>
      </div>
    </div>`;
}

/* ── PLACEHOLDER PAGE ── */
function _cbPlaceholderHTML(pg, num, total) {
  return `
    <div class="cb-ps-page cb-ps-placeholder">
      <div class="cb-ps-spine"><div class="cb-ps-spine-label">${pg.shift} · ${pg.ds}</div></div>
      <div class="cb-ps-content cb-ps-placeholder-content">
        <div class="cb-placeholder-icon">📭</div>
        <div class="cb-placeholder-text">No closing recorded</div>
        <div class="cb-placeholder-sub">${cbFmt(pg.ds)} — ${pg.shift} Shift</div>
        <div class="cb-placeholder-foot">Page ${num} of ${total}</div>
      </div>
    </div>`;
}

/* ── SHIFT DETAIL PAGE ── */
function _cbShiftHTML(pg, num, total) {
  const { rec, ds, shift } = pg;
  const mode = rec.profileMode || 'shift';

  /* ---- derived totals ---- */
  const totalReturns = _cbN(rec.posRet1) + _cbN(rec.posRet2) + _cbN(rec.posRet3) + _cbN(rec.posRetSys);
  const totalHs      = (rec.hsRows || []).reduce((s,r) => s + _cbN(r.val), 0);

  let totalStrips = 0;
  if (rec.stripQtys && rec.stripPrices) {
    rec.stripQtys.forEach((q,i) => { totalStrips += _cbN(q) * _cbN(rec.stripPrices[i]); });
  }
  (rec.auxStrips || []).forEach(s => { totalStrips += _cbN(s.p) * _cbN(s.q); });

  const totalG   = (rec.miscRows || []).reduce((s,r) => s + _cbN(r.val), 0);

  let tillTotal = 0;
  (rec.tillValues || []).forEach((v,i) => { tillTotal += _cbN(v) * CB_DENOMS[i]; });

  let vaultTotal = 0;
  (rec.vaultValues || []).forEach((v,i) => { vaultTotal += _cbN(v) * CB_DENOMS[i]; });

  const prevCC   = _cbN(rec.outPrevCC);
  const currCC   = _cbN(rec.outCurrCC);
  const grand    = totalHs + totalStrips + totalG + prevCC + currCC + tillTotal + vaultTotal + _cbN(rec.outTotalE) + _cbN(rec.outTotalF);
  const liquid   = grand - 45000;
  const netCash  = _cbN(rec.outNetCash);
  const netSale  = _cbN(rec.outNetSale);
  const diff     = netCash - netSale;
  const diffLbl  = diff === 0 ? 'Variance' : diff > 0 ? 'Plus' : 'Less';
  const diffAbs  = Math.abs(diff);
  const isShort  = diff < 0;

  /* ---- section blocks ---- */
  /* Till Cash */
  let tillRows = '';
  (rec.tillValues || []).forEach((v,i) => {
    if (_cbN(v) !== 0) tillRows += _cbRow(CB_DENOM_LBLS[i], _cbN(v).toLocaleString('en-PK'));
  });
  if (!tillRows) tillRows = _cbRow('— none —', '', 'cb-ps-empty');
  tillRows += _cbRow('TOTAL TILL CASH (E)', tillTotal.toLocaleString('en-PK'), 'cb-ps-total');

  /* Vault Cash */
  let vaultRows = '';
  (rec.vaultValues || []).forEach((v,i) => {
    if (_cbN(v) !== 0) vaultRows += _cbRow(CB_DENOM_LBLS[i], _cbN(v).toLocaleString('en-PK'));
  });
  if (!vaultRows) vaultRows = _cbRow('— none —', '', 'cb-ps-empty');
  vaultRows += _cbRow('TOTAL DRAW CASH (F)', vaultTotal.toLocaleString('en-PK'), 'cb-ps-total');

  /* Deposits */
  let depRows = _cbRowIf('Carried from Previous', rec.outPrevDep);
  (rec.deposits || []).forEach(o => {
    if (_cbN(o.val) !== 0 && o.lbl) depRows += _cbRow(o.lbl, _cbN(o.val).toLocaleString('en-PK'));
  });
  depRows += _cbRow('TOTAL DEPOSITS (H)', _cbFmt(rec.outTotalF), 'cb-ps-total');

  /* Grand summary */
  let sumRows = '';
  sumRows += _cbRow('HS + Strips (A+B)', (totalHs + totalStrips).toLocaleString('en-PK'));
  sumRows += _cbRow('Misc (C)', totalG.toLocaleString('en-PK'));
  sumRows += _cbRow('CC Card Sales (D)', (prevCC + currCC).toLocaleString('en-PK'));
  sumRows += _cbRow('Till Cash (E)', tillTotal.toLocaleString('en-PK'));
  sumRows += _cbRow('Draw Cash (F)', vaultTotal.toLocaleString('en-PK'));
  sumRows += _cbRow('Credit Detail (G)', _cbFmt(rec.outTotalE));
  sumRows += _cbRow('Deposits (H)', _cbFmt(rec.outTotalF));
  sumRows += _cbRow('GRAND TOTAL', grand.toLocaleString('en-PK'), 'cb-ps-total');
  sumRows += _cbRow('Less: Float Reserve', '− 45,000', 'cb-ps-minus');
  sumRows += _cbRow('Net Liquid', liquid.toLocaleString('en-PK'));
  sumRows += _cbRow('Less: Prev Cash Pos.', `− ${_cbFmt(rec.outPrevCash)}`, 'cb-ps-minus');
  if (_cbN(rec.extraCash) !== 0)
    sumRows += _cbRow('Less: Extra Cash', `− ${_cbFmt(rec.extraCash)}`, 'cb-ps-minus');
  sumRows += _cbRow('NET CASH AVAILABLE', netCash.toLocaleString('en-PK'), 'cb-ps-highlight');

  /* HS + Strips */
  let stripRows = '';
  (rec.hsRows || []).forEach(r => {
    if (r.lbl && _cbN(r.val) !== 0) stripRows += _cbRow(r.lbl, _cbN(r.val).toLocaleString('en-PK'));
  });
  if (rec.stripQtys) {
    const strips = (typeof db !== 'undefined' && db.settings && db.settings.strips) ? db.settings.strips : [];
    rec.stripQtys.forEach((qty, i) => {
      const s     = strips[i] || {};
      const price = rec.stripPrices ? _cbN(rec.stripPrices[i]) : _cbN(s.price);
      const q     = _cbN(qty);
      const name  = s.name || `Item ${i+1}`;
      if (q !== 0) stripRows += _cbRow(`${name} ×${q}`, (price * q).toLocaleString('en-PK'));
    });
  }
  (rec.auxStrips || []).forEach(s => {
    if (s.label && _cbN(s.q) !== 0)
      stripRows += _cbRow(`${s.label} ×${_cbN(s.q)}`, (_cbN(s.p) * _cbN(s.q)).toLocaleString('en-PK'));
  });
  if (!stripRows) stripRows = _cbRow('— none —', '', 'cb-ps-empty');
  stripRows += _cbRow('TOTAL HS + STRIPS (A+B)', (totalHs + totalStrips).toLocaleString('en-PK'), 'cb-ps-total');

  /* Misc */
  let miscRows = '';
  (rec.miscRows || []).forEach(o => {
    if (o.label) miscRows += _cbRow(o.label, _cbN(o.val).toLocaleString('en-PK'));
  });
  if (!miscRows) miscRows = _cbRow('— none —', '', 'cb-ps-empty');
  miscRows += _cbRow('TOTAL MISC (C)', totalG.toLocaleString('en-PK'), 'cb-ps-total');

  /* Sale + CC */
  let saleRows  = '';
  saleRows += _cbRow('Computer Cash Sales', _cbFmt(rec.inSysCash));
  saleRows += _cbRow('Shift Sale (delta)', _cbFmt(rec.outShiftSale));
  saleRows += _cbRow('Book Bill 1', _cbFmt(rec.inBook1));
  saleRows += _cbRow('Book Bill 2', _cbFmt(rec.inBook2));
  saleRows += _cbRow('Customers', _cbFmt(rec.outCust));
  saleRows += _cbRow('Last Bill #', rec.inLastBillNum || '—');
  saleRows += _cbRow('Last Bill Amt', _cbFmt(rec.inLastBillAmt));

  let ccRows = '';
  ccRows += _cbRow('Alfalah Machine', _cbFmt(rec.inAlfalah));
  ccRows += _cbRow('Keenu Machine', _cbFmt(rec.inKeenu));
  ccRows += _cbRowIf('Computer Card Sale (−)', rec.inCompSale, 'cb-ps-minus');
  ccRows += _cbRow('Current CC (D)', _cbFmt(rec.outCurrCC));
  ccRows += _cbRowIf('Previous CC (carried)', rec.outPrevCC);
  ccRows += _cbRow('TOTAL CC (D)', (prevCC + currCC).toLocaleString('en-PK'), 'cb-ps-total');

  /* Returns + Net Sale */
  let retRows = '';
  retRows += _cbRowIf('Return 1', rec.posRet1, 'cb-ps-minus');
  retRows += _cbRowIf('Return 2', rec.posRet2, 'cb-ps-minus');
  retRows += _cbRowIf('Return 3', rec.posRet3, 'cb-ps-minus');
  retRows += _cbRowIf('System Return', rec.posRetSys, 'cb-ps-minus');
  retRows += _cbRow('TOTAL RETURNS', totalReturns.toLocaleString('en-PK'), 'cb-ps-total');
  retRows += _cbRow('NET SHIFT SALE', netSale.toLocaleString('en-PK'), 'cb-ps-highlight');

  /* Credit */
  let credRows = '';
  credRows += _cbRowIf('Carried Debt (prev.)', rec.outPrevCredit);
  if (_cbN(rec.creditAdj) !== 0 || _cbN(rec.inCreditAdj) !== 0)
    credRows += _cbRow('Adjustment', _cbFmt(rec.creditAdj || rec.inCreditAdj));
  (rec.namedCredits || []).forEach(o => {
    if (_cbN(o.val) !== 0) {
      const lbl = o.desc ? `${o.lbl} — ${o.desc}` : o.lbl;
      credRows += _cbRow(lbl, _cbN(o.val).toLocaleString('en-PK'));
    }
  });
  (rec.tierCredits || []).forEach(o => {
    if (_cbN(o.val) !== 0 && o.name) credRows += _cbRow(o.name, _cbN(o.val).toLocaleString('en-PK'));
  });
  (rec.auxCredits || []).forEach(o => {
    if (_cbN(o.val) !== 0 && o.lbl) credRows += _cbRow(o.lbl, _cbN(o.val).toLocaleString('en-PK'));
  });
  if (!credRows) credRows = _cbRow('— none —', '', 'cb-ps-empty');
  credRows += _cbRow('TOTAL CREDIT (G)', _cbFmt(rec.outTotalE), 'cb-ps-total');

  const statusLbl = rec.locked ? 'CLOSED' : (rec.draft ? 'DRAFT' : 'OPEN');

  return `
    <div class="cb-ps-page cb-ps-shift">
      <div class="cb-ps-spine">
        <div class="cb-ps-spine-label">${cbShiftLabel(shift)} · ${ds}</div>
      </div>
      <div class="cb-ps-content">

        <!-- Letterhead -->
        <div class="cb-ps-lh">
          <div class="cb-ps-lh-brand">
            <h1>Fazal Din's Pharma Plus</h1>
            <p>${_cbBranchName()}</p>
          </div>
          <div class="cb-ps-lh-type">
            <span class="cb-ps-type-tag">${mode === 'final' ? 'Final Closing' : 'Shift Closing'}</span>
            <div class="cb-ps-type-meta">${ds} · ${cbShiftLabel(shift)} · ${statusLbl} · Pg ${num}/${total}</div>
          </div>
        </div>

        <!-- ID chips -->
        <div class="cb-ps-chips">
          <div class="cb-ps-chip"><div class="cb-chip-lbl">Date</div><div class="cb-chip-val">${ds}</div></div>
          <div class="cb-ps-chip"><div class="cb-chip-lbl">Shift</div><div class="cb-chip-val">${cbShiftLabel(shift)}</div></div>
          <div class="cb-ps-chip"><div class="cb-chip-lbl">Mode</div><div class="cb-chip-val">${mode.toUpperCase()}</div></div>
          <div class="cb-ps-chip"><div class="cb-chip-lbl">Status</div><div class="cb-chip-val">${statusLbl}</div></div>
        </div>

        <!-- Three-column body -->
        <div class="cb-ps-cols3">
          <!-- Col 1 -->
          <div class="cb-ps-col">
            <div class="cb-ps-box"><h4>Till Cash (E)</h4>${tillRows}</div>
            <div class="cb-ps-box"><h4>Draw / Vault Cash (F)</h4>${vaultRows}</div>
            <div class="cb-ps-box"><h4>Deposits (H)</h4>${depRows}</div>
            <div class="cb-ps-box cb-ps-box-accent"><h4>Grand Summary</h4>${sumRows}</div>
          </div>
          <!-- Col 2 -->
          <div class="cb-ps-col">
            <div class="cb-ps-box"><h4>HS + Strips (A+B)</h4>${stripRows}</div>
            <div class="cb-ps-box"><h4>Misc Charges (C)</h4>${miscRows}</div>
          </div>
          <!-- Col 3 -->
          <div class="cb-ps-col">
            <div class="cb-ps-box"><h4>Sale Info</h4>${saleRows}</div>
            <div class="cb-ps-box"><h4>Credit Card Sales (D)</h4>${ccRows}</div>
            <div class="cb-ps-box cb-ps-box-accent"><h4>Returns &amp; Net Sale</h4>${retRows}</div>
            <div class="cb-ps-box"><h4>Credit Detail (G)</h4>${credRows}</div>
          </div>
        </div>

        <!-- Hero variance banner -->
        <div class="cb-ps-hero${isShort ? ' cb-ps-hero-short' : ''}">
          <div>
            <div class="cb-ps-hero-lbl">${diffLbl} — Net Cash vs Net Sale</div>
            <div class="cb-ps-hero-val">Rs. ${diffAbs.toLocaleString('en-PK')}</div>
          </div>
          <div class="cb-ps-hero-sub">
            Net Cash Available minus Net Shift Sale.
            Zero means the till matches exactly.
          </div>
        </div>
      </div>

      <div class="cb-ps-foot">
        <span>Fazal Din's Pharma Plus — Closing Book</span>
        <span>Page ${num} of ${total}</span>
      </div>
    </div>`;
}

/* ── FINAL AGGREGATION PAGE ── */
function _cbFinalAggHTML(pg, num, total) {
  const { rec, ds, shift } = pg;
  const finalNetSale = _cbN(rec.finalNetSale);
  const finalNetCash = _cbN(rec.finalNetCash);
  const finalDiff    = _cbN(rec.finalDiff);
  const finalDiffLbl = rec.finalDiffLabel || 'Variance';
  const isShort      = finalDiffLbl.toLowerCase().includes('less');

  return `
    <div class="cb-ps-page cb-ps-final-agg">
      <div class="cb-ps-spine cb-ps-spine-final">
        <div class="cb-ps-spine-label">Final Agg · ${ds}</div>
      </div>
      <div class="cb-ps-content">

        <!-- Letterhead -->
        <div class="cb-ps-lh">
          <div class="cb-ps-lh-brand">
            <h1>Fazal Din's Pharma Plus</h1>
            <p>${_cbBranchName()}</p>
          </div>
          <div class="cb-ps-lh-type">
            <span class="cb-ps-type-tag cb-ps-type-final">Final Aggregation</span>
            <div class="cb-ps-type-meta">${ds} · ${cbShiftLabel(shift)} · Pg ${num}/${total}</div>
          </div>
        </div>

        <!-- ID chips -->
        <div class="cb-ps-chips">
          <div class="cb-ps-chip"><div class="cb-chip-lbl">Date</div><div class="cb-chip-val">${ds}</div></div>
          <div class="cb-ps-chip"><div class="cb-chip-lbl">Shift</div><div class="cb-chip-val">${cbShiftLabel(shift)}</div></div>
          <div class="cb-ps-chip"><div class="cb-chip-lbl">Mode</div><div class="cb-chip-val">${(rec.profileMode||'shift').toUpperCase()}</div></div>
          <div class="cb-ps-chip" style="border-color:#7c3aed;"><div class="cb-chip-lbl">Type</div><div class="cb-chip-val" style="color:#7c3aed;">PERIOD AGG</div></div>
        </div>

        <!-- Two-column grid -->
        <div class="cb-ps-grid2">
          <div class="cb-ps-box cb-ps-box-final">
            <h4>📊 Net Final Sale</h4>
            ${_cbRowIf('Additional Sys Returns (−)', rec.finalSysReturns, 'cb-ps-minus')}
            ${_cbRow('NET FINAL SALE', finalNetSale.toLocaleString('en-PK'), 'cb-ps-highlight')}
          </div>
          <div class="cb-ps-box cb-ps-box-final">
            <h4>💵 Net Final Cash</h4>
            ${_cbRow('NET FINAL CASH', finalNetCash.toLocaleString('en-PK'), 'cb-ps-highlight')}
          </div>
        </div>

        <!-- Variance box -->
        <div class="cb-ps-box" style="margin-top:16px;">
          <h4>⚖️ Period Variance</h4>
          ${_cbRow(finalDiffLbl, 'Rs. ' + finalDiff.toLocaleString('en-PK'),
              isShort ? 'cb-ps-minus' : 'cb-ps-highlight')}
        </div>

        <!-- Hero -->
        <div class="cb-ps-hero${isShort ? ' cb-ps-hero-short' : ''}" style="margin-top:16px;">
          <div>
            <div class="cb-ps-hero-lbl">${finalDiffLbl} — Period Reconciliation</div>
            <div class="cb-ps-hero-val">Rs. ${finalDiff.toLocaleString('en-PK')}</div>
          </div>
          <div class="cb-ps-hero-sub">
            Net Final Cash compared to Net Final Sale across the period since the last Final Closing.
          </div>
        </div>
      </div>

      <div class="cb-ps-foot">
        <span>Fazal Din's Pharma Plus — Closing Book</span>
        <span>Page ${num} of ${total}</span>
      </div>
    </div>`;
}

/* ─────────────────────────────────────────────────────────────
   NAVIGATION
───────────────────────────────────────────────────────────── */
function _cbGoToPage(idx, animate = true) {
  const total = cbState.pages.length;
  idx = Math.max(0, Math.min(total - 1, idx));
  cbState.currentPage = idx;

  const track = document.getElementById('cb-pages-track');
  if (!track) return;

  track.style.transition = animate
    ? 'transform 0.38s cubic-bezier(0.4, 0, 0.2, 1)'
    : 'none';
  track.style.transform = `translateX(calc(-${idx} * 100%))`;

  _cbUpdateUI();
  _cbSaveState();
}

function cbNavigate(dir) {
  _cbGoToPage(cbState.currentPage + dir);
}

function cbJumpToPage(idx) {
  _cbGoToPage(parseInt(idx, 10));
}

/* ─────────────────────────────────────────────────────────────
   UI SYNC
───────────────────────────────────────────────────────────── */
function _cbUpdateUI() {
  const total = cbState.pages.length;
  const idx   = cbState.currentPage;
  const pg    = cbState.pages[idx];

  const el = id => document.getElementById(id);
  if (el('cb-page-counter')) el('cb-page-counter').textContent = `${idx + 1} / ${total}`;
  if (el('cb-page-label'))   el('cb-page-label').textContent   = pg ? pg.pageLabel : '';
  if (el('cb-btn-prev'))     el('cb-btn-prev').disabled        = idx === 0;
  if (el('cb-btn-next'))     el('cb-btn-next').disabled        = idx === total - 1;

  /* populate/sync jump select */
  const jumpSel = el('cb-jump-select');
  if (jumpSel) {
    if (jumpSel.options.length !== total) {
      jumpSel.innerHTML = '';
      cbState.pages.forEach((p, i) => {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = `${i + 1}. ${p.pageLabel || p.type}`;
        jumpSel.appendChild(o);
      });
    }
    jumpSel.value = String(idx);
  }

  /* sync zoom buttons */
  document.querySelectorAll('.cb-zoom-btn').forEach(btn => {
    btn.classList.toggle('cb-zoom-active', parseFloat(btn.dataset.zoom) === cbState.zoom);
  });

  _cbApplyZoom();
}

/* ─────────────────────────────────────────────────────────────
   ZOOM
───────────────────────────────────────────────────────────── */
function cbSetZoom(level) {
  cbState.zoom = level;
  _cbApplyZoom();
  _cbSaveState();
  document.querySelectorAll('.cb-zoom-btn').forEach(btn => {
    btn.classList.toggle('cb-zoom-active', parseFloat(btn.dataset.zoom) === level);
  });
}

function _cbApplyZoom() {
  const z = cbState.zoom;
  document.querySelectorAll('#cb-pages-track .cb-page').forEach(page => {
    if (z === 1) {
      page.style.transform       = '';
      page.style.transformOrigin = '';
      page.style.overflowY       = 'hidden';
    } else {
      page.style.transform       = `scale(${z})`;
      page.style.transformOrigin = 'top center';
      page.style.overflowY       = 'auto';
    }
  });
}

/* ─────────────────────────────────────────────────────────────
   GESTURES  (swipe + pinch-to-zoom)
───────────────────────────────────────────────────────────── */
function _cbInitGestures() {
  /* Replace element to remove stale listeners */
  const old = document.getElementById('cb-pages-viewport');
  if (!old) return;
  const vp = old.cloneNode(true);
  old.parentNode.replaceChild(vp, old);

  /* Re-attach child track reference */
  const track = vp.querySelector('#cb-pages-track');
  if (track) {
    _cbRenderPages();     /* re-render into new DOM subtree */
    _cbGoToPage(cbState.currentPage, false);
    _cbApplyZoom();
  }

  vp.addEventListener('touchstart', _cbTouchStart, { passive: true });
  vp.addEventListener('touchmove',  _cbTouchMove,  { passive: true });
  vp.addEventListener('touchend',   _cbTouchEnd,   { passive: true });
}

function _cbTouchStart(e) {
  if (e.touches.length === 2) {
    _cbPinchDist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    _cbPinchZoom    = cbState.zoom;
    _cbTouchActive  = false;
  } else {
    _cbTouchX      = e.touches[0].clientX;
    _cbTouchY      = e.touches[0].clientY;
    _cbTouchActive = true;
    _cbPinchDist   = 0;
  }
}

function _cbTouchMove(e) {
  if (e.touches.length === 2 && _cbPinchDist > 0) {
    _cbTouchActive = false;
    const dist  = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    const raw   = Math.max(0.8, Math.min(8, _cbPinchZoom * (dist / _cbPinchDist)));
    /* live preview without snapping */
    document.querySelectorAll('#cb-pages-track .cb-page').forEach(page => {
      page.style.transform       = raw > 1 ? `scale(${raw})` : '';
      page.style.transformOrigin = raw > 1 ? 'top center' : '';
    });
  }
}

function _cbTouchEnd(e) {
  /* Swipe detection */
  if (e.changedTouches.length === 1 && _cbTouchActive) {
    const dx = e.changedTouches[0].clientX - _cbTouchX;
    const dy = e.changedTouches[0].clientY - _cbTouchY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 48) {
      cbNavigate(dx < 0 ? 1 : -1);
    }
    _cbTouchActive = false;
  }

  /* Snap zoom after pinch ends */
  if (_cbPinchDist > 0 && e.touches.length === 0) {
    /* Read the current live scale from the first page element */
    const firstPage = document.querySelector('#cb-pages-track .cb-page');
    if (firstPage) {
      const m   = firstPage.style.transform.match(/scale\(([^)]+)\)/);
      const raw = m ? parseFloat(m[1]) : cbState.zoom;
      const levels = [1, 2, 4, 8];
      const snapped = levels.reduce((best, l) =>
        Math.abs(l - raw) < Math.abs(best - raw) ? l : best, 1);
      cbSetZoom(snapped);
    }
    _cbPinchDist = 0;
  }
}

/* Keyboard navigation — only active when reader is open */
document.addEventListener('keydown', e => {
  if (!cbState.readerOpen) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); cbNavigate(1); }
  if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   { e.preventDefault(); cbNavigate(-1); }
  if (e.key === 'Escape') cbCloseReader();
});

/* ─────────────────────────────────────────────────────────────
   PRINT  (browser print dialog)
───────────────────────────────────────────────────────────── */
function cbPrint() {
  const track = document.getElementById('cb-pages-track');
  if (!track) return;

  const { fromDate, fromShift, toDate, toShift } = cbState;
  /* Spec: "FDPP BT Closing {FromShift} {FromDate} to {ToShift} {ToDate}"
     Use raw YYYY-MM-DD tokens — safe for filenames, unambiguous across locales. */
  const filename = `FDPP BT Closing ${fromShift} ${fromDate} to ${toShift} ${toDate}`;

  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) { alert('Please allow pop-ups to print.'); return; }

  win.document.write(`<!DOCTYPE html><html><head>
    <title>${filename}</title>
    <meta charset="UTF-8">
    <style>
      *{box-sizing:border-box;margin:0;padding:0;}
      body{font-family:'Inter',Arial,sans-serif;background:#fff;}
      @media print{.cb-ps-page{page-break-after:always;break-after:page;}
        .cb-ps-page:last-child{page-break-after:avoid;}}
    </style>
    <link rel="stylesheet" href="${location.origin}${location.pathname.replace(/\/[^/]*$/, '')}/css/main.css">
    <link rel="stylesheet" href="${location.origin}${location.pathname.replace(/\/[^/]*$/, '')}/css/closing-book.css">
  </head><body>
    ${track.innerHTML}
    <script>
      document.querySelectorAll('.cb-page').forEach(p=>{
        p.style.transform='';
        p.style.overflow='visible';
        p.style.width='100%';
        p.style.height='auto';
        p.style.flex='none';
      });
      window.addEventListener('load',()=>window.print());
    <\/script>
  </body></html>`);
  win.document.close();
}

/* ─────────────────────────────────────────────────────────────
   PDF EXPORT  (via html2canvas + jsPDF if available)
───────────────────────────────────────────────────────────── */
async function cbExportPDF() {
  const statusEl = document.getElementById('cb-export-status');
  const show = msg => { if (statusEl) { statusEl.textContent = msg; statusEl.style.display = 'block'; } };
  const hide = ()  => { if (statusEl) statusEl.style.display = 'none'; };

  if (!window.jspdf || !window.html2canvas) {
    /* Fallback to browser print */
    cbPrint();
    return;
  }

  const { fromDate, fromShift, toDate, toShift } = cbState;
  /* Spec: "FDPP BT Closing {FromShift} {FromDate} to {ToShift} {ToDate}" */
  const filename = `FDPP BT Closing ${fromShift} ${fromDate} to ${toShift} ${toDate}.pdf`;

  const pages = document.querySelectorAll('#cb-pages-track .cb-page');
  if (!pages.length) { alert('No pages to export.'); return; }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p', 'mm', 'a4');
  const savedZoom = cbState.zoom;
  cbSetZoom(1); /* reset zoom for capture */

  try {
    for (let i = 0; i < pages.length; i++) {
      show(`Rendering page ${i + 1} of ${pages.length}…`);
      /* temporarily make this page "current" so it's visible */
      const track = document.getElementById('cb-pages-track');
      if (track) {
        track.style.transition = 'none';
        track.style.transform  = `translateX(calc(-${i} * 100%))`;
      }
      await new Promise(r => requestAnimationFrame(r));

      const canvas = await html2canvas(pages[i], {
        scale      : 2,
        useCORS    : true,
        logging    : false,
        width      : pages[i].offsetWidth,
        windowWidth: pages[i].offsetWidth
      });

      if (i > 0) pdf.addPage();
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297);
    }

    pdf.save(filename);
    show('✓ PDF saved!');
    setTimeout(hide, 2500);
  } catch(err) {
    show('PDF error — try Print instead.');
    console.error('[CB] PDF export error:', err);
    setTimeout(hide, 3000);
  } finally {
    /* restore view */
    cbSetZoom(savedZoom);
    _cbGoToPage(cbState.currentPage, false);
  }
}

/* ─────────────────────────────────────────────────────────────
   TINY UTILITY
───────────────────────────────────────────────────────────── */
function id(s) { return document.getElementById(s); }

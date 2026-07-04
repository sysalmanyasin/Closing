/* ═══════════════════════════════════════════════════════════════
   FLOOR 5 — PAGES
   Reads State → Renders UI → Calls Actions.
   Navigation, Credit Ledger page, Calendar, Manifest, Summary,
   Settings UI.
═══════════════════════════════════════════════════════════════ */

function showPage(id) {
  document.querySelectorAll('.view-pane').forEach(p => p.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}
function goToDashboard() {
  stopAutoDraft();          /* stop auto-draft when leaving ledger */
  showPage('page-dashboard');
  buildCalendar();
  renderManifest();
}
function goToClosingBook() {
  showPage('page-closing-book');
  if(typeof initClosingBookDefaults === 'function') initClosingBookDefaults();
}
function goToSettings()  {
  let pin = prompt("Enter settings PIN:");
  if(pin !== PIN) { alert("Incorrect PIN."); return; }
  showPage('page-settings');
  buildSettingsUI();
}
function goToCreditLedger() {
  showPage('page-credit-ledger');
  clBackfillSnapshots();
  clSwitchMode('credit');
}

/* ═══════════════════════════════════════════
   CREDIT LEDGER — SNAPSHOT ENGINE
═══════════════════════════════════════════ */

/* Credit/Misc Ledger data engine (clEnsureArray, clBuildSnapshot,
   clSaveSnapshot, clBackfillSnapshots, clAllLabels, clGroupByDate,
   mlAllSnapshots) now lives in ledger-engine.js — Floor 3 extension.
   Everything below here is rendering only (Floor 5's job): it reads
   what the engine computed and builds DOM, it never mutates db. */

/* This page's own UI state — which mode is showing, how many
   date-groups are expanded. File-local, never read by other floors. */
const clPageState = {
  visibleCount:   3,       /* how many date-groups shown (Credit mode) */
  mlVisibleCount: 3,       /* how many date-groups shown (Misc mode) */
  activeMode:     'credit' /* 'credit' | 'misc' */
};

/* ── FORMAT HELPERS ── */
function clFmt(v) { return 'Rs. ' + Math.abs(v).toLocaleString(); }
function clFmtSigned(v) { return (v >= 0 ? '+' : '−') + ' Rs. ' + Math.abs(v).toLocaleString(); }
function clFmtDate(ds) {
  try {
    const d = new Date(ds + 'T00:00:00');
    return d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch(e) { return ds; }
}

/* Switch between Credit and Misc/Ongoing views on the same tab */
function clSwitchMode(mode) {
  clPageState.activeMode = mode;
  document.getElementById('cl-mode-tab-credit')?.classList.toggle('active', mode === 'credit');
  document.getElementById('cl-mode-tab-misc')?.classList.toggle('active', mode === 'misc');
  document.getElementById('cl-filter-row').style.display   = mode === 'credit' ? 'flex' : 'none';
  document.getElementById('cl-count-row-misc').classList.toggle('hidden', mode !== 'misc');

  const title = document.getElementById('cl-toolbar-title');
  const sub   = document.getElementById('cl-toolbar-sub');
  const expT  = document.getElementById('cl-export-title');
  if(mode === 'credit') {
    if(title) title.textContent = '📒 Credit Ledger';
    if(sub)   sub.textContent   = "Snapshot history of every shift's credit";
    if(expT)  expT.textContent  = '📤 Export Credit History as .txt';
  } else {
    if(title) title.textContent = '🧮 Misc / Ongoing Ledger';
    if(sub)   sub.textContent   = "Snapshot history of every shift's miscellaneous / ongoing charges";
    if(expT)  expT.textContent  = '📤 Export Misc History as .txt';
  }
  renderCreditLedger();
}

/* ═══════════════════════════════════════════
   CREDIT LEDGER — RENDER
═══════════════════════════════════════════ */
function renderCreditLedger() {
  if(clPageState.activeMode === 'misc') { renderMiscLedgerInternal(); return; }
  clEnsureArray();
  const filterLbl = document.getElementById('cl-filter-select')?.value || '';

  /* Rebuild filter dropdown */
  const filterSel = document.getElementById('cl-filter-select');
  if(filterSel) {
    const prev = filterSel.value;
    filterSel.innerHTML = '<option value="">All Accounts</option>';
    clAllLabels().forEach(lbl => {
      const o = document.createElement('option');
      o.value = lbl; o.textContent = lbl;
      filterSel.appendChild(o);
    });
    filterSel.value = clAllLabels().includes(prev) ? prev : '';
  }
  const activeFilter = filterSel?.value || '';

  /* Filter snapshots */
  let snapshots = db.creditLedger;
  if(activeFilter) {
    snapshots = snapshots.filter(s => s.lines.some(l => l.lbl === activeFilter));
  }

  const groups = clGroupByDate(snapshots);
  const container = document.getElementById('cl-cards-container');
  if(!container) return;

  /* Count badge */
  const countBadge = document.getElementById('cl-count-badge');
  if(countBadge) countBadge.textContent = `${snapshots.length} shift${snapshots.length !== 1 ? 's' : ''} · ${groups.length} date${groups.length !== 1 ? 's' : ''}`;

  if(groups.length === 0) {
    container.innerHTML = `<div class="cl-empty">📭 No credit records yet.<br><span style="font-size:0.75rem;">Save a shift with credit entries to see them here.</span></div>`;
    document.getElementById('cl-show-more-btn').classList.add('hidden');
    return;
  }

  container.innerHTML = '';
  const toShow = groups.slice(0, clPageState.visibleCount);
  const hidden = groups.slice(clPageState.visibleCount);

  toShow.forEach(group => container.appendChild(clBuildDateCard(group, activeFilter)));

  /* Show more button */
  const moreBtn = document.getElementById('cl-show-more-btn');
  if(hidden.length > 0) {
    moreBtn.textContent = `Show ${hidden.length} more date${hidden.length !== 1 ? 's' : ''} ▼`;
    moreBtn.classList.remove('hidden');
  } else {
    moreBtn.classList.add('hidden');
  }
}

function clBuildDateCard(group, activeFilter) {
  const card = document.createElement('div');
  card.className = 'cl-date-card';
  card.dataset.date = group.date;

  /* Date-level total: highest totalCredit among snaps in group (last shift of day) */
  const latestTotal = group.snaps[0]?.totalCredit || 0;
  const shiftLabels = group.snaps.map(s => s.shift).join(' · ');

  card.innerHTML = `
    <div class="cl-date-head" onclick="clToggleDateCard(this.parentElement)">
      <span class="cl-date-icon">📅</span>
      <div style="flex:1;">
        <div class="cl-date-label">${clFmtDate(group.date)}</div>
        <div class="cl-date-sub">${shiftLabels}</div>
      </div>
      <span class="cl-date-total">${clFmt(latestTotal)}</span>
      <span class="cl-chevron">▶</span>
    </div>
    <div class="cl-date-body">
      ${group.snaps.map(s => clBuildShiftBlock(s, activeFilter)).join('')}
    </div>`;
  return card;
}

function clBuildShiftBlock(snap, activeFilter) {
  const isFinal = snap.mode === 'final';
  const modeClass = isFinal ? 'mode-final' : '';
  const badge = isFinal
    ? `<span class="cl-badge-final">🟡 Final</span>`
    : `<span class="cl-badge-shift">🔵 Shift</span>`;

  /* Lines to display */
  let displayLines = snap.lines;
  if(activeFilter) displayLines = displayLines.filter(l => l.lbl === activeFilter);

  /* Group by category */
  const named = displayLines.filter(l => l.category === 'named');
  const tier  = displayLines.filter(l => l.category === 'tier');
  const aux   = displayLines.filter(l => l.category === 'aux');

  let linesHtml = '';

  if(!activeFilter) {
    /* Opening credit row */
    linesHtml += `<div class="cl-opening-row">
      <span>Opening Credit (carried in)</span>
      <span>${clFmt(snap.openingCredit)}</span>
    </div>`;
  }

  function renderGroup(items, label) {
    if(!items.length) return '';
    let h = `<div class="cl-cat-label">${label}</div>`;
    items.forEach(l => {
      h += `<div class="cl-line">
        <span class="cl-lbl">${l.lbl}${l.desc ? ` <span class="cl-lbl-desc">(${l.desc})</span>` : ''}</span>
        <span class="cl-val">${clFmt(l.val)}</span>
      </div>`;
    });
    return h;
  }

  linesHtml += renderGroup(named, 'Named Accounts');
  linesHtml += renderGroup(tier, 'Staff / Tier Credits');
  linesHtml += renderGroup(aux, 'Free Entries');

  /* Credit adjustment (non-zero) */
  if(!activeFilter && snap.creditAdj !== 0) {
    linesHtml += `<div class="cl-line cl-adj-row">
      <span class="cl-lbl">Credit Adjustment</span>
      <span class="cl-val">${clFmtSigned(snap.creditAdj)}</span>
    </div>`;
  }

  /* Total row */
  const totalRow = !activeFilter
    ? `<div class="cl-total-row"><span>TOTAL CREDIT</span><span>${clFmt(snap.totalCredit)}</span></div>`
    : `<div class="cl-total-row" style="color:var(--teal-dark);"><span>${activeFilter}</span><span>${clFmt(displayLines.reduce((s,l)=>s+l.val,0))}</span></div>`;

  return `
    <div class="cl-shift-block ${modeClass}">
      <div class="cl-shift-header">
        ${badge}
        <span class="cl-shift-name">${snap.shift} Closing</span>
        <span class="cl-shift-total">${clFmt(snap.totalCredit)}</span>
        <button class="cl-print-btn" onclick="printThermalSnapshot('credit','${snap.key}')">🖨 Print</button>
        <button class="cl-open-btn" onclick="clOpenShift('${snap.key}')">Open →</button>
      </div>
      <div class="cl-lines">
        ${linesHtml}
        ${totalRow}
      </div>
    </div>`;
}

/* Toggle a date card open/closed */
function clToggleDateCard(card) {
  card.classList.toggle('open');
}

/* Expand or collapse all date cards */
function clToggleAll(open) {
  document.querySelectorAll('#cl-cards-container .cl-date-card').forEach(c => {
    c.classList.toggle('open', open);
  });
}

/* Show more date groups */
function clShowMore() {
  if(clPageState.activeMode === 'misc') clPageState.mlVisibleCount += 10;
  else clPageState.visibleCount += 10;
  renderCreditLedger();
}

/* Open a shift in the ledger */
function clOpenShift(key) {
  const parts = key.split('_');
  if(parts.length < 2) return;
  stopAutoDraft();
  initLedger(parts[0], parts[1], db.sheets[key]?.profileMode || 'shift');
}

/* Toggle export panel */
function clToggleExport() {
  const panel = document.getElementById('cl-export-panel');
  if(!panel) return;
  panel.classList.toggle('open');
  if(panel.classList.contains('open')) {
    /* Set default date range: oldest to newest */
    let dates;
    if(clPageState.activeMode === 'misc') {
      dates = mlAllSnapshots().map(s => s.date).sort();
    } else {
      clEnsureArray();
      dates = db.creditLedger.map(s => s.date).sort();
    }
    const fromEl = document.getElementById('cl-exp-from-date');
    const toEl   = document.getElementById('cl-exp-to-date');
    if(fromEl && dates.length) fromEl.value = dates[0];
    if(toEl   && dates.length) toEl.value   = dates[dates.length - 1];
  }
}

/* Export .txt file for a date+shift range */
function clExportTxt() {
  if(clPageState.activeMode === 'misc') { mlExportTxt(); return; }
  clEnsureArray();
  const fromDate  = document.getElementById('cl-exp-from-date')?.value  || '';
  const fromShift = document.getElementById('cl-exp-from-shift')?.value || '';
  const toDate    = document.getElementById('cl-exp-to-date')?.value    || '';
  const toShift   = document.getElementById('cl-exp-to-shift')?.value   || '';

  const shiftOrder = { Night: 0, Morning: 1, Evening: 2 };

  function snapKey(s) {
    return s.date + '_' + String(shiftOrder[s.shift] ?? 9).padStart(1,'0');
  }
  const fromKey = fromDate + '_' + String(fromShift ? shiftOrder[fromShift] ?? 0 : 0).padStart(1,'0');
  const toKey   = toDate   + '_' + String(toShift   ? shiftOrder[toShift]   ?? 9 : 9).padStart(1,'0');

  const filtered = db.creditLedger
    .filter(s => !s.draft)
    .filter(s => {
      const k = snapKey(s);
      return k >= fromKey && k <= toKey;
    })
    .sort((a, b) => snapKey(a).localeCompare(snapKey(b)));

  if(!filtered.length) { alert('No records found in that range.'); return; }

  const SEP = '─'.repeat(46);
  let txt = 'FAZAL DIN\'S PHARMA PLUS — CREDIT LEDGER\n';
  txt += `Generated: ${new Date().toLocaleString('en-PK')}\n`;
  txt += `Range: ${fromDate || 'start'} ${fromShift||''} → ${toDate || 'end'} ${toShift||''}\n`;
  txt += '═'.repeat(46) + '\n\n';

  filtered.forEach(snap => {
    txt += `${clFmtDate(snap.date)} — ${snap.shift} Closing`;
    txt += snap.mode === 'final' ? ' [FINAL CLOSING]\n' : ' [SHIFT]\n';
    txt += SEP + '\n';
    txt += `Opening Credit (carried in): ${clFmt(snap.openingCredit)}\n`;
    txt += SEP + '\n';

    const named = snap.lines.filter(l => l.category === 'named');
    const tier  = snap.lines.filter(l => l.category === 'tier');
    const aux   = snap.lines.filter(l => l.category === 'aux');

    if(named.length) { txt += 'Named Accounts:\n'; named.forEach(l => { const lbl = l.desc ? `${l.lbl} (${l.desc})` : l.lbl; txt += `  ${lbl.padEnd(30)} ${clFmt(l.val)}\n`; }); }
    if(tier.length)  { txt += 'Staff / Tier Credits:\n'; tier.forEach(l => { txt += `  ${l.lbl.padEnd(30)} ${clFmt(l.val)}\n`; }); }
    if(aux.length)   { txt += 'Free Entries:\n'; aux.forEach(l => { txt += `  ${l.lbl.padEnd(30)} ${clFmt(l.val)}\n`; }); }
    if(snap.creditAdj !== 0) txt += `  Adjustment:${' '.repeat(19)} ${clFmtSigned(snap.creditAdj)}\n`;

    txt += SEP + '\n';
    txt += `TOTAL CREDIT:                  ${clFmt(snap.totalCredit)}\n`;
    txt += '\n';
  });

  const blob = new Blob([txt], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `credit-ledger_${fromDate||'start'}_to_${toDate||'end'}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}


/* ═══════════════════════════════════════════
   MISC / ONGOING LEDGER — computed live from
   db.sheets (no separate persisted array needed,
   since miscRows are already saved per shift).
   Reuses clGroupByDate / clFmt / clFmtDate from
   the Credit Ledger above — same date/shift shape.
   mlAllSnapshots() itself now lives in ledger-engine.js.
═══════════════════════════════════════════ */

function renderMiscLedgerInternal() {
  const snapshots = mlAllSnapshots();
  const groups    = clGroupByDate(snapshots);
  const container = document.getElementById('cl-cards-container');
  if(!container) return;

  const countBadge = document.getElementById('cl-count-badge-misc');
  if(countBadge) countBadge.textContent = `${snapshots.length} shift${snapshots.length !== 1 ? 's' : ''} · ${groups.length} date${groups.length !== 1 ? 's' : ''}`;

  if(groups.length === 0) {
    container.innerHTML = `<div class="cl-empty">📭 No misc/ongoing charge records yet.<br><span style="font-size:0.75rem;">Save a shift with misc entries to see them here.</span></div>`;
    document.getElementById('cl-show-more-btn').classList.add('hidden');
    return;
  }

  container.innerHTML = '';
  const toShow = groups.slice(0, clPageState.mlVisibleCount);
  const hidden = groups.slice(clPageState.mlVisibleCount);

  toShow.forEach(group => container.appendChild(mlBuildDateCard(group)));

  const moreBtn = document.getElementById('cl-show-more-btn');
  if(hidden.length > 0) {
    moreBtn.textContent = `Show ${hidden.length} more date${hidden.length !== 1 ? 's' : ''} ▼`;
    moreBtn.classList.remove('hidden');
  } else {
    moreBtn.classList.add('hidden');
  }
}

function mlBuildDateCard(group) {
  const card = document.createElement('div');
  card.className = 'cl-date-card';
  card.dataset.date = group.date;

  const latestTotal = group.snaps[0]?.total || 0;
  const shiftLabels = group.snaps.map(s => s.shift).join(' · ');

  card.innerHTML = `
    <div class="cl-date-head" onclick="clToggleDateCard(this.parentElement)">
      <span class="cl-date-icon">📅</span>
      <div style="flex:1;">
        <div class="cl-date-label">${clFmtDate(group.date)}</div>
        <div class="cl-date-sub">${shiftLabels}</div>
      </div>
      <span class="cl-date-total">${clFmt(latestTotal)}</span>
      <span class="cl-chevron">▶</span>
    </div>
    <div class="cl-date-body">
      ${group.snaps.map(s => mlBuildShiftBlock(s)).join('')}
    </div>`;
  return card;
}

function mlBuildShiftBlock(snap) {
  const isFinal   = snap.mode === 'final';
  const modeClass = isFinal ? 'mode-final' : '';
  const badge     = isFinal
    ? `<span class="cl-badge-final">🟡 Final</span>`
    : `<span class="cl-badge-shift">🔵 Shift</span>`;

  let linesHtml = '';
  snap.lines.forEach(l => {
    linesHtml += `<div class="cl-line">
      <span class="cl-lbl">${l.lbl}</span>
      <span class="cl-val">${clFmt(l.val)}</span>
    </div>`;
  });
  linesHtml += `<div class="cl-total-row"><span>TOTAL MISC</span><span>${clFmt(snap.total)}</span></div>`;

  return `
    <div class="cl-shift-block ${modeClass}">
      <div class="cl-shift-header">
        ${badge}
        <span class="cl-shift-name">${snap.shift} Closing</span>
        <span class="cl-shift-total">${clFmt(snap.total)}</span>
        <button class="cl-print-btn" onclick="printThermalSnapshot('misc','${snap.key}')">🖨 Print</button>
        <button class="cl-open-btn" onclick="clOpenShift('${snap.key}')">Open →</button>
      </div>
      <div class="cl-lines">
        ${linesHtml}
      </div>
    </div>`;
}

/* Export Misc history as .txt (mirrors clExportTxt but for miscRows) */
function mlExportTxt() {
  const fromDate  = document.getElementById('cl-exp-from-date')?.value  || '';
  const fromShift = document.getElementById('cl-exp-from-shift')?.value || '';
  const toDate    = document.getElementById('cl-exp-to-date')?.value    || '';
  const toShift   = document.getElementById('cl-exp-to-shift')?.value   || '';

  const shiftOrder = { Night: 0, Morning: 1, Evening: 2 };
  function snapKey(s) { return s.date + '_' + String(shiftOrder[s.shift] ?? 9).padStart(1, '0'); }
  const fromKey = fromDate + '_' + String(fromShift ? shiftOrder[fromShift] ?? 0 : 0).padStart(1, '0');
  const toKey   = toDate   + '_' + String(toShift   ? shiftOrder[toShift]   ?? 9 : 9).padStart(1, '0');

  const filtered = mlAllSnapshots()
    .filter(s => { const k = snapKey(s); return k >= fromKey && k <= toKey; })
    .sort((a, b) => snapKey(a).localeCompare(snapKey(b)));

  if(!filtered.length) { alert('No records found in that range.'); return; }

  const SEP = '─'.repeat(46);
  let txt = "FAZAL DIN'S PHARMA PLUS — MISC / ONGOING LEDGER\n";
  txt += `Generated: ${new Date().toLocaleString('en-PK')}\n`;
  txt += `Range: ${fromDate || 'start'} ${fromShift||''} → ${toDate || 'end'} ${toShift||''}\n`;
  txt += '═'.repeat(46) + '\n\n';

  filtered.forEach(snap => {
    txt += `${clFmtDate(snap.date)} — ${snap.shift} Closing`;
    txt += snap.mode === 'final' ? ' [FINAL CLOSING]\n' : ' [SHIFT]\n';
    txt += SEP + '\n';
    snap.lines.forEach(l => { txt += `  ${l.lbl.padEnd(30)} ${clFmt(l.val)}\n`; });
    txt += SEP + '\n';
    txt += `TOTAL MISC:                    ${clFmt(snap.total)}\n\n`;
  });

  const blob = new Blob([txt], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `misc-ledger_${fromDate||'start'}_to_${toDate||'end'}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}


/* ═══════════════════════════════════════════
   THERMAL RECEIPT PRINTING (3" / 80mm paper)
   Used by both Credit and Misc snapshot blocks.
   Prints via a detached iframe so it never
   collides with the app's own A4 print-sheet CSS.
═══════════════════════════════════════════ */

function printThermalSnapshot(kind, key) {
  let snap;

  if(kind === 'credit') {
    clEnsureArray();
    snap = db.creditLedger.find(s => s.key === key);
    if(!snap) { alert('Snapshot not found.'); return; }
  } else {
    const rec = db.sheets[key];
    if(!rec) { alert('Snapshot not found.'); return; }
    const parts = key.split('_');
    const rows  = (rec.miscRows || []).filter(r => (parseFloat(r.val) || 0) !== 0 || (r.label || '').trim());
    snap = {
      key, date: parts[0] || '', shift: parts[1] || '',
      mode:  rec.profileMode || 'shift',
      lines: rows.map(r => ({ lbl: (r.label || '').trim() || 'Untitled', val: parseFloat(r.val) || 0 })),
      total: rows.reduce((s, r) => s + (parseFloat(r.val) || 0), 0)
    };
  }

  const brand   = (db.settings && db.settings.bookBrandCode) || "FAZAL DIN'S PHARMA PLUS";
  const isFinal = snap.mode === 'final';
  const title   = kind === 'credit' ? 'CREDIT LEDGER' : 'MISC / ONGOING CHARGES';

  let rowsHtml = '';
  if(kind === 'credit') {
    rowsHtml += `<div class="tp-row"><span>Opening Credit</span><span>${clFmt(snap.openingCredit)}</span></div><div class="tp-rule"></div>`;
    const named = snap.lines.filter(l => l.category === 'named');
    const tier  = snap.lines.filter(l => l.category === 'tier');
    const aux   = snap.lines.filter(l => l.category === 'aux');
    function grp(items, label) {
      if(!items.length) return '';
      let h = `<div class="tp-cat">${label}</div>`;
      items.forEach(l => { h += `<div class="tp-row"><span>${l.lbl}${l.desc ? ` (${l.desc})` : ''}</span><span>${clFmt(l.val)}</span></div>`; });
      return h;
    }
    rowsHtml += grp(named, 'NAMED ACCOUNTS') + grp(tier, 'STAFF / TIER') + grp(aux, 'FREE ENTRIES');
    if(snap.creditAdj) rowsHtml += `<div class="tp-row"><span>Adjustment</span><span>${clFmtSigned(snap.creditAdj)}</span></div>`;
    rowsHtml += `<div class="tp-rule"></div><div class="tp-row tp-total"><span>TOTAL CREDIT</span><span>${clFmt(snap.totalCredit)}</span></div>`;
  } else {
    if(!snap.lines.length) rowsHtml += `<div class="tp-row"><span>— no items —</span><span></span></div>`;
    snap.lines.forEach(l => { rowsHtml += `<div class="tp-row"><span>${l.lbl}</span><span>${clFmt(l.val)}</span></div>`; });
    rowsHtml += `<div class="tp-rule"></div><div class="tp-row tp-total"><span>TOTAL MISC</span><span>${clFmt(snap.total)}</span></div>`;
  }

  const bodyHtml = `
    <div class="tp-center tp-brand">${brand}</div>
    <div class="tp-center tp-sub">${title}</div>
    <div class="tp-rule"></div>
    <div class="tp-row"><span>Date</span><span>${clFmtDate(snap.date)}</span></div>
    <div class="tp-row"><span>Shift</span><span>${snap.shift}${isFinal ? ' (FINAL)' : ''}</span></div>
    <div class="tp-rule"></div>
    ${rowsHtml}
    <div class="tp-center tp-footer">Printed ${new Date().toLocaleString('en-PK')}</div>`;

  _printThermalHtml(bodyHtml);
}

function _printThermalHtml(bodyHtml) {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.width  = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.right  = '0';
  iframe.style.bottom = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Print</title>
    <style>
      @page { size: 80mm auto; margin: 3mm; }
      * { box-sizing: border-box; }
      body { font-family: 'Courier New', Courier, monospace; width: 74mm; margin: 0; padding: 0; color: #000; font-size: 12px; line-height: 1.4; }
      .tp-center { text-align: center; }
      .tp-brand  { font-size: 14px; font-weight: 700; text-transform: uppercase; }
      .tp-sub    { font-size: 11px; font-weight: 700; letter-spacing: .5px; margin-bottom: 2px; }
      .tp-footer { font-size: 9px; color: #555; margin-top: 6px; }
      .tp-rule   { border-top: 1px dashed #000; margin: 4px 0; }
      .tp-row    { display: flex; justify-content: space-between; gap: 6px; padding: 1px 0; font-size: 11.5px; }
      .tp-row span:first-child { word-break: break-word; padding-right: 4px; }
      .tp-row span:last-child  { white-space: nowrap; font-weight: 600; }
      .tp-cat    { font-size: 10px; font-weight: 700; text-transform: uppercase; margin-top: 4px; }
      .tp-total  { font-size: 13px; font-weight: 800; }
    </style></head><body>${bodyHtml}</body></html>`);
  doc.close();

  setTimeout(() => {
    try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch(e) { /* no-op */ }
    setTimeout(() => { if(iframe.parentNode) iframe.parentNode.removeChild(iframe); }, 1500);
  }, 250);
}


/* ═══════════════════════════════════════════

   CALENDAR
═══════════════════════════════════════════ */

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const WDAYS  = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function buildCalendar() {
  const yr = calViewDate.getFullYear();
  const mo = calViewDate.getMonth();
  document.getElementById('cal-title').textContent = `${MONTHS[mo]} ${yr}`;
  const grid = document.getElementById('cal-grid');
  grid.innerHTML = "";
  WDAYS.forEach(d => {
    const lbl = document.createElement('div');
    lbl.className = "cal-day-lbl"; lbl.textContent = d;
    grid.appendChild(lbl);
  });
  const firstDay     = new Date(yr, mo, 1).getDay();
  const daysInMonth  = new Date(yr, mo+1, 0).getDate();
  const today        = new Date();
  for(let i=0;i<firstDay;i++) {
    const blank = document.createElement('div'); blank.className="cal-cell empty"; grid.appendChild(blank);
  }
  for(let d=1;d<=daysInMonth;d++) {
    const cell = document.createElement('div'); cell.className="cal-cell";
    const ds = `${yr}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    if(today.getFullYear()===yr && today.getMonth()===mo && today.getDate()===d) cell.classList.add('today');
    cell.innerHTML = `<span>${d}</span>`;
    const dots = document.createElement('div'); dots.className="cal-dots";
    SHIFTS.forEach(s => {
      if(isRealSheet(db.sheets[`${ds}_${s}`])) {
        const dot = document.createElement('span'); dot.className=`dot dot-${s.toLowerCase()}`; dots.appendChild(dot);
      }
    });
    cell.appendChild(dots);
    cell.onclick = () => openDatePicker(ds);
    grid.appendChild(cell);
  }
}

function shiftMonth(n) { calViewDate.setMonth(calViewDate.getMonth()+n); buildCalendar(); }

function openDatePicker(ds) {
  const panel = document.getElementById('shift-picker');
  panel.classList.remove('hidden');
  document.getElementById('lbl-picker-date').textContent = `Open shift for: ${ds}`;
  document.getElementById('lbl-picker-date').dataset.date = ds;

  /* ── Find the next shift to open ──────────────────────────
     Order within a day: Night → Morning → Evening
     Look for the last saved (non-draft) shift on this date,
     then the next one in sequence is the suggested shift.
     If none saved today, look at the last saved shift overall
     and suggest the one after it. ─────────────────────────── */
  const CHRONO = ['Night', 'Morning', 'Evening'];

  /* Find last saved shift on this date */
  let suggestedShift = null;
  let suggestedMode  = 'shift';

  /* Check which shifts on this date are already saved */
  const savedToday = CHRONO.filter(s => {
    const rec = db.sheets[`${ds}_${s}`];
    return rec && rec.draft !== true;
  });

  if(savedToday.length > 0) {
    /* Some shifts saved today — suggest the next one */
    const lastSavedIdx = CHRONO.indexOf(savedToday[savedToday.length - 1]);
    if(lastSavedIdx < CHRONO.length - 1) {
      suggestedShift = CHRONO[lastSavedIdx + 1];
    } else {
      /* All 3 shifts saved — nothing left for today */
      suggestedShift = null;
    }
  } else {
    /* No shifts saved today — find last saved shift across all dates */
    const allSavedKeys = Object.keys(db.sheets)
      .filter(k => db.sheets[k] && db.sheets[k].draft !== true)
      .sort((a, b) => sheetSortKey(a).localeCompare(sheetSortKey(b)));

    if(allSavedKeys.length > 0) {
      const lastKey   = allSavedKeys[allSavedKeys.length - 1];
      const lastParts = lastKey.split('_');
      const lastDate  = lastParts[0];
      const lastShift = lastParts[1];
      const lastIdx   = CHRONO.indexOf(lastShift);

      if(lastDate === ds) {
        /* Last saved was today — next shift */
        suggestedShift = lastIdx < CHRONO.length - 1 ? CHRONO[lastIdx + 1] : null;
      } else if(lastDate < ds) {
        /* Last saved was before today */
        if(lastIdx === CHRONO.length - 1) {
          /* Last was Evening — next day starts with Night */
          suggestedShift = 'Night';
        } else {
          /* Incomplete previous day — but user clicked a new date, suggest Night */
          suggestedShift = 'Night';
        }
      } else {
        /* Clicked a past date — default Night */
        suggestedShift = 'Night';
      }
    } else {
      /* No records at all — first ever closing starts with Night */
      suggestedShift = 'Night';
    }
  }

  /* Check if suggested shift already has a draft (allow reopening) */
  const body = document.getElementById('shift-picker-body');
  if(!suggestedShift) {
    body.innerHTML = `<p style="color:var(--muted);font-size:0.85rem;padding:8px 0;">All shifts for ${ds} are already saved.</p>`;
    document.getElementById('shift-picker-btns').style.display = 'none';
    panel.dataset.shift = '';
    panel.dataset.mode  = '';
    return;
  }

  /* ── Auto-suggest Final mode ───────────────────────────────
     A brand-new (never-touched) closing defaults to "Final" once
     `finalEveryN` shifts have passed since the last saved Final
     closing. If a record already exists for this slot — saved OR
     just a draft — its own stored mode always wins; we never
     silently flip a closing (or a draft-in-progress) that the
     cashier already chose a mode for. */
  const existingRec = db.sheets[`${ds}_${suggestedShift}`];
  const isDraft = existingRec && existingRec.draft === true;
  if(existingRec) {
    suggestedMode = existingRec.profileMode || 'shift';
  } else {
    suggestedMode = computeAutoClosingMode();
  }

  document.getElementById('shift-picker-btns').style.display = '';
  panel.dataset.shift = suggestedShift;
  panel.dataset.mode  = suggestedMode;

  body.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;padding:10px 0;">
      <div style="background:var(--teal-pale);border-radius:var(--radius);padding:10px 18px;text-align:center;flex:1;">
        <div style="font-size:0.72rem;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.4px;">Shift</div>
        <div style="font-size:1rem;font-weight:800;color:var(--navy);margin-top:2px;">${suggestedShift}</div>
      </div>
      <div style="flex:1;text-align:center;">
        <div style="font-size:0.72rem;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px;">Mode</div>
        <div style="display:flex;border:1.5px solid var(--border);border-radius:var(--radius-md);overflow:hidden;">
          <button id="picker-mode-shift" onclick="setPickerMode('shift')"
            style="flex:1;padding:8px 6px;border:none;font-size:0.8rem;font-weight:700;cursor:pointer;background:var(--navy);color:#fff;transition:background .15s;">
            🔵 Shift
          </button>
          <button id="picker-mode-final" onclick="setPickerMode('final')"
            style="flex:1;padding:8px 6px;border:none;font-size:0.8rem;font-weight:700;cursor:pointer;background:#f8fafc;color:var(--muted);transition:background .15s;">
            🔴 Final
          </button>
        </div>
      </div>
    </div>
    ${isDraft ? `<p style="font-size:0.78rem;color:#92400e;background:#fef9c3;border-radius:var(--radius-sm);padding:7px 12px;margin-top:4px;">⚠️ This shift has an unsaved draft.</p>` : ''}`;

  /* Reflect the auto-suggested mode in the toggle buttons' visuals
     (the innerHTML above always paints "Shift" active by default). */
  setPickerMode(suggestedMode);
}

/* Count saved (non-draft) shift-mode closings since the last saved
   Final closing, walking backwards in chronological order. */
function shiftsSinceLastFinal() {
  const allSavedKeys = Object.keys(db.sheets)
    .filter(k => db.sheets[k] && db.sheets[k].draft !== true)
    .sort((a, b) => sheetSortKey(a).localeCompare(sheetSortKey(b)));
  let count = 0;
  for(let i = allSavedKeys.length - 1; i >= 0; i--) {
    const rec = db.sheets[allSavedKeys[i]];
    if(rec.profileMode === 'final') break;
    count++;
  }
  return count;
}

/* Should the NEXT (not-yet-saved) closing default to Final mode? */
function computeAutoClosingMode() {
  const everyN = parseInt(db.settings?.finalEveryN, 10) || 3;
  if(everyN <= 0) return 'shift';
  const sinceLastFinal = shiftsSinceLastFinal();
  /* +1 because we're deciding for the closing about to be opened */
  return (sinceLastFinal + 1) >= everyN ? 'final' : 'shift';
}

function setPickerMode(mode) {
  const panel = document.getElementById('shift-picker');
  panel.dataset.mode = mode;
  const btnShift = document.getElementById('picker-mode-shift');
  const btnFinal = document.getElementById('picker-mode-final');
  if(!btnShift || !btnFinal) return;
  if(mode === 'final') {
    btnShift.style.background = '#f8fafc'; btnShift.style.color = 'var(--muted)';
    btnFinal.style.background = '#7c3aed'; btnFinal.style.color = '#fff';
  } else {
    btnShift.style.background = 'var(--navy)'; btnShift.style.color = '#fff';
    btnFinal.style.background = '#f8fafc'; btnFinal.style.color = 'var(--muted)';
  }
}

function openSheetFromPicker() {
  const ds    = document.getElementById('lbl-picker-date').dataset.date;
  const panel = document.getElementById('shift-picker');
  const shift = panel.dataset.shift;
  activeMode  = panel.dataset.mode || 'shift';
  if(!shift) return;
  const key   = `${ds}_${shift}`;

  /* ── FORWARD-OPEN GUARD ──────────────────────────────────────────
     Block opening a new (unsaved) sheet if the immediately previous
     shift is only a draft or missing (with the one before it being a draft).
     Opening an already-saved or already-drafted sheet for viewing is allowed.
  ────────────────────────────────────────────────────────────────── */
  const existingRec = db.sheets[key];
  const alreadyHasRecord = !!existingRec; /* has saved OR draft record */

  if(!alreadyHasRecord) {
    /* Scan back to find the last real saved record — block if there's a draft before it */
    const prev = timelineStep(ds, shift, -1);
    const prevSheet = db.sheets[prev.key];
    const prevIsDraft   = prevSheet && prevSheet.draft === true;
    const prevIsMissing = !prevSheet;

    const prev2 = timelineStep(prev.date, prev.shift, -1);
    const prev2Sheet = db.sheets[prev2.key];
    const prev2IsDraft = prev2Sheet && prev2Sheet.draft === true;

    if(prevIsDraft) {
      alert(`⛔ Cannot open this closing.\n\n"${prev.date} — ${srLabel(prev.shift)}" has unsaved changes (draft).\n\nPlease open it, review, and press Save & Close before opening this one.`);
      return;
    }
    if(prevIsMissing && prev2IsDraft) {
      alert(`⛔ Cannot open this closing.\n\n"${prev2.date} — ${srLabel(prev2.shift)}" has unsaved changes (draft).\n\nPlease save it first.`);
      return;
    }
  }

  activeKey   = key;
  overrides   = db.sheets[activeKey]?.overrides || {};
  initLedger(ds, shift, activeMode);
}

/* ═══════════════════════════════════════════
   MANIFEST FILTER TOGGLE
═══════════════════════════════════════════ */
function toggleManifestFilter() {
  const panel = document.getElementById('manifest-filter-panel');
  const icon  = document.getElementById('manifest-filter-icon');
  const open  = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : 'block';
  icon.style.transform = open ? 'rotate(-90deg)' : 'rotate(0deg)';
}
function clearManifestFilter() {
  const f = document.getElementById('filter-date-from');
  const t = document.getElementById('filter-date-to');
  if(f) f.value = '';
  if(t) t.value = '';
  renderManifest();
}

/* ═══════════════════════════════════════════
   SHIFT SORT KEY — chronological
   Day cycle: Night (start) → Morning → Evening
   So within a date: Night=0, Morning=1, Evening=2
═══════════════════════════════════════════ */
const SHIFT_CHRONO = {Night: 0, Morning: 1, Evening: 2};
function sheetSortKey(k) {
  const parts = k.split('_');
  return parts[0] + '_' + (SHIFT_CHRONO[parts[1]] ?? 9);
}

/* ═══════════════════════════════════════════
   MANIFEST
═══════════════════════════════════════════ */
function renderManifest() {
  const box = document.getElementById('manifest-list');

  /* date filter values */
  const fromDate = document.getElementById('filter-date-from')?.value || '';
  const toDate   = document.getElementById('filter-date-to')?.value   || '';

  const allKeys = Object.keys(db.sheets).filter(k => {
    const rec = db.sheets[k];
    if(!rec) return false;
    const dateStr = k.split('_')[0];
    if(fromDate && dateStr < fromDate) return false;
    if(toDate   && dateStr > toDate)   return false;
    return true;
  });

  /* sort: latest first */
  allKeys.sort((a, b) => sheetSortKey(b).localeCompare(sheetSortKey(a)));

  /* update filter badge */
  const badge = document.getElementById('manifest-filter-badge');
  if(badge) {
    const active = fromDate || toDate;
    badge.style.display = active ? 'inline-flex' : 'none';
    badge.textContent = active ? 'Filtered' : '';
  }

  if(!allKeys.length) {
    box.innerHTML = `<div class="empty-state"><span>📭</span>No records found.</div>`; return;
  }

  box.innerHTML = '';

  const VISIBLE = 3;
  const older   = allKeys.slice(VISIBLE);

  function makeItem(k) {
    const rec     = db.sheets[k];
    const isDraft = rec.draft === true;
    const mode    = rec.profileMode || 'shift';
    const parts   = k.split('_');
    const sr      = srLabel(parts[1]);
    const div     = document.createElement('div');
    div.className = 'manifest-item';
    if(isDraft) div.style.opacity = '0.75';

    let badgeHtml = '';
    if(isDraft) {
      badgeHtml = `<span class="badge" style="background:#fef9c3;color:#92400e;border:1px solid #fde68a;">DRAFT</span>`;
    } else if(mode === 'final') {
      badgeHtml = `<span class="badge badge-final">FINAL</span>`;
    } else {
      badgeHtml = `<span class="badge badge-shift">SHIFT</span>`;
    }

    div.innerHTML = `
      <span class="key-label" style="display:flex;align-items:center;gap:6px;">
        ${isDraft ? '✏️' : '📦'} ${parts[0]} — ${sr}
      </span>
      <div style="display:flex;gap:8px;align-items:center;">
        ${badgeHtml}
        <button class="btn btn-ghost btn-sm" onclick="loadKey('${k}')">Open</button>
        <button class="btn btn-ghost btn-sm" onclick="openPdfModal('${k}')" title="PDF / Print">🖨</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--red);" onclick="deleteSheet('${k}')">🗑</button>
      </div>`;
    return div;
  }

  /* Top 3 always visible */
  allKeys.slice(0, VISIBLE).forEach(k => box.appendChild(makeItem(k)));

  /* Older records — collapsible */
  if(older.length) {
    const collapseWrap = document.createElement('div');

    const toggleBtn = document.createElement('button');
    toggleBtn.style.cssText = 'width:100%;padding:10px;background:#f8fafc;border:none;border-top:1px solid var(--border);color:var(--muted);font-size:0.8rem;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;';
    toggleBtn.innerHTML = `<span id="manifest-older-icon">▼</span> Show ${older.length} older record${older.length>1?'s':''}`;

    const olderList = document.createElement('div');
    olderList.id    = 'manifest-older-list';
    olderList.style.display = 'none';
    older.forEach(k => olderList.appendChild(makeItem(k)));

    toggleBtn.onclick = () => {
      const open = olderList.style.display !== 'none';
      olderList.style.display = open ? 'none' : 'block';
      const icon = document.getElementById('manifest-older-icon');
      if(icon) icon.textContent = open ? '▼' : '▲';
      toggleBtn.innerHTML = `<span id="manifest-older-icon">${open?'▼':'▲'}</span> ${open ? 'Show' : 'Hide'} ${older.length} older record${older.length>1?'s':''}`;
    };

    collapseWrap.appendChild(olderList);
    collapseWrap.appendChild(toggleBtn);
    box.appendChild(collapseWrap);
  }
}

/* ═══════════════════════════════════════════
   DAILY SUMMARY
═══════════════════════════════════════════ */

/* ═══════════════════════════════════════════
   SETTINGS UI
═══════════════════════════════════════════ */

/* Brand-code input handler (index.html onchange) — Actions does the
   mutation+persist, Pages updates its own example-text preview. */
function updateBookBrandCode(value) {
  settingsSetBookBrandCode(value);
  const exampleEl = document.getElementById('cfg-book-brand-example');
  if(exampleEl) exampleEl.textContent = db.settings.bookBrandCode + ' Closing Night 1 July 2026 to Evening 3 July 2026.pdf';
}

function buildSettingsUI() {
  document.getElementById('set-final-every-n').value = db.settings.finalEveryN || 3;
  const brandCodeEl = document.getElementById('cfg-book-brand-code');
  if(brandCodeEl) {
    brandCodeEl.value = db.settings.bookBrandCode || 'FDPP BT';
    document.getElementById('cfg-book-brand-example').textContent = (db.settings.bookBrandCode || 'FDPP BT') + ' Closing Night 1 July 2026 to Evening 3 July 2026.pdf';
  }
  renderSettingsNamedCredits();
  const sf = document.getElementById('subtier-fields');
  sf.innerHTML = "";
  for(let i=0;i<3;i++) {
    const t = db.settings.subTiers[i];
    const div = document.createElement('div');
    if(i>0) { div.style.borderTop="1px solid var(--border)"; div.style.paddingTop="14px"; }
    div.style.marginBottom = "14px";
    div.innerHTML = `
      <div class="form-field"><label>Group ${i+1} Name</label><input type="text" id="cfg-tier-type-${i+1}" value="${t?.type||''}"></div>
      <div class="form-field"><label>Members (comma separated)</label><input type="text" id="cfg-tier-names-${i+1}" value="${t?.names?.join(', ')||''}"></div>`;
    sf.appendChild(div);
  }
  renderSettingsStripGroups();
  renderSettingsStrips();
}

function renderSettingsNamedCredits() {
  const box = document.getElementById('settings-named-credits');
  box.innerHTML = "";
  db.settings.namedCredits.forEach((nc, idx) => {
    const div = document.createElement('div');
    div.className = "settings-item";
    div.innerHTML = `
      <input type="text" value="${nc.label}" placeholder="Account name" onchange="settingsSetNamedCreditLabel(${idx}, this.value)">
      <button class="btn btn-red btn-sm" onclick="removeNamedCredit(${idx})">✕</button>`;
    box.appendChild(div);
  });
}

function addNamedCreditSetting() {
  settingsAddNamedCredit();
  renderSettingsNamedCredits();
}

function removeNamedCredit(i) {
  settingsRemoveNamedCredit(i);
  renderSettingsNamedCredits();
}

function renderSettingsStrips() {
  const box = document.getElementById('settings-strips');
  box.innerHTML = "";
  const groupOptions = (selected) => `<option value="">— Ungrouped —</option>` +
    db.settings.stripGroups.map(g => `<option value="${g}" ${g===selected?'selected':''}>${g}</option>`).join('');
  db.settings.strips.forEach((item, idx) => {
    const div = document.createElement('div');
    div.className = "settings-item";
    div.innerHTML = `
      <input type="text" value="${item.name}" onchange="settingsSetStripField(${idx},'name',this.value)">
      <select onchange="settingsSetStripField(${idx},'group',this.value)">${groupOptions(item.group||'')}</select>
      <input type="number" value="${item.price}" onchange="settingsSetStripField(${idx},'price',parseFloat(this.value)||0)">
      <button class="btn btn-red btn-sm" onclick="removeStrip(${idx})">✕</button>`;
    box.appendChild(div);
  });
}

function addStripRow()  { settingsAddStrip(); renderSettingsStrips(); }
function removeStrip(i) { settingsRemoveStrip(i); renderSettingsStrips(); }

/* ── Item Groups (Settings) ─────────────────────────────────
   Every add/rename/remove persists (and therefore syncs to
   Dropbox, same as everything else) immediately — it doesn't
   wait for the page-wide "Save Settings" click, so a group
   isn't silently lost if someone navigates away first. ───── */
function renderSettingsStripGroups() {
  const box = document.getElementById('settings-strip-groups');
  if (!box) return;
  box.innerHTML = "";
  db.settings.stripGroups.forEach((name, idx) => {
    const div = document.createElement('div');
    div.className = "settings-item";
    div.innerHTML = `
      <input type="text" value="${name}" onchange="renameStripGroup(${idx}, this.value)">
      <button class="btn btn-red btn-sm" onclick="removeStripGroup(${idx})">✕</button>`;
    box.appendChild(div);
  });
}
function addStripGroup() {
  settingsAddStripGroup();
  renderSettingsStripGroups();
  renderSettingsStrips();
}
function renameStripGroup(idx, newName) {
  settingsRenameStripGroup(idx, newName);
  renderSettingsStrips();
}
function removeStripGroup(idx) {
  settingsRemoveStripGroup(idx);
  renderSettingsStripGroups();
  renderSettingsStrips();
}

/* "Save Settings" reads the staged DOM fields (final-every-N,
   named-credit labels, sub-tiers) and commits them all in one
   Actions call — see settingsCommitAll() in actions.js. */
function saveSettings() {
  const finalEveryN = parseInt(document.getElementById('set-final-every-n').value) || 3;

  const namedCreditLabels = db.settings.namedCredits.map((nc, i) => {
    const el = document.querySelector(`#settings-named-credits .settings-item:nth-child(${i+1}) input`);
    return el ? el.value : nc.label;
  });

  const subTiersData = [];
  for(let i=1;i<=3;i++) {
    const ttype  = document.getElementById(`cfg-tier-type-${i}`)?.value || '';
    const tnames = document.getElementById(`cfg-tier-names-${i}`)?.value || '';
    subTiersData.push({
      type: ttype,
      names: tnames.split(',').map(n=>n.trim()).filter(Boolean)
    });
  }

  settingsCommitAll(finalEveryN, namedCreditLabels, subTiersData);
  alert("Settings saved.");
  goToDashboard();

}

/* ═══════════════════════════════════════════
   DENOMINATION ROW BUILDER
═══════════════════════════════════════════ */

function loadKey(key) {
  activeKey  = key;
  const p    = key.split('_');
  activeMode = db.sheets[key]?.profileMode || 'shift';
  overrides  = db.sheets[key]?.overrides || {};
  initLedger(p[0], p[1], activeMode);
}

/* ═══════════════════════════════════════════
   MORE MENU (ledger toolbar)
═══════════════════════════════════════════ */


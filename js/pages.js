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
  _draftReady = false;          /* stop auto-draft when leaving ledger */
  clearTimeout(_draftTimer);
  showPage('page-dashboard');
  buildCalendar();
  renderManifest();
}
function goToSettings()  {
  let pin = prompt("Enter settings PIN:");
  if(pin !== PIN) { alert("Incorrect PIN."); return; }
  showPage('page-settings');
  buildSettingsUI();
}
function goToSummary(dateStr) {
  summaryDateStr = dateStr;
  showPage('page-summary');
  renderSummaryPage();
}
function goToCreditLedger() {
  showPage('page-credit-ledger');
  clBackfillSnapshots();
  renderCreditLedger();
}

/* ═══════════════════════════════════════════
   CREDIT LEDGER — SNAPSHOT ENGINE
═══════════════════════════════════════════ */

/* Ensure db.creditLedger exists */

function clEnsureArray() {
  if(!Array.isArray(db.creditLedger)) db.creditLedger = [];
}

/* Build a credit snapshot from a saved sheet record + its key */
function clBuildSnapshot(key, rec) {
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

/* Write a snapshot when a shift is explicitly saved */
function clSaveSnapshot(key, rec) {
  clEnsureArray();
  /* Remove any existing snapshot for this key first */
  db.creditLedger = db.creditLedger.filter(s => s.key !== key);
  const snap = clBuildSnapshot(key, rec);
  db.creditLedger.push(snap);
}

/* Backfill: scan all saved (non-draft) sheets not yet in creditLedger */
function clBackfillSnapshots() {
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
function clAllLabels() {
  clEnsureArray();
  const seen = new Set();
  db.creditLedger.forEach(s => s.lines.forEach(l => seen.add(l.lbl)));
  return Array.from(seen).sort();
}

/* Sort snapshots newest-first, group by date */
function clGroupByDate(snapshots) {
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

/* ── FORMAT HELPERS ── */
function clFmt(v) { return 'Rs. ' + Math.abs(v).toLocaleString(); }
function clFmtSigned(v) { return (v >= 0 ? '+' : '−') + ' Rs. ' + Math.abs(v).toLocaleString(); }
function clFmtDate(ds) {
  try {
    const d = new Date(ds + 'T00:00:00');
    return d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch(e) { return ds; }
}

/* ── STATE ── */
let clVisibleCount = 3; /* how many date-groups currently shown */

/* ═══════════════════════════════════════════
   CREDIT LEDGER — RENDER
═══════════════════════════════════════════ */
function renderCreditLedger() {
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
  const toShow = groups.slice(0, clVisibleCount);
  const hidden = groups.slice(clVisibleCount);

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
  clVisibleCount += 10;
  renderCreditLedger();
}

/* Open a shift in the ledger */
function clOpenShift(key) {
  const parts = key.split('_');
  if(parts.length < 2) return;
  _draftReady = false;
  clearTimeout(_draftTimer);
  initLedger(parts[0], parts[1], db.sheets[key]?.profileMode || 'shift');
}

/* Toggle export panel */
function clToggleExport() {
  const panel = document.getElementById('cl-export-panel');
  if(!panel) return;
  panel.classList.toggle('open');
  if(panel.classList.contains('open')) {
    /* Set default date range: oldest to newest */
    clEnsureArray();
    const dates = db.creditLedger.map(s => s.date).sort();
    const fromEl = document.getElementById('cl-exp-from-date');
    const toEl   = document.getElementById('cl-exp-to-date');
    if(fromEl && dates.length) fromEl.value = dates[0];
    if(toEl   && dates.length) toEl.value   = dates[dates.length - 1];
  }
}

/* Export .txt file for a date+shift range */
function clExportTxt() {
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

  document.getElementById('shift-picker-btns').style.display = '';
  panel.dataset.shift = suggestedShift;
  panel.dataset.mode  = suggestedMode;

  const existingRec = db.sheets[`${ds}_${suggestedShift}`];
  const isDraft = existingRec && existingRec.draft === true;

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

function moveSummaryDay(n) {
  const d = new Date(summaryDateStr); d.setDate(d.getDate()+n);
  summaryDateStr = d.toISOString().split('T')[0]; renderSummaryPage();
}

function renderSummaryPage() {
  document.getElementById('lbl-summary-date').textContent = summaryDateStr;
  const zone = document.getElementById('summary-shifts');
  zone.innerHTML = "";
  let totalSale=0, totalCash=0;
  SHIFTS.forEach(shift => {
    const key = `${summaryDateStr}_${shift}`;
    const rec = getRealSheet(key);
    const card = document.createElement('div');
    card.className = "card"; card.style.marginBottom = "12px";
    if(rec) {
      const nSale = parseFloat(rec.outNetSale)||0;
      const nCash = parseFloat(rec.outTotalCash)||0;
      const varAmt = nSale - nCash;
      totalSale += nSale; totalCash += nCash;
      const varColor = varAmt===0?'var(--green)':varAmt>0?'var(--red)':'var(--blue)';
      card.innerHTML = `
        <div class="shift-summary-card">
          <div class="card-title">
            <h4>🔵 ${srLabel(shift)} Shift</h4>
            <button class="btn btn-ghost btn-sm" onclick="openEditModal('${key}')">Edit</button>
          </div>
          <div class="mini-stats">
            <div class="mini-stat"><h5>Target Sales</h5><p>Rs.${nSale.toLocaleString()}</p></div>
            <div class="mini-stat"><h5>Cash Verified</h5><p>Rs.${nCash.toLocaleString()}</p></div>
            <div class="mini-stat"><h5>Variance</h5><p style="color:${varColor}">Rs.${varAmt.toLocaleString()}</p></div>
          </div>
        </div>`;
    } else {
      card.innerHTML = `
        <div class="shift-summary-card">
          <div class="flex-between">
            <span class="text-muted">○ ${srLabel(shift)} shift — no entry yet</span>
            <button class="btn btn-teal btn-sm" onclick="quickInitShift('${shift}')">+ Open</button>
          </div>
        </div>`;
    }
    zone.appendChild(card);
  });
  document.getElementById('sum-total-target').value = "Rs. " + totalSale.toLocaleString();
  document.getElementById('sum-total-cash').value   = "Rs. " + totalCash.toLocaleString();
  const totalVar = totalSale - totalCash;
  document.getElementById('sum-total-var').value = "Rs. " + totalVar.toLocaleString();
}

function quickInitShift(shift) {
  activeKey = `${summaryDateStr}_${shift}`; activeMode = "shift"; overrides = {};
  initLedger(summaryDateStr, shift, "shift");
}

/* ═══════════════════════════════════════════
   SETTINGS UI
═══════════════════════════════════════════ */

function buildSettingsUI() {
  document.getElementById('set-final-every-n').value = db.settings.finalEveryN || 3;
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
  renderSettingsStrips();
}

function renderSettingsNamedCredits() {
  const box = document.getElementById('settings-named-credits');
  box.innerHTML = "";
  db.settings.namedCredits.forEach((nc, idx) => {
    const div = document.createElement('div');
    div.className = "settings-item";
    div.innerHTML = `
      <input type="text" value="${nc.label}" placeholder="Account name" onchange="db.settings.namedCredits[${idx}].label=this.value">
      <button class="btn btn-red btn-sm" onclick="removeNamedCredit(${idx})">✕</button>`;
    box.appendChild(div);
  });
}

function addNamedCreditSetting() {
  db.settings.namedCredits.push({label:"New Account"});
  renderSettingsNamedCredits();
}

function removeNamedCredit(i) {
  db.settings.namedCredits.splice(i,1);
  renderSettingsNamedCredits();
}

function renderSettingsStrips() {
  const box = document.getElementById('settings-strips');
  box.innerHTML = "";
  db.settings.strips.forEach((item, idx) => {
    const div = document.createElement('div');
    div.className = "settings-item";
    div.innerHTML = `
      <input type="text" value="${item.name}" onchange="db.settings.strips[${idx}].name=this.value">
      <input type="number" value="${item.price}" onchange="db.settings.strips[${idx}].price=parseFloat(this.value)||0">
      <button class="btn btn-red btn-sm" onclick="removeStrip(${idx})">✕</button>`;
    box.appendChild(div);
  });
}

function addStripRow()  { db.settings.strips.push({name:"New Item",price:0}); renderSettingsStrips(); }
function removeStrip(i) { db.settings.strips.splice(i,1); renderSettingsStrips(); }

function saveSettings() {
  db.settings.finalEveryN = parseInt(document.getElementById('set-final-every-n').value)||3;
  db.settings.namedCredits.forEach((nc, i) => {
    const el = document.querySelector(`#settings-named-credits .settings-item:nth-child(${i+1}) input`);
    if(el) nc.label = el.value;
  });
  for(let i=1;i<=3;i++) {
    const ttype  = document.getElementById(`cfg-tier-type-${i}`)?.value || '';
    const tnames = document.getElementById(`cfg-tier-names-${i}`)?.value || '';
    db.settings.subTiers[i-1] = {
      type: ttype,
      names: tnames.split(',').map(n=>n.trim()).filter(Boolean)
    };
  }
  persist();
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


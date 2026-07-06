/* ═══════════════════════════════════════════════════════════════
   FLOOR 3 — ACTIONS
   The only door to change data: calc engine, ledger lifecycle,
   save/delete sheets, auto-save scheduling.
═══════════════════════════════════════════════════════════════ */

import { alBeginSession, alCommit, alLog } from './activity-log.js';
import { checkPin, db, genRowId, getSeq, isPinTaken, srLabel, session } from './state.js';
import { repoPersist } from './repository.js';
import { clEnsureArray, clSaveSnapshot, staleRecordKeys } from './ledger-engine.js';
import {
  addAuxCreditRow, addAuxStripRow, addDepositRow, addHsRow, addMiscRow,
  addNamedAccountBlock, addNamedCreditEntryRow, addTierCreditRow,
  attachNumpad, g, getRealSheet, set, showSaveAction, timelineStep, val
} from './components.js';
import { buildCalendar, goToDashboard, refreshRetentionStatus, renderManifest, showPage } from './pages.js';
import { initLedgerNav, updateFocusButtons, updateSectionStatus } from './ledger-nav.js';
import { cbIsAssembling } from './closing-book.js';
import { syncIsReady, syncPushToCloud } from './sync.js';

export function initLedger(ds, shift, mode, opts = {}) {
  if(!opts.silent) showPage('page-ledger');

  document.getElementById('lbl-ledger-pager').textContent = `${ds} — ${srLabel(shift)}`;
  document.getElementById('lbl-ledger-title').textContent = `${srLabel(shift)} Register`;
  document.getElementById('lbl-ledger-meta').textContent  = `${ds} · BT-PHARMA`;
  document.getElementById('ledger-badge').innerHTML = `<span class="badge ${mode==='shift'?'badge-shift':'badge-final'}">${mode}</span>`;
  /* close more menu if open */
  const mm = document.getElementById('ltb-more-menu');
  if(mm) mm.classList.add('hidden');

  /* update Final Closing section labels to reflect current mode */
  const isFinalMode = (mode === 'final');
  const lblSameSys   = document.getElementById('lbl-final-same-sys');
  const lblBooks     = document.getElementById('lbl-final-books');
  const lblSameCust  = document.getElementById('lbl-final-same-cust');
  const lblManRet    = document.getElementById('lbl-final-man-ret');
  const lblSameSysRet= document.getElementById('lbl-final-same-sysret');
  const lblPreSys    = document.getElementById('lbl-final-pre-sys');
  const lblPreCust   = document.getElementById('lbl-final-pre-cust');
  const lblPreSysRet = document.getElementById('lbl-final-pre-sysret');
  const lblExtraCash = document.getElementById('lbl-final-extra-cash');
  if(isFinalMode) {
    if(lblSameSys)    lblSameSys.textContent    = '＋ POS Sale — this Final Shift only:';
    if(lblBooks)      lblBooks.textContent      = '＋ Book Bills — this Final Shift only:';
    if(lblSameCust)   lblSameCust.textContent   = '＋ Customers — this Final Shift only:';
    if(lblManRet)     lblManRet.textContent     = '－ Manual Returns — this Final Shift only:';
    if(lblSameSysRet) lblSameSysRet.textContent = '－ System Returns — this Final Shift only:';
    if(lblPreSys)     lblPreSys.textContent     = '－ Pre-date POS Sales (shifts before today ＋ last final):';
    if(lblPreCust)    lblPreCust.textContent    = '－ Pre-date Customers (shifts before today ＋ last final):';
    if(lblPreSysRet)  lblPreSysRet.textContent  = '－ Less Pre-date System Return (shifts before today ＋ last final):';
    if(lblExtraCash)  lblExtraCash.textContent  = '－ Extra Cash Added to Pharmacy (this closing only):';
  } else {
    if(lblSameSys)    lblSameSys.textContent    = '＋ POS Sale — same-date shifts \u0026 this closing:';
    if(lblBooks)      lblBooks.textContent      = '＋ Book Bills — all periods ＋ prev. final:';
    if(lblSameCust)   lblSameCust.textContent   = '＋ Customers — same-date:';
    if(lblManRet)     lblManRet.textContent     = '－ Manual Returns — all periods ＋ prev. final:';
    if(lblSameSysRet) lblSameSysRet.textContent = '－ System Returns — same-date:';
    if(lblPreSys)     lblPreSys.textContent     = '－ Pre-date POS Sales (shifts before today ＋ last final):';
    if(lblPreCust)    lblPreCust.textContent    = '－ Pre-date Customers (shifts before today ＋ last final):';
    if(lblPreSysRet)  lblPreSysRet.textContent  = '－ Less Pre-date System Return (shifts before today ＋ last final):';
    if(lblExtraCash)  lblExtraCash.textContent  = '－ Extra Cash Added to Pharmacy (period since last final included ＋ this closing):';
  }

  /* final mode notice bar */
  const bar = document.getElementById('final-mode-bar');
  bar.classList.toggle('hidden', mode !== 'final');
  /* card-final-agg always visible now — shows period aggregation in all modes */

  /* reset dynamic counters */
  session.auxCreditCount = 0; session.depositCount = 0; session.miscCount = 0; session.hsRowCount = 0; session.auxStripCount = 0;

  /* clear dynamic containers */
  ['hs-rows','ledger-strips','ledger-named-credits','ledger-tier-credits',
   'ledger-aux-credits','ledger-deposits','ledger-misc'].forEach(id => {
    const el = document.getElementById(id); if(el) el.innerHTML = "";
  });

  /* build named credit rows from settings — start empty; a row only
     appears once the user taps "+ Add entry" (or one is restored below) */
  db.settings.namedCredits.forEach((nc, i) => {
    addNamedAccountBlock(i, nc.label);
  });

  /* build 3 tier credit rows */
  for(let i=1;i<=3;i++) addTierCreditRow(i);

  /* build strips from settings, grouped by db.settings.strips[i].group.
     Row order stays exactly the array order (positional index integrity
     matters — calc()/buildSheetRecord()/hydrate() all read strip inputs
     by DOM position), a group header is just inserted wherever the group
     changes. In portrait, CSS hides the per-row item name in favour of
     the group header, so only Price / Qty / Total need to fit. */
  const sc = document.getElementById('ledger-strips');
  let lastGroup = null;
  db.settings.strips.forEach((st, idx) => {
    const grp = st.group || '';
    if (grp !== lastGroup) {
      const header = document.createElement('div');
      header.className = "strip-group-header";
      header.textContent = grp || 'Other Items';
      sc.appendChild(header);
      lastGroup = grp;
    }
    const row = document.createElement('div');
    row.className = "row strip-row" + (grp ? " grouped" : "");
    row.innerHTML = `
      <span class="strip-name">${st.name}</span>
      <input type="number" class="strip-price" data-idx="${idx}" value="${st.price}" readonly style="width:80px;background:#f1f5f9;color:var(--muted);">
      <input type="number" class="strip-qty"   data-idx="${idx}" value="0"           oninput="calc()" style="width:80px;">
      <input type="number" class="strip-line"  id="strip-line-${idx}" readonly       style="width:80px;">`;
    sc.appendChild(row);
    attachNumpad(row.querySelector('.strip-qty'),   'Qty – '+st.name);
  });

  /* attach numpad to static number fields */
  ['in-sys-cash','in-last-bill-amt','in-last-bill-num','in-comp-sale','in-alfalah','in-keenu',
   'pos-ret-1','pos-ret-2','pos-ret-3','pos-ret-sys',
   'in-book-1','in-book-2',
   'out-prev-cc','out-curr-cc','out-prev-credit','in-credit-adj','out-prev-dep','out-prev-cash','in-extra-cash'].forEach(id => {
    const el = document.getElementById(id);
    if(el && !el.readOnly) attachNumpad(el);
  });

  /* style carried-value rows for final mode */
  ['box-out-prev-cc','box-out-curr-cc','box-out-prev-credit','box-out-prev-dep','box-out-prev-cash',
   'box-out-shift-sale','box-out-cust'].forEach(boxId => {
    const el = document.getElementById(boxId);
    if(!el) return;
    if(mode === 'final') { el.classList.add('final-editable'); }
    else { el.classList.remove('final-editable'); }
  });

  if(db.sheets[session.activeKey]) {
    /* Only a fully-closed sheet (draft === false) should freeze the
       computed carry-over fields. An auto-draft or manually-saved draft
       (draft === true) is still being worked on, so its computed fields
       must keep recalculating live — matching the intent already
       documented in saveDraft(). */
    session.isSavedSheet = (db.sheets[session.activeKey].draft !== true);
    hydrate(db.sheets[session.activeKey]);
    /* Snapshot for the Activity Log's diffing — only for genuine
       opens, not the silent background loads pdfModalAction/
       renderClosingImage/Closing Book use (those pass silent:true)
       to temporarily borrow this same hidden ledger DOM. */
    if(!opts.silent) alBeginSession(session.activeKey, db.sheets[session.activeKey]);
    /* Re-sync the "carried forward" fields (CC, Credit, Deposits, Cash
       Position) from whatever the previous shift's record looks like
       RIGHT NOW — not the snapshot frozen into this sheet the last time
       it was saved. This way, editing shift A and re-saving it correctly
       flows forward into shift B the next time B is opened for editing,
       without clobbering any of those 4 fields the user has manually
       corrected in B itself (tracked via `session.overrides`).
       Only runs when B is actually editable right now — a draft, or
       explicitly reopened via Edit (PIN) — never for a locked sheet
       being opened in plain View-Only, which should keep showing
       exactly what was recorded at the time it was saved. */
    if(!session.isSavedSheet || opts.forEdit) {
      refreshCarryForwardFromPrevious(ds, shift, mode);
    }
  } else {
    session.isSavedSheet = false;
    flushInputs();
    pullPreviousShift(ds, shift, mode);
    if(mode === 'shift' || mode === 'final') zeroCreditEntries();
  }
  calc();
  /* enable real-time auto-draft after ledger has fully settled */
  _draftReady = false;
  setTimeout(() => { _draftReady = true; }, 600);

  /* apply view-only / editable state based on the saved record */
  setLockedState(!!db.sheets[session.activeKey]?.locked);

  /* sticky jump-nav + progress bar + focus mode reset for this sheet */
  if (typeof initLedgerNav === 'function') initLedgerNav();
}

/* ═══════════════════════════════════════════
   ZERO CREDIT ENTRIES (Shift & Final open)
═══════════════════════════════════════════ */
export function zeroCreditEntries() {
  /* named credits — clear each account back to no entries (empty state) */
  document.querySelectorAll('.named-account-block').forEach(block => {
    block.querySelectorAll('.named-entry-row').forEach(r => r.remove());
  });
  /* tier amounts */
  for(let i=1;i<=3;i++) { const el = g(`in-nested-${i}`); if(el) el.value = 0; }
  /* aux credits */
  document.querySelectorAll('.aux-cred-val').forEach(el => el.value = 0);
}

/* ═══════════════════════════════════════════
   VIEW-ONLY (LOCK) STATE
   A saved closing ("Save & Close This Shift") becomes a
   read-only snapshot. It can only be edited again after
   entering the PIN via "Edit (PIN)".
═══════════════════════════════════════════ */
export function setLockedState(locked) {
  session.isSheetLocked = locked;
  const scope = document.querySelector('#page-ledger .page-body');
  if(!scope) return;

  /* number / text inputs and label inputs that are normally editable
     (i.e. not already readonly by design — computed/output fields) */
  scope.querySelectorAll('input[type="number"], input[type="text"]').forEach(el => {
    if(locked) {
      if(!el.readOnly) {
        el.readOnly = true;
        el.classList.add('locked-editable');
      }
    } else {
      if(el.classList.contains('locked-editable')) {
        el.readOnly = false;
        el.classList.remove('locked-editable');
      }
    }
  });

  /* selects (tier/name pickers) — these are driven by
     mousedown→modal-picker handlers, so pointer-events:none blocks them too */
  scope.querySelectorAll('select').forEach(el => {
    el.disabled = locked;
    el.style.pointerEvents = locked ? 'none' : '';
  });

  /* hide add-row / delete-row / sign-toggle controls while locked */
  scope.querySelectorAll('.add-row-btn-wrap, .del-row-btn').forEach(el => {
    el.classList.toggle('hidden', locked);
  });
  scope.querySelectorAll('.row button.btn-ghost.btn-sm').forEach(el => {
    /* the ± sign-toggle button on Credit Adjustment */
    if(el.textContent.trim() === '±') el.classList.toggle('hidden', locked);
  });

  /* toolbar / action buttons */
  const btnDraft  = document.getElementById('btn-save-draft');
  const menuEdit  = document.getElementById('menu-edit-pin');
  const menuClear = document.getElementById('menu-clear-fields');
  const menuDel   = document.getElementById('menu-delete-sheet');
  const lockedBar = document.getElementById('locked-mode-bar');

  if(btnDraft)  btnDraft.classList.toggle('hidden', locked);
  if(menuEdit)  menuEdit.classList.toggle('hidden', !locked);
  if(menuClear) menuClear.classList.toggle('hidden', locked);
  if(menuDel)   menuDel.classList.toggle('hidden', locked);
  if(lockedBar) lockedBar.classList.toggle('hidden', !locked);

  /* keep the focus-mode Back/Next buttons AND the "Save & Close" button
     in sync with lock state — updateFocusButtons() is the single source
     of truth for btn-save-close's visibility (only shown on the last
     section, and never while locked), so it isn't toggled here directly. */
  if(typeof updateFocusButtons === 'function') updateFocusButtons();
}

/* ═══════════════════════════════════════════
   CARRY-OVER PULL
═══════════════════════════════════════════ */
export function pullPreviousShift(ds, shift, mode) {
  const prev      = timelineStep(ds, shift, -1);
  const hs        = getRealSheet(prev.key);
  const dayChanged = (ds !== prev.date);

  if(!hs) {
    ['out-prev-cc','out-prev-credit','out-prev-dep','out-prev-cash'].forEach(id => set(id,0));
    return;
  }

  /* ── CC CARRY-FORWARD LOGIC ────────────────────────────────────────
     Day cycle: Night → Morning → Evening  (Night = START of new day)

     Rule:
       • Night shift (new day start):
           Carried CC = prevDayEvening.outPrevCC + prevDayEvening.outCurrCC
           (full running total from end of previous day's Evening)
       • Morning shift (same day as Night):
           Carried CC = SAME value Night carried (prevDayEvening total).
           Night's own currCC is NOT added.
       • Evening shift (same day):
           Carried CC = SAME value — neither Night's nor Morning's currCC added.

     Implementation:
       Night: prev is previous day's Evening → carry prev.outPrevCC + prev.outCurrCC.
       Morning / Evening: look up this day's Night sheet and use Night.outPrevCC
       (which equals the prevDayEvening total — the shared base for the whole day).
  ────────────────────────────────────────────────────────────────── */
  let carriedCC = 0;

  if(shift === 'Night') {
    /* Night = new day start. prev is previous day's Evening. */
    carriedCC = (parseFloat(hs.outPrevCC) || 0) + (parseFloat(hs.outCurrCC) || 0);

  } else {
    /* Morning or Evening: all same-day shifts share the CC base that Night carried.
       Night.outPrevCC = prevDayEvening total = the shared base for the whole day. */
    const nightSheet = getRealSheet(ds + '_Night');
    if(nightSheet) {
      carriedCC = parseFloat(nightSheet.outPrevCC) || 0;
    } else {
      /* Night not saved yet — use immediate previous shift's prevCC as fallback */
      carriedCC = parseFloat(hs.outPrevCC) || 0;
    }
  }

  set('out-prev-cc', carriedCC);

  /* credit — always pulled in both shift and final */
  set('out-prev-credit', parseFloat(hs.outTotalE) || 0);

  /* deposits & previous cash position — NOT carried in final mode (reset to 0) */
  if(mode === 'final') {
    set('out-prev-dep',  0);
    set('out-prev-cash', 0);
  } else {
    set('out-prev-dep',  parseFloat(hs.outTotalF) || 0);
    set('out-prev-cash', parseFloat(hs.outTotalCash) || 0);
  }

  /* misc carry-over — carried in BOTH shift and final modes.
     Always carries ALL rows from the previous sheet, as-is. */
  if(hs.miscRows && hs.miscRows.length) {
    /* clear any default blank rows that flushInputs() added */
    document.getElementById('ledger-misc').innerHTML = "";
    session.miscCount = 0;
    hs.miscRows.forEach(m => addMiscRow(m.label || "", m.val || 0));
  }
}

/* Pure — no DOM, no db writes. Figures out what the next Handover
   slot for a date WOULD be: its key, shift name, and seq — or a
   {error} reason if one can't be created right now. Split out from
   insertHandoverClosing() below specifically so this math (the part
   that's actually easy to get subtly wrong — off-by-one seq gaps,
   colliding Handover numbers) can be unit-tested directly, the same
   way timelineStep/daySlots were, without needing a real DOM. */
export function computeNextHandoverSlot(ds) {
  const prefix = `${ds}_`;
  if(!db.sheets[`${prefix}Night`]) {
    return { error: `Save at least the Night closing for ${ds} before inserting a Handover.` };
  }

  /* Evening is always last (seq 9999, state.js's getSeq) — a Handover
     always inserts immediately before it, never after, even if
     Evening already happens to be saved. Evening is deliberately
     excluded from this max: otherwise a Handover created after
     Evening was already saved would compute a seq bigger than 9999
     and incorrectly sort AFTER it, breaking "Evening is always last". */
  const existingForDate = Object.keys(db.sheets).filter(k => k.startsWith(prefix) && db.sheets[k]);
  const nonEvening = existingForDate.filter(k => k.slice(prefix.length) !== 'Evening');
  const maxSeq  = Math.max(...nonEvening.map(k => getSeq(ds, k.slice(prefix.length))));
  const nextSeq = maxSeq + 10;
  if(nextSeq >= 9999) {
    return { error: 'This date already has as many closings as it can hold.' };
  }

  let n = 1;
  while(db.sheets[`${prefix}Handover${n}`]) n++;
  const shift = `Handover${n}`;
  return { key: `${prefix}${shift}`, shift, seq: nextSeq };
}

/* ── Insert a Handover closing ─────────────────────────────────────
   Creates a new mid-day closing after whatever the last real record
   for this date currently is — for when a cashier leaves early and
   someone else needs to close out and reopen. Night is always first
   and Evening is always last (state.js's daySlots/getSeq) — a
   Handover only ever slots in between them.

   WHY the placeholder comes first: timelineStep/daySlots (state.js)
   only know about a slot once it exists in db.sheets. If we called
   initLedger() for a brand-new key straight away, its own internal
   pullPreviousShift() would ask timelineStep for "the previous slot"
   before this one is registered anywhere — and since it wouldn't be
   found in daySlots' list yet, the step would incorrectly resolve to
   the wrong neighbor. Registering a minimal placeholder record FIRST
   (with its real `seq`) makes it immediately visible to daySlots, so
   every ordering lookup from that point on — including the explicit
   pullPreviousShift() call below — resolves correctly. */
export function insertHandoverClosing(ds) {
  const slot = computeNextHandoverSlot(ds);
  if(slot.error) { alert(slot.error); return; }
  const { key, shift, seq } = slot;

  db.sheets[key] = { seq, shiftLabel: 'Handover', draft: true, profileMode: 'shift' };
  persist();

  session.activeKey  = key;
  session.activeMode = 'shift';
  session.overrides  = {};
  initLedger(ds, shift, 'shift');
  /* Explicitly re-seed carry-forward — see comment above on why the
     placeholder alone isn't enough: initLedger's existing-record
     branch only auto-refreshes the 4 carried numeric fields, not
     misc-row carry-forward (that's deliberately skip on REOPENING an
     existing draft — see refreshCarryForwardFromPrevious's own
     comment — but this is genuinely a brand-new closing, which
     should get the full brand-new-sheet treatment, misc rows
     included, same as Night/Morning/Evening always have). */
  pullPreviousShift(ds, shift, 'shift');
  zeroCreditEntries();
  calc();
}

/* Re-sync ONLY the 4 "carried forward" fields (CC, Credit, Deposits,
   Cash Position) from the previous shift's CURRENT saved state, for a
   sheet that already exists (draft, or a saved sheet reopened via
   Edit-PIN). This intentionally does NOT touch misc rows or anything
   else pullPreviousShift() seeds — those are one-time defaults for a
   brand-new sheet, not something to silently re-apply over a sheet
   the user has already been working on. Any of the 4 fields the user
   has manually corrected in THIS sheet (tracked in `session.overrides`) is
   left exactly as they set it. */
export function refreshCarryForwardFromPrevious(ds, shift, mode) {
  const prev = timelineStep(ds, shift, -1);
  const hs   = getRealSheet(prev.key);
  if(!hs) return;

  const setIfNotOverridden = (id, v) => {
    if(session.overrides[id] !== undefined) return;
    set(id, v);
  };

  /* CC — same day-cycle rule as pullPreviousShift() above */
  let carriedCC = 0;
  if(shift === 'Night') {
    carriedCC = (parseFloat(hs.outPrevCC) || 0) + (parseFloat(hs.outCurrCC) || 0);
  } else {
    const nightSheet = getRealSheet(ds + '_Night');
    carriedCC = nightSheet ? (parseFloat(nightSheet.outPrevCC) || 0) : (parseFloat(hs.outPrevCC) || 0);
  }
  setIfNotOverridden('out-prev-cc', carriedCC);

  setIfNotOverridden('out-prev-credit', parseFloat(hs.outTotalE) || 0);

  if(mode === 'final') {
    setIfNotOverridden('out-prev-dep',  0);
    setIfNotOverridden('out-prev-cash', 0);
  } else {
    setIfNotOverridden('out-prev-dep',  parseFloat(hs.outTotalF) || 0);
    setIfNotOverridden('out-prev-cash', parseFloat(hs.outTotalCash) || 0);
  }
}

export function findLastFinal(ds, shift) {
  let cur = {date: ds, shift: shift};
  for(let i=0;i<400;i++) {
    cur = timelineStep(cur.date, cur.shift, -1);
    const rec = getRealSheet(cur.key);
    if(rec && rec.profileMode === 'final') return {key: cur.key, rec};
    if(!rec && i>200) break; /* safety: avoid endless scan into empty history */
  }
  return null;
}

export function aggregateSinceLastFinal(ds, shift) {
  const lastFinal = findLastFinal(ds, shift);
  let totalCustomers = 0, totalShiftSale = 0, totalManualReturns = 0, totalSysReturns = 0,
      totalExtraCash = 0, totalShiftNetCash = 0, totalBookBills = 0, shiftCount = 0;
  /* date-split: "same-date" = date === ds, "pre-date" = date < ds */
  let sameDateShiftSale = 0, preDateShiftSale = 0;
  let sameDateCustomers = 0, preDateCustomers = 0;
  let sameDateSysReturns = 0, preDateSysReturns = 0;
  const labels = [];
  let cur = {date: ds, shift: shift};
  for(let i = 0; i < 400; i++) {
    cur = timelineStep(cur.date, cur.shift, -1);
    if(lastFinal && cur.key === lastFinal.key) break;
    const rec = getRealSheet(cur.key);
    if(!rec) { if(!lastFinal) break; else continue; }
    if(rec.profileMode === 'final') break;
    const shiftSale = parseFloat(rec.outShiftSale) || 0;
    const customers = parseFloat(rec.outCust)      || 0;
    const sysRet    = parseFloat(rec.posRetSys)    || 0;
    const manRet    = (parseFloat(rec.posRet1)||0) + (parseFloat(rec.posRet2)||0) + (parseFloat(rec.posRet3)||0);
    const books     = (parseFloat(rec.inBook1)||0) + (parseFloat(rec.inBook2)||0);
    const isToday   = (cur.date === ds);
    totalCustomers     += customers;
    totalShiftSale     += shiftSale;
    totalManualReturns += manRet;
    totalSysReturns    += sysRet;
    totalExtraCash     += parseFloat(rec.extraCash) || 0;
    totalShiftNetCash  += parseFloat(rec.outNetCash) || 0;
    totalBookBills     += books;
    shiftCount++;
    labels.unshift(srLabel(cur.shift).replace('Closing','C') + ' ' + cur.date);
    if(isToday) { sameDateShiftSale += shiftSale; sameDateCustomers += customers; sameDateSysReturns += sysRet; }
    else        { preDateShiftSale  += shiftSale; preDateCustomers  += customers; preDateSysReturns += sysRet; }
  }
  /* categorise last final's own values by date */
  let lfSameDateSale = 0, lfPreDateSale = 0;
  let lfSameDateCust = 0, lfPreDateCust = 0;
  let lfSameDateSysRet = 0, lfPreDateSysRet = 0;
  if(lastFinal) {
    const lf     = lastFinal.rec;
    const lfDate = lastFinal.key.split('_')[0];
    const lfSale = parseFloat(lf.outShiftSale) || 0;
    const lfCust = parseFloat(lf.outCust)      || 0;
    const lfSysR = parseFloat(lf.posRetSys)    || 0;
    if(lfDate === ds) { lfSameDateSale = lfSale; lfSameDateCust = lfCust; lfSameDateSysRet = lfSysR; }
    else              { lfPreDateSale  = lfSale; lfPreDateCust  = lfCust; lfPreDateSysRet = lfSysR; }

    /* ── Include previous final closing's own manual returns, book bills & extra cash ──
       These were recorded on the final closing itself and must carry into the
       next period's cumulative totals. */
    const lfManRet    = (parseFloat(lf.posRet1)||0) + (parseFloat(lf.posRet2)||0) + (parseFloat(lf.posRet3)||0);
    const lfBooks     = (parseFloat(lf.inBook1)||0)  + (parseFloat(lf.inBook2)||0);
    const lfExtraCash = parseFloat(lf.extraCash) || 0;
    totalManualReturns += lfManRet;
    totalBookBills     += lfBooks;
    totalExtraCash     += lfExtraCash;
  }
  return {
    lastFinal,
    totalCustomers, totalShiftSale, totalManualReturns, totalSysReturns,
    totalExtraCash, totalShiftNetCash, totalBookBills, shiftCount, labels,
    sameDateShiftSale, preDateShiftSale,
    sameDateCustomers, preDateCustomers, sameDateSysReturns, preDateSysReturns,
    lfSameDateSale, lfPreDateSale,
    lfSameDateCust, lfPreDateCust, lfSameDateSysRet, lfPreDateSysRet
  };
}

/* ═══════════════════════════════════════════
   MAIN CALCULATION PIPELINE
═══════════════════════════════════════════ */
export function calc() {
  /* HS */
  let hsTotal = 0;
  document.querySelectorAll('.hs-val').forEach(el => hsTotal += parseFloat(el.value)||0);
  set('out-total-hs', hsTotal);
  const badge_hs = document.getElementById('badge-hs');
  if(badge_hs) badge_hs.textContent = 'Rs. ' + hsTotal.toLocaleString();

  /* Strips (A) */
  let totalA = 0;
  const stripPrices = document.querySelectorAll('.strip-price');
  const stripQtys   = document.querySelectorAll('.strip-qty');
  stripPrices.forEach((el, i) => {
    const p    = parseFloat(el.value)||0;
    const q    = parseFloat(stripQtys[i]?.value)||0;
    const line = p*q;
    const lineEl = document.getElementById(`strip-line-${i}`);
    if(lineEl) lineEl.value = line;
    totalA += line;
  });
  document.querySelectorAll('.aux-strip-price').forEach((el, i) => {
    const p    = parseFloat(el.value)||0;
    const q    = parseFloat(document.querySelectorAll('.aux-strip-qty')[i]?.value)||0;
    const line = p*q;
    const tot  = document.querySelectorAll('.aux-strip-total')[i];
    if(tot) tot.value = line;
    totalA += line;
  });
  set('out-total-a', totalA);
  const badge_strips = document.getElementById('badge-strips');
  if(badge_strips) badge_strips.textContent = 'Rs. ' + totalA.toLocaleString();

  /* POS */
  const sysCash    = val('in-sys-cash');
  const lastBillAmt = val('in-last-bill-amt');
  const lastBillNum = parseInt(g('in-last-bill-num')?.value)||0;
  const compSale   = val('in-comp-sale');
  const alfalah    = val('in-alfalah');
  const keenu      = val('in-keenu');

  /* Returns */
  const ret1 = val('pos-ret-1'); const ret2 = val('pos-ret-2'); const ret3 = val('pos-ret-3');
  const retSys = val('pos-ret-sys');
  const totalReturns = ret1 + ret2 + ret3 + retSys;
  set('out-total-returns', totalReturns);
  const badge_pos = document.getElementById('badge-pos');
  if(badge_pos) badge_pos.textContent = 'Rs. ' + sysCash.toLocaleString();

  /* Shift sale delta */
  const parts     = session.activeKey ? session.activeKey.split('_') : ['',''];
  const prevNode  = timelineStep(parts[0], parts[1], -1);
  const prevSheet = getRealSheet(prevNode.key);
  const dayChanged = (parts[0] !== prevNode.date);

  let shiftSale = 0;
  if(session.activeMode==="final" || dayChanged || !prevSheet) {
    shiftSale = sysCash;
  } else {
    shiftSale = sysCash - (parseFloat(prevSheet.inSysCash)||0);
  }
  applyOrOverride('out-shift-sale', shiftSale);

  let custDelta = 0;
  if(prevSheet) {
    /* Always compute customer delta from bill number difference, regardless of day change or mode */
    custDelta = Math.max(0, lastBillNum - (parseInt(prevSheet.inLastBillNum)||0));
  }
  applyOrOverride('out-cust', custDelta);

  const shiftSaleVal = val('out-shift-sale');
  const book1  = val('in-book-1');
  const book2  = val('in-book-2');
  const custVal = val('out-cust');
  const netSale = shiftSaleVal + book1 + book2 + custVal - totalReturns;
  set('out-net-sale', netSale);
  const badge_shift = document.getElementById('badge-shift');
  if(badge_shift) badge_shift.textContent = 'Rs. ' + netSale.toLocaleString();

  /* CC (B) */
  const currCC = (alfalah + keenu) - compSale;
  applyOrOverride('out-curr-cc', currCC);
  const badge_cc = document.getElementById('badge-cc');
  if(badge_cc) badge_cc.textContent = 'Rs. ' + (val('out-prev-cc') + val('out-curr-cc')).toLocaleString();

  /* Denominations (C & D) */
  let totalC = 0;
  document.querySelectorAll('.till-cell').forEach(el => {
    totalC += (parseFloat(el.value)||0) * parseFloat(el.dataset.mult);
  });
  set('out-subtotal-c', totalC);
  const badge_till = document.getElementById('badge-till');
  if(badge_till) badge_till.textContent = 'Rs. ' + totalC.toLocaleString();

  let totalD = 0;
  document.querySelectorAll('.vault-cell').forEach(el => {
    totalD += (parseFloat(el.value)||0) * parseFloat(el.dataset.mult);
  });
  set('out-subtotal-d', totalD);
  const badge_vault = document.getElementById('badge-vault');
  if(badge_vault) badge_vault.textContent = 'Rs. ' + totalD.toLocaleString();

  /* Debt (E) */
  const carriedCredit = val('out-prev-credit');
  let namedDebt = 0;
  document.querySelectorAll('.named-entry-val').forEach(el => namedDebt += parseFloat(el.value)||0);
  let tierDebt = 0;
  for(let i=1;i<=3;i++) tierDebt += val(`in-nested-${i}`);
  let auxDebt = 0;
  document.querySelectorAll('.aux-cred-val').forEach(el => auxDebt += parseFloat(el.value)||0);
  const totalE = carriedCredit + namedDebt + tierDebt + auxDebt + val('in-credit-adj');
  set('out-total-e', totalE);
  const badge_credit = document.getElementById('badge-credit');
  if(badge_credit) badge_credit.textContent = 'Rs. ' + totalE.toLocaleString();

  /* Deposits (F) */
  const carriedDep = val('out-prev-dep');
  let depTotal = 0;
  document.querySelectorAll('.dep-val').forEach(el => depTotal += parseFloat(el.value)||0);
  const totalF = carriedDep + depTotal;
  set('out-total-f', totalF);
  const badge_dep = document.getElementById('badge-deposits');
  if(badge_dep) badge_dep.textContent = 'Rs. ' + totalF.toLocaleString();

  /* Misc (G) */
  let totalG = 0;
  document.querySelectorAll('.misc-row input[type="number"]').forEach(el => {
    totalG += parseFloat(el.value)||0;
  });
  set('out-total-g', totalG);
  const badge_misc = document.getElementById('badge-misc');
  if(badge_misc) badge_misc.textContent = 'Rs. ' + totalG.toLocaleString();

  /* Grand total: A=HS, B=Strips, C=Misc, D=CC, E=Till, F=Draw, G=Credit, H=Deposits */
  const ccB   = val('out-prev-cc') + val('out-curr-cc');
  const grand = hsTotal + totalA + totalG + ccB + totalC + totalD + totalE + totalF;
  set('out-grand', grand);
  const liquid = grand - 45000;
  set('out-liquid', liquid);

  const carriedCash = val('out-prev-cash');
  applyOrOverride('out-prev-cash', carriedCash);
  const extraCash = val('in-extra-cash');
  const netCash  = liquid - val('out-prev-cash') - extraCash;
  set('out-net-cash', netCash);

  /* ── Final Closing aggregation — computed in ALL modes ── */
  let bannerTarget = netSale, bannerCash = netCash;
  if(session.activeKey) {
    const parts2 = session.activeKey.split('_');
    const agg    = aggregateSinceLastFinal(parts2[0], parts2[1]);
    set('out-final-shifts', agg.shiftCount ? `${agg.shiftCount} — ${agg.labels.join(', ')}` : '— none —');

    /* ─── PART 1: Net Final Sale ─────────────────────────── */
    let totalSameDateSys, totalBooks, totalSameDateCust, totalManRet, totalSameSysRet;
    if (session.activeMode === 'final') {
      /* Final Closing selected: use current shift values only */
      totalSameDateSys  = shiftSaleVal;
      totalBooks        = book1 + book2;
      totalSameDateCust = custVal;
      totalManRet       = ret1 + ret2 + ret3;
      totalSameSysRet   = retSys;
    } else {
      /* Non-final modes: aggregate across period as before */
      /* POS: same-date shifts + last-final (if same date) + this closing */
      totalSameDateSys  = agg.sameDateShiftSale + agg.lfSameDateSale + shiftSaleVal;
      /* Book bills: ALL periods */
      totalBooks        = agg.totalBookBills + book1 + book2;
      /* Customers: same-date only */
      totalSameDateCust = agg.sameDateCustomers + agg.lfSameDateCust + custVal;
      /* Manual returns: ALL periods */
      totalManRet       = agg.totalManualReturns + ret1 + ret2 + ret3;
      /* Sys returns: same-date only (incl. last final if same date) + this closing */
      totalSameSysRet   = agg.sameDateSysReturns + agg.lfSameDateSysRet + retSys;
    }
    /* Additional sys returns entered manually in this final */
    const finalExtraRet     = val('in-final-sys-returns');
    const finalNetSale = totalSameDateSys + totalBooks + totalSameDateCust
                       - totalManRet - totalSameSysRet - finalExtraRet;

    set('out-final-same-sys',    totalSameDateSys);
    set('out-final-books',       totalBooks);
    set('out-final-same-cust',   totalSameDateCust);
    set('out-final-man-ret',     totalManRet);
    set('out-final-same-sysret', totalSameSysRet);
    set('out-final-net-sale',    finalNetSale);

    /* ─── PART 2: Net Final Cash Available ───────────────── */
    let preDateSys, preDateCust, preDateSysRet, totalExtraCashPeriod;
    if (session.activeMode === 'final') {
      /* Final Closing selected: no pre-date aggregation, extra cash = current shift only */
      preDateSys             = 0;
      preDateCust            = 0;
      preDateSysRet          = 0;
      totalExtraCashPeriod   = extraCash;
    } else {
      preDateSys             = agg.preDateShiftSale + agg.lfPreDateSale;
      preDateCust            = agg.preDateCustomers  + agg.lfPreDateCust;
      preDateSysRet          = agg.preDateSysReturns + agg.lfPreDateSysRet;
      totalExtraCashPeriod   = agg.totalExtraCash + extraCash;
    }
    const preDateTotal      = preDateSys + preDateCust - preDateSysRet;
    const finalNetCash      = liquid - preDateTotal - totalExtraCashPeriod - finalNetSale;

    set('out-final-net-cash-base', liquid);
    set('out-final-pre-sys',       preDateSys);
    set('out-final-pre-cust',      preDateCust);
    set('out-final-pre-sysret',    preDateSysRet);
    set('out-final-pre-total',     preDateTotal);
    set('out-final-extra-cash',    totalExtraCashPeriod);
    set('out-final-target-sale',   finalNetSale);
    set('out-final-net-cash',      finalNetCash);

    /* ─── VARIANCE ───────────────────────────────────────── */
    const finalDiff = finalNetCash;
    const fdEl  = document.getElementById('out-final-diff');
    const fdLbl = document.getElementById('out-final-diff-label');
    if(finalDiff === 0) {
      fdLbl.textContent = 'Variance (Final Audit):';
      fdEl.value = 0;
    } else if(finalDiff > 0) {
      fdLbl.textContent = 'Plus (Final Audit):';
      fdEl.value = finalDiff;
    } else {
      fdLbl.textContent = 'Less (Final Audit):';
      fdEl.value = Math.abs(finalDiff);
    }

    /* legacy hidden fields kept for buildSheetRecord compat */
    set('out-final-net-sale-adj', finalNetSale - totalExtraCashPeriod);
    set('out-final-net-cash-adj', finalNetCash);
    set('out-final-prev-sale',    0);

    if(session.activeMode === 'final') {
      bannerTarget = netSale;
      bannerCash   = netCash;
    }
  }

  const diff = bannerCash - bannerTarget; /* positive = surplus cash (Plus), negative = shortage (Less) */
  /* Updates both the "View all" popup banner (ban-*) and the identical
     strip embedded directly in the Audit tab (audit-ban-*), so the two
     always stay in sync from a single source of truth. */
  function paintBanner(idPrefix) {
    const targetEl = document.getElementById(idPrefix + 'target');
    const cashEl   = document.getElementById(idPrefix + 'cash');
    const varEl    = document.getElementById(idPrefix + 'variance');
    const varLbl   = document.getElementById(idPrefix + 'variance-label');
    if(!targetEl || !cashEl || !varEl) return;
    targetEl.textContent = "Rs. " + bannerTarget.toLocaleString('en-PK');
    cashEl.textContent   = "Rs. " + bannerCash.toLocaleString('en-PK');
    if(diff === 0) {
      if(varLbl) varLbl.textContent = 'Variance';
      varEl.textContent = "Rs. 0";
      varEl.className = 'val pos';
    } else if(diff > 0) {
      if(varLbl) varLbl.textContent = 'Plus';
      varEl.textContent = "Rs. " + diff.toLocaleString('en-PK');
      varEl.className = 'val pos';
    } else {
      if(varLbl) varLbl.textContent = 'Less';
      varEl.textContent = "Rs. " + Math.abs(diff).toLocaleString('en-PK');
      varEl.className = 'val neg';
    }
  }
  paintBanner('ban-');
  paintBanner('audit-ban-');
  /* ── real-time auto-draft ── */
  scheduleAutoSave();
  if (typeof updateSectionStatus === 'function') updateSectionStatus();
  skipReadonlyInTabOrder();
}

/* Tab / mobile "Next" should only step across editable Qty/value cells,
   never land on computed read-only fields (line totals, locked prices,
   carried-over values, etc). Readonly inputs are pulled out of the tab
   order entirely; new rows added dynamically (strips, credit entries)
   are covered because calc() re-runs this after every change. */
export function skipReadonlyInTabOrder() {
  document.querySelectorAll('input[readonly]').forEach(el => {
    el.tabIndex = -1;
  });
}

/* ═══════════════════════════════════════════
   OVERRIDE HANDLING
═══════════════════════════════════════════ */

export function toggleSign(id) {
  const el = g(id);
  if(!el) return;
  el.value = -(parseFloat(el.value)||0);
  calc();
}
export function setOverride(id) {
  session.overrides[id] = parseFloat(g(id)?.value)||0;
  calc();
}
export function applyOrOverride(id, baseVal) {
  const el  = g(id);
  const box = g(`box-${id}`);
  if(!el) return;
  if(session.overrides[id] !== undefined) {
    el.value = session.overrides[id];
    box?.classList.add('override-on');
  } else if(session.isSavedSheet) {
    /* this sheet was already saved — keep the hydrated snapshot value
       instead of recomputing from the (possibly since-changed) previous shift */
    box?.classList.remove('override-on');
  } else {
    el.value = baseVal;
    box?.classList.remove('override-on');
  }
}

/* ═══════════════════════════════════════════
   LEDGER PAGINATION
═══════════════════════════════════════════ */
export function moveLedgerShift(n) {
  if(!session.activeKey) return;
  autoSave();
  const parts = session.activeKey.split('_');
  const dir = n > 0 ? 1 : -1;

  /* ── Scan in the requested direction for the nearest slot
     that has a real saved record. Backward navigation must
     never land on / create an empty slot. ── */
  let cur = {date: parts[0], shift: parts[1]};
  let found = null;
  for(let i = 0; i < 400; i++) {
    cur = timelineStep(cur.date, cur.shift, dir);
    if(getRealSheet(cur.key)) { found = cur; break; }
  }

  if(!found) {
    alert(dir < 0
      ? '⛔ No earlier saved shift found in history.'
      : '⛔ No later saved shift found in history.');
    return;
  }

  /* ── FORWARD-OPEN GUARD on pagination ──────────────────────────
     When navigating forward (n > 0), block if the current sheet
     is not yet saved (still a draft or unsaved). */
  if(n > 0) {
    const currSheet = db.sheets[session.activeKey];
    const currIsDraft = currSheet && currSheet.draft === true;
    const currIsUnsaved = !currSheet;
    if(currIsDraft || currIsUnsaved) {
      alert(`⛔ Cannot navigate forward.\n\nThe current closing "${parts[0]} — ${srLabel(parts[1])}" has not been saved yet.\n\nPress "Save & Close This Shift" first.`);
      return;
    }
  }

  session.activeKey   = found.key;
  session.activeMode  = db.sheets[session.activeKey]?.profileMode || 'shift';
  session.overrides   = db.sheets[session.activeKey]?.overrides || {};
  initLedger(found.date, found.shift, session.activeMode);
}

export function autoSave() {
  try { calc(); saveSheet(true); } catch(e) { /* silent — best-effort */ }
}

/* ═══════════════════════════════════════════
   POPULATE NAME DROPDOWN
═══════════════════════════════════════════ */
export function populateNameDropdown(num) {
  const tIdx  = g(`sel-tier-${num}`)?.value;
  const nameS = g(`sel-name-${num}`);
  if(!nameS) return;
  nameS.innerHTML = "<option value=''>— Name —</option>";
  if(tIdx !== '' && tIdx !== undefined) {
    const tier = db.settings.subTiers[tIdx];
    tier?.names.forEach(nm => {
      const o = document.createElement('option'); o.value = nm; o.textContent = nm;
      nameS.appendChild(o);
    });
  }
  calc();
}

/* ═══════════════════════════════════════════
   SAVE / HYDRATE
═══════════════════════════════════════════ */
export function buildSheetRecord() {
  return {
    profileMode: session.activeMode,
    overrides:   session.overrides,
    inSysCash:    val('in-sys-cash'),
    inLastBillAmt:val('in-last-bill-amt'),
    inLastBillNum:parseInt(g('in-last-bill-num')?.value)||0,
    inCompSale:   val('in-comp-sale'),
    inAlfalah:    val('in-alfalah'),
    inKeenu:      val('in-keenu'),
    inBook1:      val('in-book-1'),
    inBook2:      val('in-book-2'),
    posRet1:      val('pos-ret-1'),
    posRet2:      val('pos-ret-2'),
    posRet3:      val('pos-ret-3'),
    posRetSys:    val('pos-ret-sys'),
    outNetSale:   val('out-net-sale'),
    outCurrCC:    val('out-curr-cc'),
    outPrevCC:    val('out-prev-cc'),
    outPrevCredit:val('out-prev-credit'),
    outPrevDep:   val('out-prev-dep'),
    outPrevCash:  val('out-prev-cash'),
    outTotalE:    val('out-total-e'),
    creditAdj:    val('in-credit-adj'),
    extraCash:    val('in-extra-cash'),
    outTotalF:    val('out-total-f'),
    outTotalCash: val('out-liquid'),
    outNetCash:   val('out-net-cash'),
    outShiftSale: val('out-shift-sale'),
    outCust:      val('out-cust'),
    finalSysReturns: val('in-final-sys-returns'),
    finalNetSale:    val('out-final-net-sale'),
    finalNetSaleAdj: val('out-final-net-sale-adj'),
    finalNetCash:    val('out-final-net-cash'),
    finalNetCashAdj: val('out-final-net-cash-adj'),
    finalDiff:       val('out-final-diff'),
    finalDiffLabel:  document.getElementById('out-final-diff-label')?.textContent || '',
    finalPrevSale:   val('out-final-prev-sale'),
    hsRows: Array.from(document.querySelectorAll('#hs-rows .row')).map(r=>({
      id:  r.dataset.rid || genRowId(),
      lbl: r.querySelector('.hs-lbl')?.value||'',
      val: parseFloat(r.querySelector('.hs-val')?.value)||0
    })),
    stripQtys:  Array.from(document.querySelectorAll('.strip-qty')).map(e=>parseFloat(e.value)||0),
    stripPrices:Array.from(document.querySelectorAll('.strip-price')).map(e=>parseFloat(e.value)||0),
    /* Reads each row as a whole (not three separately-zipped NodeLists
       by position) so a stable id travels with its own row, and nothing
       shifts out of alignment if rows are ever reordered. */
    auxStrips: Array.from(document.querySelectorAll('#ledger-strips .strip-row')).map(row => ({
      id:    row.dataset.rid || genRowId(),
      label: row.querySelector('.aux-strip-lbl')?.value || '',
      p:     parseFloat(row.querySelector('.aux-strip-price')?.value) || 0,
      q:     parseFloat(row.querySelector('.aux-strip-qty')?.value) || 0
    })),
    tillValues:  Array.from(document.querySelectorAll('.till-cell')).map(e=>parseFloat(e.value)||0),
    vaultValues: Array.from(document.querySelectorAll('.vault-cell')).map(e=>parseFloat(e.value)||0),
    namedCredits: Array.from(document.querySelectorAll('.named-account-block')).flatMap(block => {
      const idx = parseInt(block.dataset.accountIdx);
      const lbl = db.settings.namedCredits[idx]?.label || '';
      return Array.from(block.querySelectorAll('.named-entry-row')).map(row => ({
        id:   row.dataset.rid || genRowId(),
        idx,
        lbl,
        desc: row.querySelector('.named-entry-desc')?.value || '',
        val:  parseFloat(row.querySelector('.named-entry-val')?.value) || 0
      }));
    }),
    tierCredits: [1,2,3].map(i=>({
      tIdx:  g(`sel-tier-${i}`)?.value,
      name:  g(`sel-name-${i}`)?.value,
      val:   val(`in-nested-${i}`)
    })),
    auxCredits: Array.from(document.querySelectorAll('#ledger-aux-credits .row')).map(r=>({
      id:  r.dataset.rid || genRowId(),
      lbl: r.querySelector('.aux-cred-lbl')?.value||'',
      val: parseFloat(r.querySelector('.aux-cred-val')?.value)||0
    })),
    deposits: Array.from(document.querySelectorAll('#ledger-deposits .row')).map(r=>({
      id:  r.dataset.rid || genRowId(),
      lbl: r.querySelector('.dep-lbl')?.value||'',
      val: parseFloat(r.querySelector('.dep-val')?.value)||0
    })),
    miscRows: Array.from(document.querySelectorAll('#ledger-misc .misc-row')).map(r => ({
      id:    r.dataset.rid || genRowId(),
      label: r.querySelector('.lbl-input')?.value||'',
      val:   parseFloat(r.querySelector('input[type="number"]')?.value)||0
    }))
  };
}

/* ── TOAST ───────────────────────────────────────────────── */

export function saveSheet(silent=false) {
  const record = buildSheetRecord();
  record.draft    = false;
  record.locked   = true;
  record.savedAt  = Date.now();
  /* seq/shiftLabel are slot-identity metadata (which Handover number
     this is, its assigned order) — not something buildSheetRecord()
     can derive from the DOM, so they'd otherwise be silently wiped
     out by this save. Carry them forward from whatever's already
     stored at this key, same as draft/locked/savedAt are explicitly
     set here rather than left to buildSheetRecord(). */
  const existing = db.sheets[session.activeKey];
  if(existing && typeof existing.seq === 'number') record.seq = existing.seq;
  if(existing && existing.shiftLabel) record.shiftLabel = existing.shiftLabel;
  db.sheets[session.activeKey] = record;
  clSaveSnapshot(session.activeKey, record);  /* ← credit ledger snapshot */
  alCommit(session.activeMode === 'final' ? 'save-final' : 'save', session.activeKey, record);
  persist();
  session.isSavedSheet = true;
  if(!silent) {
    setLockedState(true);
    cascadeDownstream(session.activeKey);
    showSaveAction(
      session.activeMode === 'final' ? '🔴 Final Closing Saved' : '✅ Shift Closing Saved',
      'Closing completed, saved and locked.',
      [{ label: 'OK', style: 'btn-green', action: goToDashboard }]
    );
  }
}

export function hydrate(s) {
  const sv = (id, v) => { const el=g(id); if(el && v!==undefined) el.value=v; };

  sv('in-sys-cash',      s.inSysCash);
  sv('out-shift-sale',   s.outShiftSale);
  sv('out-curr-cc',      s.outCurrCC);
  sv('out-cust',         s.outCust);
  sv('in-last-bill-amt', s.inLastBillAmt);
  sv('in-last-bill-num', s.inLastBillNum);
  sv('in-comp-sale',     s.inCompSale);
  sv('in-alfalah',       s.inAlfalah);
  sv('in-keenu',         s.inKeenu);
  sv('in-book-1',        s.inBook1);
  sv('in-book-2',        s.inBook2);
  sv('pos-ret-1',        s.posRet1||0);
  sv('pos-ret-2',        s.posRet2||0);
  sv('pos-ret-3',        s.posRet3||0);
  sv('pos-ret-sys',      s.posRetSys||0);

  /* HS rows */
  document.getElementById('hs-rows').innerHTML = "";
  session.hsRowCount = 0;
  if(s.hsRows && s.hsRows.length) {
    s.hsRows.forEach(o => addHsRow(o.lbl, o.val, o.id));
  } else if(s.hsRecords) { /* legacy */
    s.hsRecords.forEach(o => addHsRow(o.lbl, o.val));
  } else {
    addHsRow('Home Service 1', 0);
  }

  /* strips — qty restored from saved sheet, price always taken live from Settings (Inventory Catalog) */
  const qc = document.querySelectorAll('.strip-qty');
  if(s.stripQtys)  qc.forEach((el,i) => el.value = s.stripQtys[i]??'');

  /* aux strips */
  document.querySelectorAll('#ledger-strips .strip-row').forEach(r => {
    if(r.querySelector('.aux-strip-lbl')) r.remove();
  });
  session.auxStripCount = 0;
  if(s.auxStrips) s.auxStrips.forEach(o => addAuxStripRow(o.label||'', o.p, o.q, o.id));

  /* till / vault */
  if(s.tillValues)  document.querySelectorAll('.till-cell').forEach((el,i) => el.value=s.tillValues[i]||0);
  if(s.vaultValues) document.querySelectorAll('.vault-cell').forEach((el,i) => el.value=s.vaultValues[i]||0);

  /* named credits — rebuild entry rows per account */
  document.querySelectorAll('.named-account-block').forEach(block => {
    block.querySelectorAll('.named-entry-row').forEach(r => r.remove());
  });
  /* Only restore rows that actually carry data (a description or a
     non-zero amount). Empty/zero placeholder rows are never persisted
     back into the UI — the account block simply starts empty and the
     user adds a row via "+ Add entry" when they need one. */
  const hasContent = o => (o && ((o.desc && o.desc.trim()) || (parseFloat(o.val) || 0) !== 0));
  if(s.namedCredits && s.namedCredits.length) {
    const hasIdx = s.namedCredits.some(o => o.idx !== undefined);
    if(hasIdx) {
      db.settings.namedCredits.forEach((nc, idx) => {
        s.namedCredits.filter(o => o.idx === idx && hasContent(o))
          .forEach(o => addNamedCreditEntryRow(idx, o.desc||'', o.val||0, o.id));
      });
    } else {
      /* legacy: one entry per account, positional, no description */
      db.settings.namedCredits.forEach((nc, idx) => {
        const o = s.namedCredits[idx];
        if(hasContent(o)) addNamedCreditEntryRow(idx, '', o.val || 0);
      });
    }
  } else if(s.auxCredits) { /* very old legacy */
    db.settings.namedCredits.forEach((nc, idx) => {
      const o = s.auxCredits[idx];
      if(hasContent(o)) addNamedCreditEntryRow(idx, '', o.val || 0);
    });
  }

  /* tier credits */
  if(s.tierCredits) s.tierCredits.forEach((o,i) => {
    const ts = g(`sel-tier-${i+1}`); if(ts && o.tIdx!==undefined) ts.value = o.tIdx;
    populateNameDropdown(i+1);
    const ns = g(`sel-name-${i+1}`); if(ns) ns.value = o.name||'';
    sv(`in-nested-${i+1}`, o.val);
  });
  /* legacy nestedCredits */
  else if(s.nestedCredits) s.nestedCredits.forEach((o,i) => {
    const ts = g(`sel-tier-${i+1}`); if(ts) ts.value = o.tIdx;
    populateNameDropdown(i+1);
    const ns = g(`sel-name-${i+1}`); if(ns) ns.value = o.name;
    sv(`in-nested-${i+1}`, o.val);
  });

  /* aux credits */
  document.getElementById('ledger-aux-credits').innerHTML = "";
  session.auxCreditCount = 0;
  if(s.auxCredits) s.auxCredits.forEach(o => addAuxCreditRow(o.lbl, o.val, o.id));

  /* deposits */
  document.getElementById('ledger-deposits').innerHTML = "";
  session.depositCount = 0;
  if(s.deposits) s.deposits.forEach(o => addDepositRow(o.lbl, o.val, o.id));

  /* misc */
  document.getElementById('ledger-misc').innerHTML = "";
  session.miscCount = 0;
  if(s.miscRows) s.miscRows.forEach(o => addMiscRow(o.label||'', o.val, o.id));

  sv('out-prev-cc',     s.outPrevCC);
  sv('out-prev-credit', s.outPrevCredit ?? s.outTotalE);
  sv('in-credit-adj',   s.creditAdj||0);
  sv('in-extra-cash',   s.extraCash||0);
  sv('out-prev-dep',    s.outPrevDep ?? s.outTotalF);
  sv('out-prev-cash',   s.outPrevCash ?? s.outTotalCash);
  sv('in-final-sys-returns', s.finalSysReturns||0);
}

export function flushInputs() {
  document.querySelectorAll('#page-ledger input[type="number"]').forEach(el => {
    if(!el.readOnly) el.value = 0;
  });
  /* build default HS rows */
  document.getElementById('hs-rows').innerHTML = "";
  session.hsRowCount = 0;
  for(let i=1;i<=3;i++) addHsRow(`Home Service ${i}`, 0);
  /* default deposit & misc rows */
  document.getElementById('ledger-deposits').innerHTML = "";
  session.depositCount = 0;
  for(let i=1;i<=3;i++) addDepositRow();
  document.getElementById('ledger-misc').innerHTML = "";
  session.miscCount = 0;
  for(let i=1;i<=5;i++) addMiscRow();
}

/* ═══════════════════════════════════════════
   CASCADE DOWNSTREAM UPDATES
═══════════════════════════════════════════ */
export function cascadeDownstream(originKey) {
  /* NOTE: downstream sheets are immutable snapshots once saved (see session.isSavedSheet).
     We deliberately do NOT recompute their "carried from previous" fields here —
     doing so previously caused double-counted deposits/credits when a downstream
     sheet already had its own entries plus a freshly recomputed carry-forward.
     If an earlier sheet's totals change, re-open the affected downstream sheet
     and adjust its "Carried from Previous" fields manually (they're editable). */
  return;
}

/* ═══════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════ */
/* ═══════════════════════════════════════════
   DEBOUNCED CLOUD PUSH
═══════════════════════════════════════════ */
let _pushTimer = null;
export function scheduleSyncPush(delay = 0) {
  if(!syncIsReady()) return;
  clearTimeout(_pushTimer);
  if(delay === 0) {
    syncPushToCloud(false).catch(() => {});
  } else {
    _pushTimer = setTimeout(() => syncPushToCloud(false).catch(() => {}), delay);
  }
}

/* ═══════════════════════════════════════════
   REAL-TIME AUTO DRAFT (from calc)
═══════════════════════════════════════════ */
let _draftTimer  = null;
let _draftReady  = false; /* gates auto-save: true only after ledger fully inits */

export function scheduleAutoSave() {
  if(!session.activeKey || !_draftReady || session.isSheetLocked) return;
  if(typeof cbIsAssembling === 'function' && cbIsAssembling()) return; /* Closing Book is assembling — don't autosave every sheet it loads */
  clearTimeout(_draftTimer);
  _draftTimer = setTimeout(() => {
    try {
      const record = buildSheetRecord();
      record.draft  = true;
      record.locked = false;
      db.sheets[session.activeKey] = record;
      persist();
    } catch(e) { /* silent — draft save is best-effort */ }
  }, 3000); /* 3 s idle after last keystroke */
}

/* Warned-once guard so a full/restricted localStorage doesn't pop an
   alert every 3s during autosave — one warning per failure streak,
   reset as soon as a write succeeds again. */
let _persistFailWarned = false;

export function persist() {
  /* Stamp *when* this device last wrote settings to storage. Used by
     sync.js to decide whether a cloud pull is allowed to overwrite
     local settings (Admin/staff PINs, inventory, named credits, etc).
     Bumped on every persist (not just settings edits) because the
     settings object as currently held in memory is, by definition,
     up to date as of this write — this is a "last confirmed good
     locally" heartbeat, not a per-field dirty flag. */
  db.settings._updatedAt = Date.now();
  const ok = repoPersist();
  if(!ok) {
    if(!_persistFailWarned) {
      _persistFailWarned = true;
      alert('⚠️ Could not save to this device\'s storage — it may be full, or you may be in private/incognito browsing. Your last change may not be saved locally. Free up space or leave private browsing, then try saving again.');
    }
  } else {
    _persistFailWarned = false; /* a future failure will warn again */
  }
  scheduleSyncPush(0); /* immediate push on every explicit save */
}

/* Stop the debounced auto-draft (e.g. when leaving the ledger).
   Exposed so other floors don't have to reach into Actions'
   private _draftReady/_draftTimer variables directly. */
export function stopAutoDraft() {
  _draftReady = false;
  clearTimeout(_draftTimer);
}

export function saveDraft() {
  if(!session.activeKey) return;
  calc();
  const rec = buildSheetRecord();
  rec.draft  = true;
  rec.locked = false;
  /* Same seq/shiftLabel preservation as saveSheet() above — see its
     comment for why buildSheetRecord() alone can't carry these. */
  const existing = db.sheets[session.activeKey];
  if(existing && typeof existing.seq === 'number') rec.seq = existing.seq;
  if(existing && existing.shiftLabel) rec.shiftLabel = existing.shiftLabel;
  db.sheets[session.activeKey] = rec;
  alCommit('save-draft', session.activeKey, rec);
  persist();
  /* NOTE: session.isSavedSheet stays false for drafts — only a full saveSheet() makes it "real".
     This ensures carry-over fields remain live (not frozen) while drafting. */
  setLockedState(false);
  const status = document.getElementById('pdf-status');
  status.style.display='block'; status.textContent='Draft saved ✓';
  setTimeout(()=>{ status.style.display='none'; }, 1500);
}

export function deleteCurrentSheet() {
  if(!session.activeKey) return;
  if(!db.sheets[session.activeKey]) { alert("This closing hasn't been saved yet — nothing to delete."); return; }
  const parts = session.activeKey.split('_');
  if(!confirm(`Delete saved record for ${parts[0]} — ${srLabel(parts[1])}?\nThis cannot be undone.`)) return;
  alLog('delete', session.activeKey);
  delete db.sheets[session.activeKey];
  persist();
  goToDashboard();
}


export function deleteSheet(key) {
  if(!db.sheets[key]) return;
  const parts = key.split('_');
  const sr = srLabel(parts[1]);
  const pin = prompt(`Enter PIN to delete ${parts[0]} — ${sr}:`);
  if(!checkPin(pin)) { alert('Incorrect PIN.'); return; }
  if(!confirm(`Delete saved record for ${parts[0]} — ${sr}?\nThis cannot be undone.`)) return;
  alLog('delete', key);
  delete db.sheets[key];
  persist();
  if(session.activeKey === key) { session.activeKey = null; goToDashboard(); }
  else { renderManifest(); buildCalendar(); }
}

/* Change a saved sheet's shift/final profile mode (used when
   re-opening a record for edit with a different mode selected).
   Floor 4 (Components) calls this instead of poking db.sheets
   directly. */
export function setSheetProfileMode(key, mode) {
  if(db.sheets[key] && db.sheets[key].profileMode !== mode) {
    db.sheets[key].profileMode = mode;
    persist();
  }
}

/* ═══════════════════════════════════════════
   SETTINGS — the one door for all db.settings mutations.
   Strips / strip-groups persist immediately on every edit (so a
   change is never lost by navigating away). Named credits, the
   final-every-N cadence, and sub-tiers are staged in memory and
   only committed by settingsCommitAll() (the big "Save Settings"
   button) — this mirrors the original behaviour exactly.
═══════════════════════════════════════════ */

export function settingsSetBookBrandCode(code) {
  db.settings.bookBrandCode = code.trim() || 'FDPP BT';
  persist();
}

/* ── Access PINs (Admin + per-staff) ──────────────────────────
   Whichever PIN a person types elsewhere in the app (checkPin() in
   state.js) is how they're identified for the Activity Log — no
   separate login. These setters just guard against two identities
   sharing one PIN by accident; each returns false (and changes
   nothing) on a collision so the Settings UI can tell the person why
   it didn't take, instead of silently corrupting who a PIN belongs to. */
export function settingsSetAdminPin(newPin) {
  const clean = (newPin || '').trim();
  if(!clean) return false;
  if(db.settings.staff.some(s => s.pin === clean)) return false; /* collides with a staff PIN */
  db.settings.adminPin = clean;
  persist();
  return true;
}

export function settingsAddStaff() {
  db.settings.staff.push({name:"New Staff", pin:""});
  persist();
}
export function settingsRemoveStaff(i) {
  db.settings.staff.splice(i,1);
  persist();
}
export function settingsSetStaffName(i, name) {
  if(!db.settings.staff[i]) return;
  db.settings.staff[i].name = (name || '').trim() || 'New Staff';
  persist();
}
export function settingsSetStaffPin(i, pin) {
  if(!db.settings.staff[i]) return false;
  const clean = (pin || '').trim();
  if(clean && isPinTaken(clean, i)) return false; /* collides with Admin PIN or another staff member */
  db.settings.staff[i].pin = clean;
  persist();
  return true;
}

export function settingsAddNamedCredit()          { db.settings.namedCredits.push({label:"New Account"}); }
export function settingsRemoveNamedCredit(i)      { db.settings.namedCredits.splice(i,1); }
export function settingsSetNamedCreditLabel(i, v) { if(db.settings.namedCredits[i]) db.settings.namedCredits[i].label = v; }

export function settingsAddStrip() {
  db.settings.strips.push({name:"New Item",price:0,group:""});
  persist();
}
export function settingsRemoveStrip(i) {
  db.settings.strips.splice(i,1);
  persist();
}
export function settingsSetStripField(i, field, value) {
  if(db.settings.strips[i]) { db.settings.strips[i][field] = value; persist(); }
}

export function settingsAddStripGroup() {
  db.settings.stripGroups.push("New Group");
  persist();
}
export function settingsRenameStripGroup(i, newName) {
  const oldName = db.settings.stripGroups[i];
  db.settings.stripGroups[i] = newName;
  /* keep items pointed at the renamed group */
  db.settings.strips.forEach(item => { if(item.group === oldName) item.group = newName; });
  persist();
}
export function settingsRemoveStripGroup(i) {
  const name = db.settings.stripGroups[i];
  db.settings.stripGroups.splice(i, 1);
  /* items in the removed group fall back to Ungrouped, not deleted */
  db.settings.strips.forEach(item => { if(item.group === name) item.group = ""; });
  persist();
}

/* Commits the staged fields (finalEveryN, named-credit labels,
   sub-tiers) that pages.js's Save Settings button reads from the
   DOM, then persists once. */
export function settingsCommitAll(finalEveryN, namedCreditLabels, subTiersData) {
  db.settings.finalEveryN = finalEveryN;
  namedCreditLabels.forEach((label, i) => {
    if(db.settings.namedCredits[i]) db.settings.namedCredits[i].label = label;
  });
  subTiersData.forEach((t, i) => { db.settings.subTiers[i] = t; });
  persist();
}

/* ═══════════════════════════════════════════
   DATA RETENTION
   Nothing is deleted automatically — this only runs when the
   person explicitly clicks the button and confirms with PIN,
   same safety level as deleteSheet(). Queries (staleRecordKeys,
   countRecordsOlderThan) live in ledger-engine.js; this is the
   one function that actually deletes.
═══════════════════════════════════════════ */

export function settingsSetRetentionMonths(months) {
  db.settings.retentionMonths = Math.max(1, parseInt(months) || 6);
  persist();
}

export function archiveOldRecords() {
  const months = db.settings.retentionMonths || 6;
  const staleKeys = staleRecordKeys(months);

  if(!staleKeys.length) { alert(`No records older than ${months} months.`); return; }

  if(!confirm(`This will permanently delete ${staleKeys.length} record(s) older than ${months} months.\nExport a backup first (Settings → Data Backup) if you want to keep them. Continue?`)) return;
  const pin = prompt('Enter PIN to confirm deletion:');
  if(!checkPin(pin)) { alert('Incorrect PIN.'); return; }

  staleKeys.forEach(key => { alLog('archive', key); delete db.sheets[key]; });
  clEnsureArray();
  db.creditLedger = db.creditLedger.filter(s => !staleKeys.includes(s.key));
  /* Misc/Ongoing Ledger needs no separate cleanup — it's derived
     live from db.sheets, so it's already clean now too. */
  persist();

  alert(`Archived ${staleKeys.length} record(s).`);
  if(typeof refreshRetentionStatus === 'function') refreshRetentionStatus();
}

/* ═══════════════════════════════════════════════════════════════
   FLOOR 5 (Extension) — LEDGER NAV
   Sticky jump-nav, progress, focus mode, summary modal.
   This is a UI layer on top of the existing 5-floor architecture.
   It reads totals already computed by calc() (Floor 3) and never
   duplicates business logic — only orchestrates how sections are
   shown/hidden/jumped-to, and gates the final save behind a
   review screen. Never mutates db directly.
═══════════════════════════════════════════════════════════════ */

import { DENOMS, db, escHtml, srLabel, session } from './state.js';
import { calc, saveSheet } from './actions.js';
import { getRealSheet, timelineStep } from './components.js';

/* ── Section registry: id, label, icon, badge element id ──────
   Order matches the real DOM order of cards in the ledger.
   'final-agg' is always the 12th card in every mode — calc()
   computes its values in all modes, not just Final closings. */
const LEDGER_SECTIONS = [
  { key: 'pos',       cardId: 'card-pos',       label: 'POS',      icon: '🧾', badgeId: 'badge-pos' },
  { key: 'shift',     cardId: 'card-shift',     label: 'Shift',    icon: '🔁', badgeId: 'badge-shift' },
  { key: 'hs',        cardId: 'card-hs',        label: 'HS',       icon: '🏠', badgeId: 'badge-hs' },
  { key: 'strips',    cardId: 'card-strips',    label: 'Strips',   icon: '📦', badgeId: 'badge-strips' },
  { key: 'misc',      cardId: 'card-misc',      label: 'Misc',     icon: '🧮', badgeId: 'badge-misc' },
  { key: 'cc',        cardId: 'card-cc',        label: 'Card',     icon: '💳', badgeId: 'badge-cc' },
  { key: 'till',      cardId: 'card-till',      label: 'Till',     icon: '💵', badgeId: 'badge-till' },
  { key: 'vault',     cardId: 'card-vault',     label: 'Vault',    icon: '🏦', badgeId: 'badge-vault' },
  { key: 'credit',    cardId: 'card-credit',    label: 'Credit',   icon: '📒', badgeId: 'badge-credit' },
  { key: 'deposits',  cardId: 'card-deposits',  label: 'Deposit',  icon: '💰', badgeId: 'badge-deposits' },
  { key: 'audit',     cardId: 'card-audit',     label: 'Audit',    icon: '📊', badgeId: null },
  { key: 'final-agg', cardId: 'card-final-agg', label: 'Final',    icon: '🧮', badgeId: null },
];

/* ── State ──────────────────────────────────────────────────── */
const navState = {
  touchedSections: {}, /* { sectionKey: true } once a card has been opened (drives which section focus mode lands on) */
  /* Focus mode is the only mode now — always on. Kept as a body class
     so existing CSS selectors (body.focus-mode ...) keep working unchanged. */
  focusIndex: 0
};

/* ═══════════════════════════════════════════════════════════
   INIT — called once when a ledger sheet opens
═══════════════════════════════════════════════════════════ */
export function initLedgerNav() {
  navState.touchedSections = {};
  navState.focusIndex  = 0;
  document.body.classList.add('focus-mode');
  closeViewAll();

  /* All section cards start collapsed for a calmer first impression;
     applyFocusVisibility() below opens whichever one is current. */
  LEDGER_SECTIONS.forEach(sec => {
    const card = document.getElementById(sec.cardId);
    if (!card) return;
    card.classList.add('collapsed');
  });

  buildSectionNav();
  /* land on the first not-yet-touched section, or section 0 */
  const keys = visibleSectionKeys();
  const firstUntouched = keys.findIndex(k => !navState.touchedSections[k]);
  navState.focusIndex = firstUntouched >= 0 ? firstUntouched : 0;
  applyFocusVisibility();
  updateSectionStatus();
}

/* ═══════════════════════════════════════════════════════════
   BUILD NAV CHIPS
═══════════════════════════════════════════════════════════ */
export function buildSectionNav() {
  const row = document.getElementById('lpb-nav-row');
  if (!row) return;
  const isFinal = (typeof session.activeMode !== 'undefined' && session.activeMode === 'final');

  row.innerHTML = LEDGER_SECTIONS
    .filter(sec => !sec.finalOnly || isFinal)
    .map(sec => `
      <div class="lpb-chip" id="lpb-chip-${sec.key}" onclick="jumpToSection('${sec.key}')">
        <span class="lpb-chip-icon">${sec.icon}</span><span>${sec.label}</span>
      </div>
    `).join('');
}

/* ═══════════════════════════════════════════════════════════
   JUMP TO SECTION — used by both nav chips and focus mode
═══════════════════════════════════════════════════════════ */
export function jumpToSection(key) {
  const sec = LEDGER_SECTIONS.find(s => s.key === key);
  if (!sec) return;
  const card = document.getElementById(sec.cardId);
  if (!card) return;

  const oldIndex = navState.focusIndex;
  const newIndex = visibleSectionKeys().indexOf(key);
  navState.focusIndex = newIndex;
  const direction = newIndex === oldIndex ? 0 : (newIndex > oldIndex ? 1 : -1);
  applyFocusVisibility(direction);

  navState.touchedSections[key] = true;
  updateSectionStatus();
}

export function updateSectionStatus() {
  const isFinal = (typeof session.activeMode !== 'undefined' && session.activeMode === 'final');
  const visible = LEDGER_SECTIONS.filter(sec => !sec.finalOnly || isFinal);

  visible.forEach(sec => {
    const card  = document.getElementById(sec.cardId);
    const chip  = document.getElementById('lpb-chip-' + sec.key);
    if (!card) return;

    const isOpen = !card.classList.contains('collapsed');

    if (chip) {
      /* Only auto-scroll the chip bar when this chip is NEWLY becoming
         current (i.e. the section actually changed). updateSectionStatus()
         is also called from calc() on every keystroke, so re-running
         scrollIntoView unconditionally here was yanking the whole
         sticky-header page back to this chip on every character typed.
         Guarding on the previous state makes it fire only on real navigation. */
      const wasCurrent = chip.classList.contains('lpb-current');
      chip.classList.toggle('lpb-current', isOpen);
      if (isOpen && !wasCurrent) {
        chip.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }
  });

  updateFocusButtons();
  renderPrevShiftSnapshot();
}

/* ═══════════════════════════════════════════════════════════
   FOCUS MODE
═══════════════════════════════════════════════════════════ */
export function visibleSectionKeys() {
  const isFinal = (typeof session.activeMode !== 'undefined' && session.activeMode === 'final');
  return LEDGER_SECTIONS.filter(sec => !sec.finalOnly || isFinal).map(s => s.key);
}

export function applyFocusVisibility(direction = 0) {
  const keys = visibleSectionKeys();
  const targetKey  = keys[navState.focusIndex];
  const targetSec  = LEDGER_SECTIONS.find(s => s.key === targetKey);
  const targetCard = targetSec ? document.getElementById(targetSec.cardId) : null;

  LEDGER_SECTIONS.forEach(sec => {
    if (sec.key === targetKey) return; /* handled separately below */
    const card = document.getElementById(sec.cardId);
    if (!card) return;
    card.classList.add('focus-hidden', 'collapsed');
    card.style.transform = '';
    card.style.opacity   = '';
    card.style.transition = '';
  });

  if (!targetCard) return;

  targetCard.classList.remove('collapsed');

  if (direction !== 0) {
    /* Slide+fade the incoming section in from the swipe/next-button direction. */
    targetCard.classList.remove('focus-hidden');
    targetCard.style.transition = 'none';
    targetCard.style.transform  = `translateX(${direction * 28}px)`;
    targetCard.style.opacity    = '0';
    void targetCard.offsetWidth; /* force reflow so the transition below actually animates */
    targetCard.style.transition = 'transform .32s cubic-bezier(.22,.68,0,1.01), opacity .24s ease-out';
    targetCard.style.transform  = 'translateX(0)';
    targetCard.style.opacity    = '1';
    const cleanup = () => {
      targetCard.style.transition = '';
      targetCard.style.transform  = '';
      targetCard.style.opacity    = '';
      targetCard.removeEventListener('transitionend', cleanup);
    };
    targetCard.addEventListener('transitionend', cleanup);
  } else {
    targetCard.classList.remove('focus-hidden');
  }

  targetCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function focusStep(dir) {
  const keys = visibleSectionKeys();
  navState.touchedSections[keys[navState.focusIndex]] = true;
  navState.focusIndex = Math.max(0, Math.min(keys.length - 1, navState.focusIndex + dir));
  applyFocusVisibility(dir);
  updateSectionStatus();
}

export function updateFocusButtons() {
  const keys = visibleSectionKeys();
  const prevBtn = document.getElementById('focus-btn-prev');
  const nextBtn = document.getElementById('focus-btn-next');
  const saveCloseBtn = document.getElementById('btn-save-close');
  const isLast  = (navState.focusIndex >= keys.length - 1);
  const locked  = (typeof session.isSheetLocked !== 'undefined') && session.isSheetLocked;

  if (prevBtn) prevBtn.disabled = (navState.focusIndex <= 0);

  if (nextBtn) {
    if (isLast) {
      /* Nothing further to step to — the dedicated "Save & Close" button
         below takes over as the way to finish, so Next just steps aside. */
      nextBtn.classList.add('hidden');
      nextBtn.onclick = null;
    } else {
      nextBtn.classList.remove('hidden');
      nextBtn.textContent = 'Next ›';
      nextBtn.onclick = () => focusStep(1);
    }
  }

  /* "Save & Close This Shift" only ever appears once you've reached the
     last section (i.e. the Review Closing Summary step) — never earlier,
     and not once the sheet is already saved & locked. */
  if (saveCloseBtn) {
    saveCloseBtn.classList.toggle('hidden', !isLast || locked);
  }
}

/* ═══════════════════════════════════════════════════════════
   PREVIOUS-SHIFT SNAPSHOT — a read-only, always-visible card
   showing what the previous (real, saved) shift looked like for
   whichever section is currently in focus. Lives in the section
   footer, below "Save as Draft". Never editable, never collapsed.
═══════════════════════════════════════════════════════════ */
export function getPrevRealSheetForSnapshot() {
  if (!session.activeKey || typeof timelineStep !== 'function' || typeof getRealSheet !== 'function') return null;
  const parts = session.activeKey.split('_');
  const prevNode = timelineStep(parts[0], parts[1], -1);
  const rec = getRealSheet(prevNode.key);
  return rec ? { rec, date: prevNode.date, shift: prevNode.shift } : null;
}

/* label + a FULL breakdown per section — mirrors the live section's own
   rows (not just a collapsed total), pulled straight from the fields
   already persisted by buildSheetRecord()/saveSheet(). */
export function snapshotRowsForSection(key, rec) {
  const money = n => 'Rs. ' + (parseFloat(n) || 0).toLocaleString('en-PK');
  const plain = n => (parseFloat(n) || 0).toLocaleString('en-PK');

  switch (key) {
    case 'pos': {
      const totalReturns = (parseFloat(rec.posRet1)||0) + (parseFloat(rec.posRet2)||0) + (parseFloat(rec.posRet3)||0) + (parseFloat(rec.posRetSys)||0);
      return [
        ['System Cash Sales Total', money(rec.inSysCash)],
        ['Last Bill Amount', money(rec.inLastBillAmt)],
        ['Last Bill Number', plain(rec.inLastBillNum)],
        ['Computer Card Sale', money(rec.inCompSale)],
        ['Bank Alfalah Card Machine', money(rec.inAlfalah)],
        ['Keenu Card Machine', money(rec.inKeenu)],
        ['Return 1', money(rec.posRet1)],
        ['Return 2', money(rec.posRet2)],
        ['Return 3', money(rec.posRet3)],
        ['System Return', money(rec.posRetSys)],
        ['Total Returns', money(totalReturns)]
      ];
    }
    case 'shift':
      return [
        ["This Shift's Sales (delta)", money(rec.outShiftSale)],
        ['Book Bill 1', money(rec.inBook1)],
        ['Book Bill 2', money(rec.inBook2)],
        ['Customers This Shift (delta)', plain(rec.outCust)],
        ['Net Sale (this shift)', money(rec.outNetSale)]
      ];
    case 'hs': {
      const rows = (rec.hsRows || []).filter(r => (parseFloat(r.val)||0) !== 0 || (r.lbl||'').trim())
        .map((r, i) => [r.lbl?.trim() || `Row ${i+1}`, money(r.val), !!r.deleted]);
      const total = (rec.hsRows || []).filter(r=>!r.deleted).reduce((a,r)=>a+(parseFloat(r.val)||0),0);
      return rows.concat([['Total HS (A)', money(total)]]);
    }
    case 'strips': {
      const rows = [];
      (rec.stripPrices || []).forEach((p, i) => {
        const q = parseFloat(rec.stripQtys?.[i]) || 0;
        const price = parseFloat(p) || 0;
        if (q === 0) return; // keep the snapshot to what actually moved that shift
        const name = db.settings.strips[i]?.name || `Item ${i+1}`;
        rows.push([name, `${q} × ${money(price)} = ${money(q*price)}`]);
      });
      (rec.auxStrips || []).forEach(o => {
        const q = parseFloat(o.q)||0, p = parseFloat(o.p)||0;
        if (q === 0 && p === 0) return;
        rows.push([o.label?.trim() || 'Extra item', `${q} × ${money(p)} = ${money(q*p)}`, !!o.deleted]);
      });
      const total = (rec.stripPrices||[]).reduce((a,p,i)=>a+(parseFloat(p)||0)*(parseFloat(rec.stripQtys?.[i])||0),0)
        + (rec.auxStrips||[]).filter(o=>!o.deleted).reduce((a,o)=>a+(parseFloat(o.p)||0)*(parseFloat(o.q)||0),0);
      if (!rows.length) rows.push(['No items sold that shift', '']);
      return rows.concat([['Total Inventory Revenue (B)', money(total)]]);
    }
    case 'misc': {
      const rows = (rec.miscRows||[]).filter(r=>(parseFloat(r.val)||0)!==0 || (r.label||'').trim())
        .map(r => [r.label?.trim() || 'Item', money(r.val), !!r.deleted]);
      const total = (rec.miscRows||[]).filter(r=>!r.deleted).reduce((a,r)=>a+(parseFloat(r.val)||0),0);
      return rows.concat([['Total Misc (C)', money(total)]]);
    }
    case 'cc':
      return [
        ['Carried CC from Previous', money(rec.outPrevCC)],
        ['Card Sales This Shift (D)', money(rec.outCurrCC)]
      ];
    case 'till': case 'vault': {
      const vals = key === 'till' ? rec.tillValues : rec.vaultValues;
      const rows = DENOMS.map((d, i) => {
        const qty = parseFloat(vals?.[i]) || 0;
        return qty !== 0 ? [d.label, `${qty} × ${money(d.mult)} = ${money(qty*d.mult)}`] : null;
      }).filter(Boolean);
      const total = DENOMS.reduce((a,d,i)=>a+(parseFloat(vals?.[i])||0)*d.mult, 0);
      if (!rows.length) rows.push(['No cash counted that shift', '']);
      return rows.concat([[key==='till' ? 'Total Till Cash (E)' : 'Total Draw Cash (F)', money(total)]]);
    }
    case 'credit': {
      const rows = [
        ['Carried Debt from Previous Shift', money(rec.outPrevCredit)],
        ['Credit Adjustment', money(rec.creditAdj)]
      ];
      (rec.namedCredits||[]).filter(o=>(parseFloat(o.val)||0)!==0).forEach(o => {
        rows.push([o.lbl + (o.desc ? ` — ${o.desc}` : ''), money(o.val)]);
      });
      (rec.tierCredits||[]).filter(o=>(parseFloat(o.val)||0)!==0 && o.name).forEach(o => {
        rows.push([o.name, money(o.val)]);
      });
      (rec.auxCredits||[]).filter(o=>(parseFloat(o.val)||0)!==0).forEach(o => {
        rows.push([o.lbl?.trim() || 'Aux entry', money(o.val), !!o.deleted]);
      });
      rows.push(['Total Credit Detail (G)', money(rec.outTotalE)]);
      return rows;
    }
    case 'deposits': {
      const rows = [['Carried Deposits from Previous', money(rec.outPrevDep)]];
      (rec.deposits||[]).filter(o=>(parseFloat(o.val)||0)!==0).forEach(o => {
        rows.push([o.lbl?.trim() || 'Deposit', money(o.val), !!o.deleted]);
      });
      rows.push(['Total Cash Deposits (H)', money(rec.outTotalF)]);
      return rows;
    }
    case 'audit':
      return [
        ['Net Cash Available', money(rec.outTotalCash)],
        ["Less: Previous Shift's Cash Position", money(rec.outPrevCash)],
        ['Net Committed Cash (this shift)', money(rec.outNetCash)],
        ['Extra Cash Added to Pharmacy', money(rec.extraCash)]
      ];
    case 'final-agg':
      return rec.profileMode === 'final' ? [
        ['Net Final Sale', money(rec.finalNetSale)],
        ['Net Final Cash Available', money(rec.finalNetCash)],
        [rec.finalDiffLabel || 'Variance', money(rec.finalDiff)]
      ] : [];
    default: return [];
  }
}

export function renderPrevShiftSnapshot() {
  const box = document.getElementById('prev-shift-snapshot');
  if (!box) return;

  const keys = visibleSectionKeys();
  const currentKey = keys[navState.focusIndex];
  const sec = LEDGER_SECTIONS.find(s => s.key === currentKey);
  const prev = getPrevRealSheetForSnapshot();

  if (!prev) {
    box.innerHTML = `<div class="pss-empty">No previous shift on record yet.</div>`;
    return;
  }

  const rows = snapshotRowsForSection(currentKey, prev.rec);
  const shiftLabel = typeof srLabel === 'function' ? srLabel(prev.shift) : prev.shift;
  const rowsHtml = rows.length
    ? rows.map(([label, value, deleted]) => deleted
        ? `<div class="pss-row pss-row-deleted"><span>🚫 ${escHtml(label)} <em>(removed)</em></span><span>${escHtml(value)}</span></div>`
        : `<div class="pss-row"><span>${escHtml(label)}</span><span>${escHtml(value)}</span></div>`).join('')
    : `<div class="pss-row pss-empty-row"><span>No data entered for ${sec ? escHtml(sec.label) : 'this section'} that shift</span></div>`;

  box.innerHTML = `
    <div class="pss-head">📋 Previous shift — ${prev.date} · ${shiftLabel}</div>
    <div class="pss-body">${rowsHtml}</div>`;
}

/* ═══════════════════════════════════════════════════════════
   END-OF-SHIFT SUMMARY MODAL
   Reads values already computed by calc() — never recomputes.
   This intercepts the Save button: saveSheet() only runs after
   the user confirms here.
═══════════════════════════════════════════════════════════ */
export function openSummaryModal() {
  /* Force a fresh calc so banner values are current */
  if (typeof calc === 'function') calc();

  const isFinal = (typeof session.activeMode !== 'undefined' && session.activeMode === 'final');
  const targetLabel = isFinal ? 'Target Net Sales (Final)' : 'Target Net Sales';
  const cashLabel    = isFinal ? 'Net Final Cash Available' : 'Net Cash Available';

  const targetEl = document.getElementById('ban-target');
  const cashEl   = document.getElementById('ban-cash');
  const varEl    = document.getElementById('ban-variance');
  const varLbl   = document.getElementById('ban-variance-label');

  const respName = document.getElementById('sel-responsible-staff')?.value || '';
  document.getElementById('summary-value-responsible').textContent = respName || '— not selected —';
  const respNote = document.getElementById('summary-responsible-note');
  if (respNote) respNote.classList.toggle('hidden', !!respName);

  document.getElementById('summary-label-target').textContent = targetLabel;
  document.getElementById('summary-value-target').textContent = targetEl ? targetEl.textContent : 'Rs. 0';
  document.getElementById('summary-label-cash').textContent   = cashLabel;
  document.getElementById('summary-value-cash').textContent   = cashEl ? cashEl.textContent : 'Rs. 0';

  const varianceText = varEl ? varEl.textContent : 'Rs. 0';
  const varianceLabel = varLbl ? varLbl.textContent : 'Variance';
  const isPos = varEl ? varEl.classList.contains('pos') : true;
  const varianceAmount = parseInt((varianceText || '').replace(/[^\d]/g, ''), 10) || 0;

  document.getElementById('summary-label-variance').textContent = varianceLabel;
  document.getElementById('summary-value-variance').textContent = varianceText;

  const statBox  = document.getElementById('summary-stat-variance');
  const warnRow  = document.getElementById('summary-variance-warn');
  statBox.classList.remove('sv-ok', 'sv-warn', 'sv-bad');
  /* small rounding-level gaps (<= Rs.100) read as fine, not alarming */
  if (varianceAmount === 0) {
    statBox.classList.add('sv-ok');
    warnRow.style.display = 'none';
  } else if (isPos || varianceAmount <= 100) {
    statBox.classList.add('sv-ok');
    warnRow.style.display = 'none';
  } else if (varianceAmount <= 1000) {
    statBox.classList.add('sv-warn');
    warnRow.style.display = 'flex';
  } else {
    statBox.classList.add('sv-bad');
    warnRow.style.display = 'flex';
  }

  const headIcon  = document.getElementById('summary-head-icon');
  const headTitle = document.getElementById('summary-head-title');
  const headSub   = document.getElementById('summary-head-sub');
  headIcon.textContent = '📋';
  headTitle.textContent = 'Review closing';
  const noteBox = document.getElementById('summary-incomplete-note');
  if (noteBox) noteBox.classList.add('hidden');
  headSub.textContent = isFinal ? 'Review final closing before saving' : 'Review before saving';

  document.getElementById('summary-modal-overlay').classList.remove('hidden');
}

export function closeSummaryModal() {
  document.getElementById('summary-modal-overlay').classList.add('hidden');
}

export function confirmSummaryAndSave() {
  /* Hard gate — a closing cannot be finalized without a named
     Responsible Closing Person (see product notes: the person
     typing this in — cashier on mobile or a manager reviewing on
     desktop later — is not necessarily who the shift belongs to,
     so it must always be picked explicitly rather than assumed). */
  const respSel = document.getElementById('sel-responsible-staff');
  if (respSel && !respSel.value) {
    const warn = document.getElementById('responsible-staff-warn');
    if (warn) warn.classList.remove('hidden');
    const note = document.getElementById('summary-responsible-note');
    if (note) note.classList.remove('hidden');
    alert('⛔ Please select the Responsible Closing Person before saving this shift.');
    respSel.focus();
    return; /* modal stays open so they can pick and re-confirm */
  }
  closeSummaryModal();
  if (typeof saveSheet === 'function') saveSheet();
}

/* ═══════════════════════════════════════════════════════════
   VIEW ALL — read-only overlay (Option 1: focus stays the only
   real mode; this is a glance, never a second editing path)
═══════════════════════════════════════════════════════════ */
export function openViewAll() {
  const list = document.getElementById('viewall-list');
  const foot = document.getElementById('viewall-foot');
  if (!list) return;

  const keys = visibleSectionKeys();
  const currentKey = keys[navState.focusIndex];

  let runningTotal = 0;
  let countedAny = false;

  list.innerHTML = LEDGER_SECTIONS
    .filter(sec => !sec.finalOnly || (typeof session.activeMode !== 'undefined' && session.activeMode === 'final'))
    .map(sec => {
      const badgeEl   = sec.badgeId ? document.getElementById(sec.badgeId) : null;
      const isCurrent = sec.key === currentKey;
      const rawText   = badgeEl ? badgeEl.textContent.trim() : '';
      const numeric   = rawText ? parseInt(rawText.replace(/[^\d-]/g, ''), 10) : NaN;

      let valueText;
      if (rawText) {
        valueText = rawText;
        if (!isNaN(numeric)) { runningTotal += numeric; countedAny = true; }
      } else {
        valueText = '—';
      }

      return `
        <div class="viewall-row ${isCurrent ? 'va-current' : ''}">
          <span class="va-icon">${sec.icon}</span>
          <span class="va-label">${sec.label}</span>
          <span class="va-value">${valueText}</span>
          ${isCurrent ? '<span class="va-here">← you are here</span>' : ''}
        </div>`;
    }).join('');

  foot.textContent = countedAny ? `Entered so far: Rs. ${runningTotal.toLocaleString()}` : 'Nothing entered yet';

  document.getElementById('viewall-overlay').classList.remove('hidden');
}

export function closeViewAll() {
  const overlay = document.getElementById('viewall-overlay');
  if (overlay) overlay.classList.add('hidden');
}

export function viewAllOutsideClick(e) {
  if (e.target === document.getElementById('viewall-overlay')) closeViewAll();
}

/* ═══════════════════════════════════════════════════════════
   HOOK — called by toggleCard() in components.js whenever any
   card is opened or closed by its own header tap, not just nav,
   so the jump-nav and progress bar always stay in sync.
═══════════════════════════════════════════════════════════ */
export function onCardToggled(cardId) {
  const sec = LEDGER_SECTIONS.find(s => s.cardId === cardId);
  if (sec) {
    navState.touchedSections[sec.key] = true;
    updateSectionStatus();
  }
}

/* ═══════════════════════════════════════════════════════════
   SWIPE GESTURE NAV (mobile) — swipe left/right anywhere on the
   ledger page moves between sections, same as the Next ›/‹ Back
   buttons, with the same slide+fade transition. Bound once at
   boot; scoped to #page-ledger so it only ever fires while a
   closing is open.
═══════════════════════════════════════════════════════════ */
export function initLedgerSwipeNav() {
  const zone = document.getElementById('page-ledger');
  if (!zone || zone.dataset.swipeBound) return;
  zone.dataset.swipeBound = '1';

  const SWIPE_MIN_DIST   = 55;   /* px — minimum horizontal travel to count as a swipe */
  const SWIPE_MAX_ANGLE  = 0.6;  /* |dy/dx| ceiling — keeps mostly-vertical scrolls from triggering nav */
  let startX = 0, startY = 0, tracking = false;

  /* Works anywhere on the card — including on top of number inputs,
     labels, badges, whatever — a short horizontal drag is a swipe,
     a tap is still just a tap (the distance threshold tells them apart). */
  zone.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { tracking = false; return; }
    /* The chip bar (.ledger-progress-bar) has its own native horizontal
       scroll. A drag that starts on it is the user scrolling the chips,
       not swiping between sections — let it scroll natively and don't
       let this listener steal it and jump to another section. */
    if (e.target.closest && e.target.closest('.ledger-progress-bar')) {
      tracking = false;
      return;
    }
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    tracking = true;
  }, { passive: true });

  zone.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (Math.abs(dx) < SWIPE_MIN_DIST) return;
    if (Math.abs(dy) > Math.abs(dx) * SWIPE_MAX_ANGLE) return; /* too vertical — probably a scroll */

    if (dx < 0) {
      /* swipe left → Next */
      const nextBtn = document.getElementById('focus-btn-next');
      if (nextBtn && !nextBtn.disabled) nextBtn.onclick && nextBtn.onclick();
    } else {
      /* swipe right → Back */
      const prevBtn = document.getElementById('focus-btn-prev');
      if (prevBtn && !prevBtn.disabled) focusStep(-1);
    }
  }, { passive: true });
}

/* ═══════════════════════════════════════════════════════════════
   LEDGER NAV — sticky jump-nav, progress, focus mode, summary modal
   This is a UI layer on top of the existing 5-floor architecture.
   It reads totals already computed by calc() (Floor 3) and never
   duplicates business logic — only orchestrates how sections are
   shown/hidden/jumped-to, and gates the final save behind a
   review screen.
═══════════════════════════════════════════════════════════════ */

/* ── Section registry: id, label, icon, badge element id ──────
   Order matches the real DOM order of cards in the ledger.
   'final-agg' only applies in Final mode and is filtered out
   dynamically in buildSectionNav().                              */
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
  { key: 'final-agg', cardId: 'card-final-agg', label: 'Final',    icon: '🧮', badgeId: null, finalOnly: true },
];

/* ── State ──────────────────────────────────────────────────── */
let _touchedSections  = {};   /* { sectionKey: true } once a card has been opened (drives "not yet opened" note only) */
let _sectionComplete   = {};  /* { sectionKey: true } once explicitly confirmed via "Save Section" */
/* Focus mode is the only mode now — always on. Kept as a body class
   so existing CSS selectors (body.focus-mode ...) keep working unchanged. */
let _focusIndex        = 0;

/* ═══════════════════════════════════════════════════════════
   INIT — called once when a ledger sheet opens
═══════════════════════════════════════════════════════════ */
function initLedgerNav() {
  _touchedSections = {};
  _focusIndex  = 0;
  document.body.classList.add('focus-mode');
  closeViewAll();

  /* ── Restore / default section-complete state ──────────────
     - Sheet has explicit sectionComplete data → use it as-is.
     - Sheet exists but predates this feature → treat every section
       as already complete (it was saved under the old rules; it
       shouldn't retroactively look unfinished).
     - No saved sheet at all (new/unsaved) → everything starts blank. */
  const savedRecord = (typeof db !== 'undefined' && typeof activeKey !== 'undefined') ? db.sheets[activeKey] : null;
  _sectionComplete = {};
  if (savedRecord && savedRecord.sectionComplete) {
    _sectionComplete = { ...savedRecord.sectionComplete };
  } else if (savedRecord) {
    LEDGER_SECTIONS.forEach(sec => { _sectionComplete[sec.key] = true; });
  }

  /* All section cards start collapsed for a calmer first impression;
     applyFocusVisibility() below opens whichever one is current. */
  LEDGER_SECTIONS.forEach(sec => {
    const card = document.getElementById(sec.cardId);
    if (!card) return;
    card.classList.add('collapsed');
    /* Editing a Complete section un-confirms it — property assignment
       (not addEventListener) so re-running initLedgerNav() never stacks
       duplicate handlers on the same card. */
    card.oninput  = () => demoteIfEdited(sec.key);
    card.onchange = () => demoteIfEdited(sec.key);
  });

  buildSectionNav();
  /* land on the first not-yet-touched section, or section 0 */
  const keys = visibleSectionKeys();
  const firstUntouched = keys.findIndex(k => !_touchedSections[k]);
  _focusIndex = firstUntouched >= 0 ? firstUntouched : 0;
  applyFocusVisibility();
  updateSectionStatus();
}

/* ═══════════════════════════════════════════════════════════
   BUILD NAV CHIPS
═══════════════════════════════════════════════════════════ */
function buildSectionNav() {
  const row = document.getElementById('lpb-nav-row');
  if (!row) return;
  const isFinal = (typeof activeMode !== 'undefined' && activeMode === 'final');

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
function jumpToSection(key) {
  const sec = LEDGER_SECTIONS.find(s => s.key === key);
  if (!sec) return;
  const card = document.getElementById(sec.cardId);
  if (!card) return;

  _focusIndex = visibleSectionKeys().indexOf(key);
  applyFocusVisibility();

  _touchedSections[key] = true;
  updateSectionStatus();
}

/* ═══════════════════════════════════════════════════════════
   SECTION STATE — the single source of truth for a section's color.
   white:    never confirmed, no data entered
   pending:  has some data entered, but not (re-)confirmed since
   complete: explicitly confirmed via "Save Section" with current data
   alert:    a real flagged condition exists — overrides all of the above
   Called from calc() every time totals change (via updateSectionStatus).
═══════════════════════════════════════════════════════════ */
function getSectionState(key) {
  if (sectionHasAlert(key)) return 'alert';
  if (_sectionComplete[key]) return 'complete';
  if (sectionHasData(key))   return 'pending';
  return 'white';
}

/* Generic "has this section been typed into" heuristic — looks at every
   editable field in the card and checks it against its untouched default
   (blank, or the "0" that inputs like Returns/Extra Cash start at, or the
   placeholder option in a dropdown). This never blocks or requires
   anything; it only decides which "not yet confirmed" color to show. */
function sectionHasData(key) {
  const sec = LEDGER_SECTIONS.find(s => s.key === key);
  if (!sec) return false;
  const card = document.getElementById(sec.cardId);
  if (!card) return false;
  const fields = card.querySelectorAll('input:not([readonly]), select, textarea');
  for (const el of fields) {
    if (el.tagName === 'SELECT') {
      if (el.selectedIndex > 0) return true;
      continue;
    }
    const v = (el.value || '').toString().trim();
    if (v === '' || v === '0' || v === '0.00') continue;
    return true;
  }
  return false;
}

/* Editing a Complete section un-confirms it automatically — the user's
   own words: "editing IS the un-save." Where it lands next (pending vs
   white) is recomputed live by getSectionState(), not stored here. */
function demoteIfEdited(key) {
  if (_sectionComplete[key]) {
    _sectionComplete[key] = false;
    updateSectionStatus();
  }
}

/* "Save Section" — the one explicit action that resolves the ambiguity
   between "blank because nothing happened" and "blank because forgotten." */
function saveSectionComplete(key) {
  if (sectionHasAlert(key)) {
    if (!confirm('This section has an unconfirmed item. Save anyway?')) return;
  }
  _sectionComplete[key] = true;
  updateSectionStatus();
  const status = document.getElementById('pdf-status');
  if (status) {
    status.style.display = 'block';
    status.textContent = 'Section saved ✓';
    setTimeout(() => { status.style.display = 'none'; }, 1200);
  }
}

function updateSectionStatus() {
  const isFinal = (typeof activeMode !== 'undefined' && activeMode === 'final');
  const visible = LEDGER_SECTIONS.filter(sec => !sec.finalOnly || isFinal);

  let doneCount = 0;

  visible.forEach(sec => {
    const card  = document.getElementById(sec.cardId);
    const chip  = document.getElementById('lpb-chip-' + sec.key);
    if (!card) return;

    const isOpen = !card.classList.contains('collapsed');
    const state  = getSectionState(sec.key);

    if (state === 'complete') doneCount++;

    card.classList.remove('cs-white', 'cs-pending', 'cs-complete', 'cs-alert');
    card.classList.add('cs-' + state);

    if (chip) {
      chip.classList.remove('lpb-white', 'lpb-pending', 'lpb-done', 'lpb-alert', 'lpb-current');
      chip.classList.add(state === 'complete' ? 'lpb-done' : 'lpb-' + state);
      const isCurrentChip = isOpen;
      chip.classList.toggle('lpb-current', isCurrentChip);
      if (isCurrentChip) {
        chip.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }
  });

  const total = visible.length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;
  const fill = document.getElementById('lpb-progress-fill');
  const text = document.getElementById('lpb-progress-text');
  if (fill) fill.style.width = pct + '%';
  if (text) text.textContent = doneCount + ' of ' + total + ' complete';

  updateFocusButtons();
}

/* Section-level alert check — currently only Misc unconfirmed items.
   Extend here if other sections need their own warning condition.   */
function sectionHasAlert(key) {
  if (key === 'misc') {
    const rows = document.querySelectorAll('#ledger-misc select[id^="misc-st-"]');
    let unconfirmed = 0;
    rows.forEach(sel => { if (sel.value === 'Active') unconfirmed++; });
    return unconfirmed > 0;
  }
  return false;
}

/* ═══════════════════════════════════════════════════════════
   FOCUS MODE
═══════════════════════════════════════════════════════════ */
function visibleSectionKeys() {
  const isFinal = (typeof activeMode !== 'undefined' && activeMode === 'final');
  return LEDGER_SECTIONS.filter(sec => !sec.finalOnly || isFinal).map(s => s.key);
}

function applyFocusVisibility() {
  const keys = visibleSectionKeys();
  LEDGER_SECTIONS.forEach(sec => {
    const card = document.getElementById(sec.cardId);
    if (!card) return;
    const isCurrent = keys[_focusIndex] === sec.key;
    card.classList.toggle('focus-hidden', !isCurrent);
    /* Only the current section should ever read as "open" — collapse
       every other section so isOpen (and therefore the nav chip's
       "current" highlight) reflects exactly one section at a time. */
    card.classList.toggle('collapsed', !isCurrent);
  });
  const currentCard = document.getElementById(
    LEDGER_SECTIONS.find(s => s.key === keys[_focusIndex])?.cardId
  );
  if (currentCard) currentCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function focusStep(dir) {
  const keys = visibleSectionKeys();
  _touchedSections[keys[_focusIndex]] = true;
  _focusIndex = Math.max(0, Math.min(keys.length - 1, _focusIndex + dir));
  applyFocusVisibility();
  updateSectionStatus();
}

function updateFocusButtons() {
  const keys = visibleSectionKeys();
  const currentKey = keys[_focusIndex];
  const prevBtn = document.getElementById('focus-btn-prev');
  const nextBtn = document.getElementById('focus-btn-next');
  const saveBtn = document.getElementById('focus-btn-save');
  if (prevBtn) prevBtn.disabled = (_focusIndex <= 0);
  if (nextBtn) {
    const isLast = (_focusIndex >= keys.length - 1);
    nextBtn.textContent = isLast ? 'Review & Save ✓' : 'Next ›';
    nextBtn.onclick = isLast
      ? () => { _touchedSections[currentKey] = true; updateSectionStatus(); openSummaryModal(); }
      : () => focusStep(1);
  }
  if (saveBtn) {
    const isComplete = _sectionComplete[currentKey];
    saveBtn.textContent = isComplete ? '✓ Saved' : '✓ Save Section';
    saveBtn.classList.toggle('fb-saved', !!isComplete);
    saveBtn.onclick = () => saveSectionComplete(currentKey);
  }
}

/* ═══════════════════════════════════════════════════════════
   END-OF-SHIFT SUMMARY MODAL
   Reads values already computed by calc() — never recomputes.
   This intercepts the Save button: saveSheet() only runs after
   the user confirms here.
═══════════════════════════════════════════════════════════ */
function openSummaryModal() {
  /* Force a fresh calc so banner values are current */
  if (typeof calc === 'function') calc();

  const isFinal = (typeof activeMode !== 'undefined' && activeMode === 'final');
  const targetLabel = isFinal ? 'Target Net Sales (Final)' : 'Target Net Sales';
  const cashLabel    = isFinal ? 'Net Final Cash Available' : 'Net Cash Available';

  const targetEl = document.getElementById('ban-target');
  const cashEl   = document.getElementById('ban-cash');
  const varEl    = document.getElementById('ban-variance');
  const varLbl   = document.getElementById('ban-variance-label');

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

  /* Section completion breakdown */
  const keys = visibleSectionKeys();
  const untouched = keys.filter(k => getSectionState(k) === 'white');
  const pending   = keys.filter(k => getSectionState(k) === 'pending');
  const completeCount = keys.filter(k => getSectionState(k) === 'complete').length;
  const noteBox = document.getElementById('summary-incomplete-note');
  if (untouched.length > 0 || pending.length > 0) {
    const parts = [];
    if (pending.length)   parts.push(`entered but not saved: ${pending.map(k => LEDGER_SECTIONS.find(s => s.key === k)?.label).join(', ')}`);
    if (untouched.length) parts.push(`not yet opened: ${untouched.map(k => LEDGER_SECTIONS.find(s => s.key === k)?.label).join(', ')}`);
    document.getElementById('summary-incomplete-text').textContent =
      `${parts.join(' · ')}. You can still save, but double-check these first.`;
    noteBox.classList.remove('hidden');
  } else {
    noteBox.classList.add('hidden');
  }

  const headIcon  = document.getElementById('summary-head-icon');
  const headTitle = document.getElementById('summary-head-title');
  const headSub   = document.getElementById('summary-head-sub');
  if (untouched.length > 0 || pending.length > 0) {
    headIcon.textContent = '📋';
    headTitle.textContent = completeCount + ' of ' + keys.length + ' sections confirmed complete';
  } else {
    headIcon.textContent = '✅';
    headTitle.textContent = 'All sections complete';
  }
  headSub.textContent = isFinal ? 'Review final closing before saving' : 'Review before saving';

  document.getElementById('summary-modal-overlay').classList.remove('hidden');
}

function closeSummaryModal() {
  document.getElementById('summary-modal-overlay').classList.add('hidden');
}

function confirmSummaryAndSave() {
  closeSummaryModal();
  if (typeof saveSheet === 'function') saveSheet();
}

/* ═══════════════════════════════════════════════════════════
   VIEW ALL — read-only overlay (Option 1: focus stays the only
   real mode; this is a glance, never a second editing path)
═══════════════════════════════════════════════════════════ */
function openViewAll() {
  const list = document.getElementById('viewall-list');
  const foot = document.getElementById('viewall-foot');
  if (!list) return;

  const keys = visibleSectionKeys();
  const currentKey = keys[_focusIndex];

  let runningTotal = 0;
  let countedAny = false;

  list.innerHTML = LEDGER_SECTIONS
    .filter(sec => !sec.finalOnly || (typeof activeMode !== 'undefined' && activeMode === 'final'))
    .map(sec => {
      const badgeEl   = sec.badgeId ? document.getElementById(sec.badgeId) : null;
      const state     = getSectionState(sec.key);
      const isCurrent = sec.key === currentKey;
      const rawText   = badgeEl ? badgeEl.textContent.trim() : '';
      const numeric   = rawText ? parseInt(rawText.replace(/[^\d-]/g, ''), 10) : NaN;

      let valueText;
      if (state === 'alert') {
        valueText = '⚠ Needs attention';
      } else if (state === 'white') {
        valueText = '—';
      } else if (rawText) {
        valueText = rawText + (state === 'pending' ? ' (unsaved)' : '');
        if (!isNaN(numeric)) { runningTotal += numeric; countedAny = true; }
      } else {
        valueText = state === 'complete' ? '✓' : '… (unsaved)';
      }

      return `
        <div class="viewall-row va-${state} ${isCurrent ? 'va-current' : ''}">
          <span class="va-icon">${sec.icon}</span>
          <span class="va-label">${sec.label}</span>
          <span class="va-value">${valueText}</span>
          ${isCurrent ? '<span class="va-here">← you are here</span>' : ''}
        </div>`;
    }).join('');

  foot.textContent = countedAny ? `Entered so far: Rs. ${runningTotal.toLocaleString()}` : 'Nothing entered yet';

  document.getElementById('viewall-overlay').classList.remove('hidden');
}

function closeViewAll() {
  const overlay = document.getElementById('viewall-overlay');
  if (overlay) overlay.classList.add('hidden');
}

function viewAllOutsideClick(e) {
  if (e.target === document.getElementById('viewall-overlay')) closeViewAll();
}

/* ═══════════════════════════════════════════════════════════
   HOOK — called by toggleCard() in components.js whenever any
   card is opened or closed by its own header tap, not just nav,
   so the jump-nav and progress bar always stay in sync.
═══════════════════════════════════════════════════════════ */
function onCardToggled(cardId) {
  const sec = LEDGER_SECTIONS.find(s => s.cardId === cardId);
  if (sec) {
    _touchedSections[sec.key] = true;
    updateSectionStatus();
  }
}

/* ═══════════════════════════════════════════════════════════
   SWIPE GESTURE NAV (mobile) — swipe left/right on the ledger
   page moves between sections, same as the Next ›/‹ Back
   buttons. Bound once at boot; scoped to #page-ledger so it
   only ever fires while a closing is open.
═══════════════════════════════════════════════════════════ */
function initLedgerSwipeNav() {
  const zone = document.getElementById('page-ledger');
  if (!zone || zone.dataset.swipeBound) return;
  zone.dataset.swipeBound = '1';

  const SWIPE_MIN_DIST   = 55;   /* px — minimum horizontal travel to count as a swipe */
  const SWIPE_MAX_ANGLE  = 0.6;  /* |dy/dx| ceiling — keeps mostly-vertical scrolls from triggering nav */
  let startX = 0, startY = 0, tracking = false;

  zone.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { tracking = false; return; }
    /* Don't hijack drags that start on a text input, select, or button —
       let native controls behave normally. */
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'select', 'textarea', 'button'].includes(tag)) { tracking = false; return; }
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

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
let _touchedSections  = {};   /* { sectionKey: true } once a card has been opened (drives which section focus mode lands on) */
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

  const oldIndex = _focusIndex;
  const newIndex = visibleSectionKeys().indexOf(key);
  _focusIndex = newIndex;
  const direction = newIndex === oldIndex ? 0 : (newIndex > oldIndex ? 1 : -1);
  applyFocusVisibility(direction);

  _touchedSections[key] = true;
  updateSectionStatus();
}

function updateSectionStatus() {
  const isFinal = (typeof activeMode !== 'undefined' && activeMode === 'final');
  const visible = LEDGER_SECTIONS.filter(sec => !sec.finalOnly || isFinal);

  visible.forEach(sec => {
    const card  = document.getElementById(sec.cardId);
    const chip  = document.getElementById('lpb-chip-' + sec.key);
    if (!card) return;

    const isOpen = !card.classList.contains('collapsed');

    if (chip) {
      chip.classList.toggle('lpb-current', isOpen);
      if (isOpen) {
        chip.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }
  });

  updateFocusButtons();
}

/* ═══════════════════════════════════════════════════════════
   FOCUS MODE
═══════════════════════════════════════════════════════════ */
function visibleSectionKeys() {
  const isFinal = (typeof activeMode !== 'undefined' && activeMode === 'final');
  return LEDGER_SECTIONS.filter(sec => !sec.finalOnly || isFinal).map(s => s.key);
}

function applyFocusVisibility(direction = 0) {
  const keys = visibleSectionKeys();
  const targetKey  = keys[_focusIndex];
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

function focusStep(dir) {
  const keys = visibleSectionKeys();
  _touchedSections[keys[_focusIndex]] = true;
  _focusIndex = Math.max(0, Math.min(keys.length - 1, _focusIndex + dir));
  applyFocusVisibility(dir);
  updateSectionStatus();
}

function updateFocusButtons() {
  const keys = visibleSectionKeys();
  const currentKey = keys[_focusIndex];
  const prevBtn = document.getElementById('focus-btn-prev');
  const nextBtn = document.getElementById('focus-btn-next');
  if (prevBtn) prevBtn.disabled = (_focusIndex <= 0);
  if (nextBtn) {
    const isLast = (_focusIndex >= keys.length - 1);
    nextBtn.textContent = isLast ? 'Review & Save ✓' : 'Next ›';
    nextBtn.onclick = isLast
      ? () => { _touchedSections[currentKey] = true; updateSectionStatus(); openSummaryModal(); }
      : () => focusStep(1);
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
   SWIPE GESTURE NAV (mobile) — swipe left/right anywhere on the
   ledger page moves between sections, same as the Next ›/‹ Back
   buttons, with the same slide+fade transition. Bound once at
   boot; scoped to #page-ledger so it only ever fires while a
   closing is open.
═══════════════════════════════════════════════════════════ */
function initLedgerSwipeNav() {
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

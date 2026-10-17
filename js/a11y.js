/* ═══════════════════════════════════════════════════════════════
   A11Y — fills accessibility gaps in a UI that is largely built from
   inline onclick attributes and JS-generated rows.

   index.html has ~160 onclick handlers on plain <div>/<span> elements
   and many icon-only buttons; rather than hand-editing every one (and
   missing the ones components.js/pages.js create later), this module
   adds what's missing, now and as the DOM changes:

     • an accessible name for icon-only buttons (from title, else a
       known glyph name)
     • role="button" + tabindex + Enter/Space for clickable non-buttons
     • an accessible name for unlabeled inputs and selects
     • role="dialog" + aria-modal for modal overlays
     • role="alert"/"status" for inline error and status text

   It never overwrites an attribute that is already set. Does nothing
   at import time, so it is safe under the Node test stub.
═══════════════════════════════════════════════════════════════ */

const GLYPH_NAMES = {
  '✕': 'Close', '✖': 'Close', '×': 'Close', '✗': 'Close',
  '←': 'Back', '‹': 'Back', '◀': 'Previous', '▶': 'Next', '›': 'Next',
  '⋮': 'More options', '⋯': 'More options',
  '＋': 'Add', '+': 'Add', '−': 'Remove', '-': 'Remove',
  '▼': 'Expand or collapse', '▲': 'Expand or collapse',
  '⟳': 'Refresh', '↻': 'Refresh'
};

const NATIVE_INTERACTIVE = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY', 'LABEL', 'OPTION']);

const hasWords = (s) => /[\p{L}\p{N}]/u.test(s || '');

/* Overlays dismiss on a backdrop click; that onclick is not a control. */
function isBackdrop(node) {
  const sig = `${node.id || ''} ${node.className && node.className.baseVal === undefined ? node.className : ''}`.toLowerCase();
  return /overlay|backdrop/.test(sig) || node.getAttribute('role') === 'dialog';
}

function buttonName(btn) {
  const aria = btn.getAttribute('aria-label') || btn.getAttribute('aria-labelledby');
  if(aria) return aria;
  if(hasWords(btn.textContent)) return btn.textContent.trim();
  return '';
}

function nameForControl(ctl) {
  if(ctl.getAttribute('aria-label') || ctl.getAttribute('aria-labelledby')) return true;
  if(ctl.labels && ctl.labels.length) return true;
  if(ctl.closest && ctl.closest('label')) return true;
  if(ctl.getAttribute('title')) return true;
  return false;
}

function guessControlLabel(ctl) {
  if(ctl.placeholder) return ctl.placeholder;
  if(ctl.classList && ctl.classList.contains('lbl-input')) return 'Row name';
  const scope = ctl.closest ? ctl.closest('.row, .form-field, .misc-row, .mediq-row, tr') : null;
  if(scope) {
    const lbl = scope.querySelector('label, .lbl, .cl-lbl, .row-label');
    if(lbl && lbl !== ctl && hasWords(lbl.textContent)) return lbl.textContent.replace(/[:：]\s*$/, '').trim();
  }
  const prev = ctl.previousElementSibling;
  if(prev && hasWords(prev.textContent) && prev.textContent.length < 60) return prev.textContent.replace(/[:：]\s*$/, '').trim();
  return '';
}

let _uid = 0;

export function enhanceA11y(root) {
  const scope = root || (typeof document !== 'undefined' ? document : null);
  if(!scope || typeof scope.querySelectorAll !== 'function') return;

  /* 1 — icon-only buttons */
  scope.querySelectorAll('button, [role="button"]').forEach(btn => {
    if(buttonName(btn)) return;
    const title = btn.getAttribute('title');
    const glyph = GLYPH_NAMES[(btn.textContent || '').trim()];
    const label = title || glyph;
    if(label) btn.setAttribute('aria-label', label);
  });

  /* 2 — clickable non-buttons → real keyboard-operable buttons */
  scope.querySelectorAll('[onclick]').forEach(node => {
    if(NATIVE_INTERACTIVE.has(node.tagName)) return;
    if(node.hasAttribute('role') || node.hasAttribute('tabindex')) return;
    if(isBackdrop(node)) return;
    /* Empty placeholders that script fills in later have nothing to announce yet;
       the observer promotes them once they have text, a title or an aria-label. */
    if(!hasWords(node.textContent) && !node.getAttribute('aria-label') && !node.getAttribute('title')) return;
    /* Ledger section headers are a deliberate no-op in focus mode — don't advertise them as controls. */
    if(node.matches && node.matches('.ledger-section > .card-head')) return;
    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
    node.setAttribute('data-a11y-click', '1');
  });

  /* 3 — unlabeled form controls */
  scope.querySelectorAll('input, select, textarea').forEach(ctl => {
    const type = (ctl.getAttribute('type') || '').toLowerCase();
    if(type === 'hidden' || type === 'button' || type === 'submit') return;
    if(nameForControl(ctl)) return;
    const label = guessControlLabel(ctl);
    if(label) ctl.setAttribute('aria-label', label);
  });

  /* 4 — modal overlays */
  scope.querySelectorAll('[id$="-overlay"]').forEach(ov => {
    if(ov.hasAttribute('role')) return;
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    const heading = ov.querySelector('h1, h2, h3, h4');
    if(heading && hasWords(heading.textContent)) {
      if(!heading.id) heading.id = `a11y-h-${++_uid}`;
      ov.setAttribute('aria-labelledby', heading.id);
    } else if(!ov.hasAttribute('aria-label')) {
      ov.setAttribute('aria-label', 'Dialog');
    }
  });

  /* 5 — inline messages that appear/disappear */
  [['#auth-error', 'alert'], ['#responsible-staff-warn', 'status'], ['#pdf-status', 'status'], ['.edit-modal-err', 'alert']]
    .forEach(([sel, role]) => {
      scope.querySelectorAll(sel).forEach(n => { if(!n.hasAttribute('role')) n.setAttribute('role', role); });
    });
}

/* Enter / Space activate anything enhanceA11y() turned into a button. */
function onKeydown(e) {
  if(e.key !== 'Enter' && e.key !== ' ') return;
  const t = e.target;
  if(!t || !t.getAttribute || t.getAttribute('data-a11y-click') !== '1') return;
  e.preventDefault();
  t.click();
}

export function initA11y() {
  if(typeof document === 'undefined' || !document.body || typeof document.body.querySelectorAll !== 'function') return;
  enhanceA11y(document);
  document.addEventListener('keydown', onKeydown);

  if(typeof MutationObserver === 'undefined') return;
  let pending = false;
  new MutationObserver(() => {
    if(pending) return;
    pending = true;
    setTimeout(() => { pending = false; enhanceA11y(document); }, 80);
  }).observe(document.body, { childList: true, subtree: true });
}

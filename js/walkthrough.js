/* ═══════════════════════════════════════════════════════════════
   WALKTHROUGH — short first-run intro to the ledger sections
   Shown once per signed-in staff member (or once per device when
   nobody is signed in) the first time they open an editable sheet,
   and re-openable any time from the ledger's ⋮ menu → "How this works".

   Reads/writes its "seen" flag only through repository.js — the one
   door to localStorage. Builds its own DOM so index.html stays lean,
   and does nothing at import time (safe under the Node test stub).
═══════════════════════════════════════════════════════════════ */

import { repoGetLocal, repoSetLocal } from './repository.js';
import { session } from './state.js';

/* Section order matches LEDGER_SECTIONS in ledger-nav.js:
   POS → MEDIQ → Shift → HS → Strips → Inv Audit → Misc → Card →
   Till → Vault → Credit → Deposit → Audit → Final. Every label below
   is the chip name a cashier sees in the jump bar. */
export const WALKTHROUGH_STEPS = [
  {
    title: 'One section at a time',
    body: 'A closing is filled in section by section. Totals update as you type, and your entries are kept as a draft automatically.',
    items: [
      ['Move', 'Use Back and Next at the bottom, or tap a section chip at the top to jump.'],
      ['Check', '“View all” shows every section in one read-only list.']
    ]
  },
  {
    title: 'Sales',
    chips: ['POS', 'MEDIQ', 'Shift'],
    body: 'Start with what the system recorded for the shift.',
    items: [
      ['POS', 'System cash sales, last bill, card sales and returns.'],
      ['MEDIQ', 'Each COD order: bill number, cash collected and the pharmacy bill.'],
      ['Shift', 'This shift’s sales, book bills and customers. This gives the Net Sale.']
    ]
  },
  {
    title: 'Stock and charges',
    chips: ['HS', 'Strips', 'Inv Audit', 'Misc'],
    body: 'Record revenue and charges that are not plain till sales.',
    items: [
      ['HS', 'HS block total (A).'],
      ['Strips', 'Inventory strips and block revenue (B).'],
      ['Inv Audit', 'Sync the stock list, then confirm the snapshot.'],
      ['Misc', 'Ongoing and miscellaneous charges (C).']
    ]
  },
  {
    title: 'Cash and credit',
    chips: ['Card', 'Till', 'Vault', 'Credit', 'Deposit'],
    body: 'Count the money that is actually in hand, then what is owed or banked.',
    items: [
      ['Card', 'Card sales this shift (D).'],
      ['Till', 'Till cash (E).'],
      ['Vault', 'Draw cash (F).'],
      ['Credit', 'Credit given, including staff and other credit (G).'],
      ['Deposit', 'Cash deposited (H).']
    ]
  },
  {
    title: 'Audit and Final',
    chips: ['Audit', 'Final'],
    body: 'Audit adds A to H, takes off the cash reserve and compares the result with the Net Sale.',
    items: [
      ['Audit', 'The banner shows Plus, Less or zero. Zero means the till matches exactly.'],
      ['Final', 'Combined figures for the period since the last Final Closing.']
    ]
  },
  {
    title: 'Check it saved',
    body: 'The bar at the top of the screen shows where your work is.',
    items: [
      ['Saved ✓', 'Your closing reached the cloud. Safe to leave.'],
      ['Offline, will sync', 'Saved on this phone. It uploads when you are back online.'],
      ['Sync failed, tap to retry', 'Tap the bar to try again before you leave.']
    ]
  }
];

const KEY_PREFIX = 'closing_walkthrough_v1';

export function walkthroughKey(staffId) {
  return `${KEY_PREFIX}:${staffId || 'device'}`;
}
function currentKey() { return walkthroughKey(session.loggedInStaff?.staffId); }

export function walkthroughSeen() { return repoGetLocal(currentKey()) === 'done'; }
function markSeen() { repoSetLocal(currentKey(), 'done'); }

/* ── DOM ──────────────────────────────────────────────────── */
let _idx = 0;
let _returnFocus = null;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if(cls) n.className = cls;
  if(text != null) n.textContent = text;
  return n;
}

function ensureOverlay() {
  let ov = document.getElementById('walkthrough-overlay');
  if(ov) return ov;

  ov = el('div', 'wt-overlay hidden');
  ov.id = 'walkthrough-overlay';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-labelledby', 'wt-title');

  const sheet = el('div', 'wt-sheet');
  const top = el('div', 'wt-top');
  const count = el('span', 'wt-count'); count.id = 'wt-count';
  const skip = el('button', 'wt-skip', 'Skip'); skip.id = 'wt-skip'; skip.type = 'button';
  skip.addEventListener('click', () => closeWalkthrough());
  top.append(count, skip);

  const chips = el('div', 'wt-chips'); chips.id = 'wt-chips';
  const title = el('h2', 'wt-title'); title.id = 'wt-title';
  const body = el('p', 'wt-body'); body.id = 'wt-body';
  const list = el('dl', 'wt-list'); list.id = 'wt-list';
  const dots = el('div', 'wt-dots'); dots.id = 'wt-dots'; dots.setAttribute('aria-hidden', 'true');

  const actions = el('div', 'wt-actions');
  const back = el('button', 'btn btn-ghost', 'Back'); back.id = 'wt-back'; back.type = 'button';
  back.addEventListener('click', () => showStep(_idx - 1));
  const next = el('button', 'btn btn-teal', 'Next'); next.id = 'wt-next'; next.type = 'button';
  next.addEventListener('click', () => {
    if(_idx >= WALKTHROUGH_STEPS.length - 1) closeWalkthrough();
    else showStep(_idx + 1);
  });
  actions.append(back, next);

  sheet.append(top, chips, title, body, list, dots, actions);
  ov.appendChild(sheet);

  /* Keep Tab inside the dialog while it is open. */
  ov.addEventListener('keydown', (e) => {
    if(e.key !== 'Tab') return;
    const focusable = Array.from(ov.querySelectorAll('button')).filter(b => !b.disabled && !b.classList.contains('hidden'));
    if(!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if(e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  document.body.appendChild(ov);
  return ov;
}

function showStep(i) {
  const total = WALKTHROUGH_STEPS.length;
  _idx = Math.max(0, Math.min(total - 1, i));
  const step = WALKTHROUGH_STEPS[_idx];

  document.getElementById('wt-count').textContent = `Step ${_idx + 1} of ${total}`;
  document.getElementById('wt-title').textContent = step.title;
  document.getElementById('wt-body').textContent = step.body;

  const chips = document.getElementById('wt-chips');
  chips.replaceChildren(...(step.chips || []).map(c => el('span', 'wt-chip', c)));
  chips.classList.toggle('hidden', !(step.chips && step.chips.length));

  const list = document.getElementById('wt-list');
  list.replaceChildren();
  (step.items || []).forEach(([k, v]) => {
    const row = el('div', 'wt-row');
    row.append(el('dt', 'wt-k', k), el('dd', 'wt-v', v));
    list.appendChild(row);
  });

  const dots = document.getElementById('wt-dots');
  dots.replaceChildren(...WALKTHROUGH_STEPS.map((_, n) => el('span', 'wt-dot' + (n === _idx ? ' on' : ''))));

  document.getElementById('wt-back').classList.toggle('hidden', _idx === 0);
  const last = _idx === total - 1;
  const next = document.getElementById('wt-next');
  next.textContent = last ? 'Got it' : 'Next';
  next.focus();
}

export function openWalkthrough(startAt = 0) {
  if(typeof document === 'undefined' || !document.body || typeof document.body.appendChild !== 'function') return;
  const ov = ensureOverlay();
  _returnFocus = document.activeElement || null;
  ov.classList.remove('hidden');
  showStep(startAt);
}

/* Closing always counts as "seen" — skipping is a valid choice, and the
   intro stays one tap away in the ledger's ⋮ menu. */
export function closeWalkthrough() {
  const ov = typeof document !== 'undefined' ? document.getElementById('walkthrough-overlay') : null;
  if(ov) ov.classList.add('hidden');
  markSeen();
  if(_returnFocus && typeof _returnFocus.focus === 'function') {
    try { _returnFocus.focus(); } catch(e) { /* element may be gone */ }
  }
  _returnFocus = null;
}

/* Called by initLedger() each time a sheet opens. Only editable sheets
   trigger it, so someone just viewing a saved record is never interrupted. */
export function maybeShowWalkthrough({ locked = false } = {}) {
  if(locked || walkthroughSeen()) return;
  const t = setTimeout(() => {
    if(walkthroughSeen()) return;
    openWalkthrough(0);
  }, 800);
  /* Don't let a pending intro keep a Node process (the test runner) alive. */
  if(t && typeof t.unref === 'function') t.unref();
}

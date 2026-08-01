/* ═══════════════════════════════════════════════════════════════
   FLOOR 0 — NOTIFY
   Zero imports, by design: this sits BENEATH Repository (Floor 1),
   so literally any module — including state.js and repository.js,
   which predate the UI floors — can show the user a message without
   creating a dependency on Components/Pages. It builds its own DOM
   the first time it's called instead of requiring markup already be
   present in index.html, so nothing else has to change to adopt it.

   Replaces the native window.alert(): same "stop and tell the user
   one thing" job, but styled to match the app instead of dropping a
   bare OS dialog on top of a hand-tuned teal/navy interface — which,
   in a cash-handling app, reads as "something broke" even when nothing
   did. Non-blocking (alert() froze the whole tab; this doesn't), so
   callers keep the exact same fire-and-forget shape they had before:
     alert('message')  →  showAlert('message')
═══════════════════════════════════════════════════════════════ */

let _built = false;
let _overlay, _icon, _msg, _okBtn;

function build() {
  if(_built) return;
  _built = true;

  _overlay = document.createElement('div');
  _overlay.id = 'app-alert-overlay';
  _overlay.className = 'hidden';
  _overlay.setAttribute('role', 'alertdialog');
  _overlay.setAttribute('aria-modal', 'true');

  const sheet = document.createElement('div');
  sheet.className = 'app-alert-sheet';

  _icon = document.createElement('div');
  _icon.className = 'app-alert-icon';
  _icon.textContent = 'ℹ️';

  _msg = document.createElement('div');
  _msg.id = 'app-alert-msg';
  _msg.className = 'app-alert-msg';

  _okBtn = document.createElement('button');
  _okBtn.type = 'button';
  _okBtn.className = 'btn btn-teal app-alert-ok';
  _okBtn.textContent = 'OK';
  _okBtn.onclick = hide;

  sheet.appendChild(_icon);
  sheet.appendChild(_msg);
  sheet.appendChild(_okBtn);
  _overlay.appendChild(sheet);
  _overlay.addEventListener('click', (e) => { if(e.target === _overlay) hide(); });
  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape' && !_overlay.classList.contains('hidden')) hide();
  });

  document.body.appendChild(_overlay);
}

function hide() {
  _overlay.classList.add('hidden');
  _prevFocus?.focus?.();
}

let _prevFocus = null;

/* tone: 'info' (default) | 'warn' | 'danger' — auto-detected from a
   leading ⚠️/⛔ emoji when not passed explicitly, so every existing
   alert('⚠️ ...') call site upgrades for free with no edits needed. */
export function showAlert(message, tone) {
  build();
  if(!tone) {
    tone = message.startsWith('⛔') ? 'danger'
         : message.startsWith('⚠️') ? 'warn'
         : 'info';
  }
  _icon.textContent = tone === 'danger' ? '⛔' : tone === 'warn' ? '⚠️' : 'ℹ️';
  _overlay.dataset.tone = tone;
  _msg.textContent = message;
  _prevFocus = document.activeElement;
  _overlay.classList.remove('hidden');
  _okBtn.focus();
}

/* ═══════════════════════════════════════════════════════════════
   CONFIRM — styled stand-in for window.confirm(), same reasoning as
   showAlert() above but for the app's highest-stakes moments: every
   call site is an irreversible delete, a full data restore/replace,
   or a sign-out — exactly where a bare OS dialog undercuts trust the
   most in a cash-handling app, reading as a browser-level warning
   rather than the app asking permission.

   Promise-based so every call site becomes `await showConfirm(...)`
   in place of `confirm(...)` — same "did the user say yes" shape,
   just non-blocking. Cancel is the default-focused button (not
   Confirm), so a reflexive tap/Enter can't fire a destructive action
   — the same "default to safe" principle a well-designed physical
   lock or guarded switch uses. */
let _cBuilt = false;
let _cOverlay, _cIcon, _cMsg, _cCancelBtn, _cConfirmBtn, _cPrevFocus, _cResolve;

function buildConfirm() {
  if(_cBuilt) return;
  _cBuilt = true;

  _cOverlay = document.createElement('div');
  _cOverlay.id = 'app-confirm-overlay';
  _cOverlay.className = 'hidden';
  _cOverlay.setAttribute('role', 'alertdialog');
  _cOverlay.setAttribute('aria-modal', 'true');

  const sheet = document.createElement('div');
  sheet.className = 'app-alert-sheet app-confirm-sheet';

  _cIcon = document.createElement('div');
  _cIcon.className = 'app-alert-icon';

  _cMsg = document.createElement('div');
  _cMsg.id = 'app-confirm-msg';
  _cMsg.className = 'app-alert-msg';

  const row = document.createElement('div');
  row.className = 'app-confirm-btn-row';

  _cCancelBtn = document.createElement('button');
  _cCancelBtn.type = 'button';
  _cCancelBtn.className = 'btn btn-ghost app-confirm-cancel';
  _cCancelBtn.onclick = () => resolveConfirm(false);

  _cConfirmBtn = document.createElement('button');
  _cConfirmBtn.type = 'button';
  _cConfirmBtn.className = 'btn btn-red app-confirm-ok';
  _cConfirmBtn.onclick = () => resolveConfirm(true);

  row.appendChild(_cCancelBtn);
  row.appendChild(_cConfirmBtn);
  sheet.appendChild(_cIcon);
  sheet.appendChild(_cMsg);
  sheet.appendChild(row);
  _cOverlay.appendChild(sheet);
  _cOverlay.addEventListener('click', (e) => { if(e.target === _cOverlay) resolveConfirm(false); });
  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape' && !_cOverlay.classList.contains('hidden')) resolveConfirm(false);
  });

  document.body.appendChild(_cOverlay);
}

function resolveConfirm(result) {
  _cOverlay.classList.add('hidden');
  _cPrevFocus?.focus?.();
  const r = _cResolve;
  _cResolve = null;
  r?.(result);
}

/* tone: 'danger' (default) | 'warn'. confirmLabel defaults to "Delete"
   for danger and "Continue" for warn — override for anything that
   isn't a delete (e.g. "Log Out", "Restore"). */
export function showConfirm(message, opts = {}) {
  buildConfirm();
  const tone = opts.tone || 'danger';
  _cIcon.textContent = tone === 'danger' ? '⛔' : '⚠️';
  _cOverlay.dataset.tone = tone;
  _cMsg.textContent = message;
  _cCancelBtn.textContent = opts.cancelLabel || 'Cancel';
  _cConfirmBtn.textContent = opts.confirmLabel || (tone === 'danger' ? 'Delete' : 'Continue');
  _cConfirmBtn.className = 'btn app-confirm-ok ' + (tone === 'danger' ? 'btn-red' : 'btn-teal');
  _cPrevFocus = document.activeElement;
  _cOverlay.classList.remove('hidden');
  _cCancelBtn.focus();
  return new Promise((resolve) => { _cResolve = resolve; });
}

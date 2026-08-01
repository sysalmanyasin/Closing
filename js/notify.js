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

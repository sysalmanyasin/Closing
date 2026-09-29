/* ═══════════════════════════════════════════════════════════════
   FLOOR 5 (ext) — CLOUD SETTINGS HISTORY
   Settings → Backup & Retention → "Cloud Settings History".

   Every real change to the cloud `settings` row is archived by a
   Postgres trigger (supabase/settings_restore.sql). This screen lists
   those archived versions and lets an admin restore one — the in-app
   answer to "settings got reset again" (2026-08-27, 2026-09-28).

   All security lives server-side: the two RPCs require a signed-in
   active staff login AND the current cloud Admin PIN, and lock out
   after 5 wrong PINs. This file never sees a PIN other than the one
   the person just typed, and forgets it after a few minutes.
═══════════════════════════════════════════════════════════════ */

import { getSupabaseClient } from './supabase-client.js';
import { syncPullFromCloud } from './sync.js';
import { buildSettingsUI } from './pages.js';
import { showAlert, showConfirm } from './notify.js';
import { escHtml } from './state.js';

const PIN_TTL_MS = 5 * 60 * 1000;
const _st = { pin: null, timer: null };

const ERROR_TEXT = {
  wrong_pin:         '⛔ Incorrect Admin PIN.',
  too_many_attempts: '⛔ Too many wrong PINs. Wait 10 minutes and try again.',
  not_authorized:    '⛔ Sign in with your staff login first (cloud sync must be connected).',
  version_not_found: '⚠️ That version no longer exists. Reload the list.'
};
export function errorMessage(code) {
  return ERROR_TEXT[code] || `⚠️ Could not reach settings history (${code || 'unknown error'}).`;
}

/* Pure: turn one server summary row into display text. Unit-tested. */
export function describeVersion(v, locale = 'en-PK') {
  const prices = Array.isArray(v.strip_prices) ? v.strip_prices : [];
  const shown = prices.slice(0, 8).join(', ') + (prices.length > 8 ? ', …' : '');
  const credits = (Array.isArray(v.named_credits) ? v.named_credits : []).filter(Boolean).join(', ') || '—';
  let when = '';
  const d = new Date(v.replaced_at);
  if(!isNaN(d)) when = d.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  return {
    id: v.id,
    when,
    lines: [
      `${v.n_strips || 0} inventory items${prices.length ? ' — ' + shown : ''}`,
      `Credits: ${credits}`,
      `${v.n_staff || 0} staff · ${v.n_tiers || 0} credit tiers`
    ]
  };
}

export function renderVersionList(versions, locale) {
  if(!versions.length) return '<p class="sh-empty">No archived versions yet.</p>';
  return versions.map(v => {
    const d = describeVersion(v, locale);
    return `<div class="sh-row" style="padding:10px 16px;border-top:1px solid rgba(128,128,128,.2);">
      <div style="font-weight:600;font-size:0.85rem;">${escHtml(d.when)}</div>
      ${d.lines.map(l => `<div style="font-size:0.78rem;color:var(--muted);">${escHtml(l)}</div>`).join('')}
      <button class="btn btn-ghost" style="margin-top:6px;" onclick="restoreSettingsVersion(${Number(d.id)})">↩ Restore this version</button>
    </div>`;
  }).join('');
}

function _forgetPin() {
  _st.pin = null;
  if(_st.timer) { clearTimeout(_st.timer); _st.timer = null; }
}

async function _rpc(fn, args) {
  const client = getSupabaseClient();
  if(!client) return { ok: false, error: 'not_authorized' };
  try {
    const { data, error } = await client.rpc(fn, args);
    if(error) return { ok: false, error: error.message || 'rpc_error' };
    return data || { ok: false, error: 'empty_response' };
  } catch(e) {
    return { ok: false, error: e?.message || 'network_error' };
  }
}

export async function openSettingsHistory() {
  const box = document.getElementById('settings-history-list');
  if(!box) return;
  const pin = prompt('Enter Admin PIN to view cloud settings history:');
  if(!pin) return;
  box.innerHTML = '<p class="sh-empty" style="padding:10px 16px;">Loading…</p>';
  const res = await _rpc('settings_history_list', { p_pin: pin });
  if(!res.ok) { box.innerHTML = ''; showAlert(errorMessage(res.error)); return; }
  _forgetPin();
  _st.pin = pin;
  _st.timer = setTimeout(_forgetPin, PIN_TTL_MS);
  box.innerHTML = renderVersionList(res.versions || []);
}

export async function restoreSettingsVersion(id) {
  if(!_st.pin) { showAlert('⚠️ Session expired. Tap "Load versions" and enter the Admin PIN again.'); return; }
  const ok = await showConfirm(
    'Replace ALL current settings (inventory, credits, staff, tiers, PINs) with this version?\n\n' +
    'The current settings are archived first, so you can undo this from the same list.',
    { confirmLabel: 'Restore', tone: 'warn' });
  if(!ok) return;
  const res = await _rpc('settings_history_restore', { p_pin: _st.pin, p_id: id });
  if(!res.ok) { showAlert(errorMessage(res.error)); return; }
  _forgetPin();
  await syncPullFromCloud(true);   /* adopt the restored settings on this device now */
  buildSettingsUI();
  const box = document.getElementById('settings-history-list');
  if(box) box.innerHTML = '';
  showAlert('✅ Settings restored from history. Other devices will pick them up within a few seconds.');
}

/* ═══════════════════════════════════════════════════════════════
   FLOOR 4 — INVENTORY AUDIT CARD
   "Inventory Audit" card that sits right after Strips in the
   closing flow. Staff tap Sync & Audit → the app reads live stock
   balances for a fixed list of item codes → only NON-ZERO balances
   (positive or negative) are shown → staff tap Verify & Confirm →
   the card freezes and a snapshot is stored on the shift record
   (`record.inventoryAudit`), which rides along in the same `sheets`
   upsert as the rest of the closing report (see sync.js). No schema
   change is needed — `sheets.data` is jsonb.

   WHERE THE DATA LIVES — NOT the Closing project:
   Stock balances are in the Pharmacy Audit Hub Supabase project,
   table `inventory_products` (columns code / name / qty), the same
   project + read-only publishable key BT Sale Data's
   inventory-bridge.js and the Android widgets already use. There is
   no `inventory` table in either project. This module only ever
   READS from it (plain REST GET) — it never writes there, and it
   deliberately does not use the shared Closing Supabase client
   (different project, different key).

   FLOOR RULES: this file never touches `db` or localStorage. The
   snapshot lives in a private module object; actions.js (Floor 3)
   pulls it into the saved record via invAuditGetSnapshot() and
   pushes a saved one back via invAuditRestore() on open.
═══════════════════════════════════════════════════════════════ */

import { escHtml, session } from './state.js';
import { fetchActiveStaff } from './bt-bridge.js';
import { showAlert, showConfirm } from './notify.js';

/* Same project/key as BT Sale Data's js/inventory-bridge.js and the
   widgets' InventoryRepository.kt. Publishable (anon) key — safe to
   commit; RLS ("inventory read anon") makes it SELECT-only. */
const INV_SUPABASE_URL      = 'https://vtcrdkqhuvxatclobsby.supabase.co';
const INV_SUPABASE_ANON_KEY = 'sb_publishable_h-Z3ldRXyb18HEjF68cJ0g_tmRgbrAy';
const INV_TABLE             = 'inventory_products';
const FETCH_TIMEOUT_MS      = 15000;

/* The audited item codes, exactly as specified (note 894319 and
   894327 / 894329 are intentionally absent from this list). */
export const AUDIT_CODES = [
  '894301','894302','894303','894304','894305','894306','894307','894308','894309','894310',
  '894311','894312','894313','894314','894315','894316','894317','894318','894320','894321',
  '894322','894323','894324','894325','894326','894328','894330','894331','894332','894333','894334'
];

/* ── Pure helpers (exported so they can be unit-tested) ───────── */

/* Raw table rows → [{code, name, qty:Number}], sorted by code. */
export function normalizeRows(rows) {
  return (rows || [])
    .map(r => ({ code: String(r.code ?? '').trim(), name: String(r.name ?? '').trim(), qty: Number(r.qty) }))
    .filter(r => r.code && Number.isFinite(r.qty))
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

/* The display rule: ONLY stock != 0 (positive or negative). */
export function nonZeroItems(rows) {
  return (rows || []).filter(r => r.qty !== 0);
}

/* Codes we asked for that the table did not return at all — shown
   as a note so a missing item is never mistaken for "zero stock". */
export function findNotFound(rows, codes = AUDIT_CODES) {
  const have = new Set((rows || []).map(r => r.code));
  return codes.filter(c => !have.has(c));
}

/* One record per non-zero item: code, verified quantity, timestamp,
   staff ID (+ name/description for readability in reports). */
export function buildSnapshot({ rows, notFound, staff, sheetKey, fetchedAt, dataAsOf, now = new Date() }) {
  const verifiedAt = now.toISOString();
  return {
    version: 1,
    source: INV_TABLE,
    sheetKey: sheetKey || null,
    verifiedAt,
    staffId: staff.staffId,
    staffName: staff.staffName,
    fetchedAt: fetchedAt || null,
    inventoryDataAsOf: dataAsOf || null,
    codesChecked: AUDIT_CODES.length,
    notFound: notFound || [],
    items: nonZeroItems(rows).map(r => ({
      code: r.code,
      name: r.name,
      verifiedQty: r.qty,
      verifiedAt,
      staffId: staff.staffId
    }))
  };
}

/* ── Private state ─────────────────────────────────────────────── */
const fresh = () => ({
  phase: 'idle',      /* idle | loading | ready | error */
  rows: [],           /* normalized rows from the last sync */
  notFound: [],
  fetchedAt: null,
  dataAsOf: null,
  error: '',
  snapshot: null,     /* set once verified → card is frozen */
  token: 0            /* invalidates in-flight syncs on reset/re-sync */
});
let st = fresh();

/* ── Network ───────────────────────────────────────────────────── */
async function restGet(path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${INV_SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: INV_SUPABASE_ANON_KEY, Authorization: `Bearer ${INV_SUPABASE_ANON_KEY}` },
      cache: 'no-store',
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error(`Inventory server replied ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBalances() {
  const list = AUDIT_CODES.join(',');
  const data = await restGet(`${INV_TABLE}?select=code,name,qty&code=in.(${list})&order=code.asc`);
  return normalizeRows(data);
}

/* Best-effort: when the inventory feed last refreshed, so staff can
   tell stale numbers from live ones. Never blocks or fails the sync. */
async function fetchDataAsOf() {
  try {
    const data = await restGet('inventory_sync_log?select=synced_at&order=synced_at.desc&limit=1');
    return data?.[0]?.synced_at || null;
  } catch { return null; }
}

/* ── Who is verifying? ─────────────────────────────────────────────
   Prefer the signed-in BT staff member (real staffId from auth.js).
   Otherwise fall back to the Responsible Closing Person picked on
   this sheet, resolved to their bt_staff id by name. If neither
   yields an id we refuse rather than invent one. */
async function resolveVerifier() {
  const li = session.loggedInStaff;
  if (li?.staffId) return { staffId: String(li.staffId), staffName: li.name || String(li.staffId) };

  const name = (document.getElementById('sel-responsible-staff')?.value || '').trim();
  if (!name) return null;
  let staff = [];
  try { staff = await fetchActiveStaff(); } catch { /* handled below */ }
  const match = staff.find(s => (s.name || '').trim().toLowerCase() === name.toLowerCase());
  return match ? { staffId: String(match.id), staffName: match.name } : { unresolved: true, staffName: name };
}

/* ── Formatting ────────────────────────────────────────────────── */
const fmtQty = n => Number(n).toLocaleString('en-PK', { maximumFractionDigits: 2 });
const fmtWhen = iso => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleString('en-PK', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

function itemsHtml(items) {
  if (!items.length) return `<div class="inv-empty">✅ Every audited item is at 0 stock — nothing to list.</div>`;
  return `
    <div class="inv-head"><span>Code</span><span>Item</span><span>Stock</span></div>
    ${items.map(r => `
      <div class="inv-row">
        <span class="inv-code">${escHtml(r.code)}</span>
        <span class="inv-name">${escHtml(r.name)}</span>
        <span class="inv-qty${r.qty < 0 ? ' inv-neg' : ''}">${fmtQty(r.qty)}</span>
      </div>`).join('')}`;
}

/* ── Render ────────────────────────────────────────────────────── */
export function invAuditRender() {
  const body = document.getElementById('inv-audit-body');
  const badge = document.getElementById('badge-invaudit');
  if (!body) return;
  const locked = !!session.isSheetLocked;
  let html = '';

  if (st.snapshot) {
    const s = st.snapshot;
    const rows = s.items.map(i => ({ code: i.code, name: i.name, qty: i.verifiedQty }));
    html = `
      <div class="inv-frozen">🔒 Verified by <b>${escHtml(s.staffName || s.staffId)}</b> · ${escHtml(fmtWhen(s.verifiedAt))}
        <div class="inv-sub">${s.items.length} non-zero item(s) of ${s.codesChecked} checked · frozen for this closing</div></div>
      ${itemsHtml(rows)}
      ${s.notFound?.length ? `<div class="inv-note">Not found in inventory: ${escHtml(s.notFound.join(', '))}</div>` : ''}`;
    if (badge) badge.textContent = '✓ Verified';
  } else if (locked) {
    html = `<div class="inv-empty">No inventory audit was recorded for this closing.</div>`;
    if (badge) badge.textContent = '—';
  } else if (st.phase === 'loading') {
    html = `<div class="inv-empty">Syncing stock balances…</div>
      <div class="inv-actions"><button class="btn btn-teal btn-full" disabled>Syncing…</button></div>`;
  } else if (st.phase === 'error') {
    html = `<div class="inv-error">⚠️ ${escHtml(st.error)}</div>
      <div class="inv-actions"><button class="btn btn-teal btn-full" onclick="invAuditSync()">🔄 Retry Sync &amp; Audit</button></div>`;
  } else if (st.phase === 'ready') {
    const items = nonZeroItems(st.rows);
    html = `
      <div class="inv-meta">Synced ${escHtml(fmtWhen(st.fetchedAt))}${st.dataAsOf ? ` · inventory feed updated ${escHtml(fmtWhen(st.dataAsOf))}` : ''}
        <div class="inv-sub">${items.length} non-zero item(s) of ${AUDIT_CODES.length} codes</div></div>
      ${itemsHtml(items)}
      ${st.notFound.length ? `<div class="inv-note">Not found in inventory: ${escHtml(st.notFound.join(', '))}</div>` : ''}
      <div class="inv-actions">
        <button class="btn btn-ghost" onclick="invAuditSync()">🔄 Re-sync</button>
        <button class="btn btn-green" onclick="invAuditVerify()">✅ Verify &amp; Confirm</button>
      </div>`;
    if (badge) badge.textContent = `${items.length} item(s)`;
  } else {
    html = `<div class="inv-empty">Tap <b>Sync &amp; Audit</b> to pull current stock balances. Only items with a positive or negative balance are listed.</div>
      <div class="inv-actions"><button class="btn btn-teal btn-full" onclick="invAuditSync()">🔄 Sync &amp; Audit</button></div>`;
    if (badge) badge.textContent = '—';
  }
  body.innerHTML = html;
}

/* ── Actions (exposed on window by app.js for the onclick handlers) ── */
export async function invAuditSync() {
  if (st.snapshot || session.isSheetLocked) return; /* frozen / saved → read-only */
  const my = ++st.token;
  st.phase = 'loading'; st.error = '';
  invAuditRender();
  try {
    const [rows, dataAsOf] = await Promise.all([fetchBalances(), fetchDataAsOf()]);
    if (my !== st.token) return; /* superseded by a reset or a newer sync */
    st.rows = rows;
    st.notFound = findNotFound(rows);
    st.fetchedAt = new Date().toISOString();
    st.dataAsOf = dataAsOf;
    st.phase = 'ready';
  } catch (e) {
    if (my !== st.token) return;
    st.phase = 'error';
    st.error = e?.name === 'AbortError'
      ? 'Timed out reaching the inventory server. Check the connection and retry.'
      : `Could not load inventory (${e?.message || 'network error'}). Check the connection and retry.`;
  }
  invAuditRender();
}

export async function invAuditVerify() {
  if (st.snapshot || st.phase !== 'ready' || session.isSheetLocked) return;

  const who = await resolveVerifier();
  if (!who) {
    showAlert('⛔ Sign in, or pick the Responsible Closing Person at the top of this sheet, before verifying the inventory audit.');
    return;
  }
  if (who.unresolved) {
    showAlert(`⛔ Couldn't find "${who.staffName}" in the BT staff registry to record a staff ID. Check the connection and try again.`);
    return;
  }

  const items = nonZeroItems(st.rows);
  const ok = await showConfirm(
    `Confirm these stock balances (${items.length} non-zero item${items.length === 1 ? '' : 's'}) are correct?\n\n` +
    `This freezes the audit for this closing and records it under ${who.staffName}.`,
    { tone: 'warn', confirmLabel: 'Verify & Confirm', cancelLabel: 'Not yet' }
  );
  /* state may have changed while the dialogs were open */
  if (!ok || st.snapshot || st.phase !== 'ready' || session.isSheetLocked) return;

  st.snapshot = buildSnapshot({
    rows: st.rows, notFound: st.notFound, staff: who,
    sheetKey: session.activeKey, fetchedAt: st.fetchedAt, dataAsOf: st.dataAsOf
  });
  invAuditRender();
  /* Same trigger every other card uses after an edit: calc() schedules
     the autosave that writes the snapshot into the draft record. */
  if (typeof window.calc === 'function') window.calc();
}

/* ── Hooks for actions.js ──────────────────────────────────────── */
export function invAuditGetSnapshot() {
  return st.snapshot ? JSON.parse(JSON.stringify(st.snapshot)) : null;
}

/* Called on every ledger open (clears the previous sheet's state) and
   again from hydrate() with the saved snapshot, if there is one. */
export function invAuditReset() {
  st = fresh();
  st.token = Date.now(); /* any in-flight sync from the previous sheet is now stale */
  invAuditRender();
}

export function invAuditRestore(snapshot) {
  st.snapshot = snapshot && Array.isArray(snapshot.items) ? snapshot : null;
  invAuditRender();
}

/* ═══════════════════════════════════════════════════════════════
   FLOOR 4 — COMPONENTS
   Pure UI building blocks: modal picker, row builders, toast,
   print sheet, PDF/WhatsApp export, edit modal, more menu.
═══════════════════════════════════════════════════════════════ */

import { DENOMS, checkPin, daySlots, db, escHtml, genRowId, srLabel, session } from './state.js';
import { alLog } from './activity-log.js';
import {
  calc, flushInputs, initLedger, populateNameDropdown,
  pullPreviousShift, setLockedState, setSheetProfileMode
} from './actions.js';
import { buildCalendar, goToDashboard, renderManifest, sheetSortKey } from './pages.js';
import { initLedgerSwipeNav, onCardToggled } from './ledger-nav.js';
import { dbxInit } from './sync.js';

/* Floor 4's own transient UI state — file-local, never read by
   another floor. One object instead of scattered globals. */
const compState = {
  pickerTarget:   null,
  pickerCallback: null,
  namedEntrySeq:  {},
  pdfModalKey:    null,
  editModalKey:   null
};


/* attach a number input for native keyboard entry (custom numpad UI removed) */
export function attachNumpad(el, _label) {
  /* Restore normal input behaviour: remove any readonly/inputmode restrictions */
  el.removeAttribute('inputmode');
  el.removeAttribute('readonly');
  el.style.cursor = '';
}

/* ═══════════════════════════════════════════
   SELECT-ALL ON FOCUS (clears zero instantly)
═══════════════════════════════════════════ */
document.addEventListener('focusin', function(e) {
  const el = e.target;
  if(el.tagName === 'INPUT' && el.type === 'number' && !el.readOnly) {
    /* Select all so the first keystroke replaces the whole value */
    setTimeout(() => el.select(), 0);
  }
});
document.addEventListener('blur', function(e) {
  const el = e.target;
  if(el.tagName === 'INPUT' && el.type === 'number' && !el.readOnly) {
    if(el.value === '' || el.value === null) {
      el.value = 0;
      el.dispatchEvent(new Event('input', {bubbles: true}));
    }
  }
}, true);

/* ═══════════════════════════════════════════
   MODAL PICKER ENGINE (replaces <select>)
═══════════════════════════════════════════ */

export function openModalPicker(title, options, currentVal, onPick) {
  compState.pickerCallback = onPick;
  document.getElementById('modal-picker-title').textContent = title;
  const list = document.getElementById('modal-picker-list');
  list.innerHTML = "";
  options.forEach(opt => {
    const div = document.createElement('div');
    div.className = 'modal-picker-item' + (opt.value === currentVal ? ' selected' : '');
    div.textContent = opt.label;
    div.onclick = () => { closeModalPicker(); onPick(opt.value, opt.label); };
    list.appendChild(div);
  });
  document.getElementById('modal-picker-overlay').classList.remove('hidden');
}

export function closeModalPicker() {
  document.getElementById('modal-picker-overlay').classList.add('hidden');
  compState.pickerTarget = null; compState.pickerCallback = null;
}

/* ═══════════════════════════════════════════
   COLLAPSIBLE CARDS
═══════════════════════════════════════════ */
export function toggleCard(id) {
  const card = document.getElementById(id);
  if(!card) return;
  /* Cloud sync card uses a separate explicit body div */
  if(id === 'card-cloud-sync') {
    const body = document.getElementById('card-cloud-sync-body');
    const icon = card.querySelector('.collapse-icon');
    const hidden = body.style.display === 'none';
    body.style.display = hidden ? 'block' : 'none';
    if(icon) icon.textContent = hidden ? '▼' : '▶';
  } else if (card.classList.contains('ledger-section')) {
    /* Ledger section cards are driven entirely by focus mode now —
       there's no Browse state to toggle into, so header taps are a no-op.
       Use the nav chips, Back/Next, or "View all" to navigate instead. */
    return;
  } else {
    card.classList.toggle('collapsed');
    /* notify the ledger-nav layer so the jump-nav/progress bar stays in sync;
       safe no-op if ledger-nav.js hasn't loaded (e.g. on non-ledger pages) */
    if (typeof onCardToggled === 'function') onCardToggled(id);
  }
}

/* ═══════════════════════════════════════════
   BOOT
═══════════════════════════════════════════ */
window.onload = () => {
  buildDenomRows();
  buildCalendar();
  renderManifest();
  dbxInit(); /* ── Cloud sync: parse token & init on load ── */
  if (typeof initLedgerSwipeNav === 'function') initLedgerSwipeNav(); /* mobile swipe-to-navigate */
};

/* ═══════════════════════════════════════════
   PAGE NAVIGATION
═══════════════════════════════════════════ */

export function buildDenomRows() {
  ['denom-till','denom-vault'].forEach((containerId, setIdx) => {
    const box = document.getElementById(containerId);
    box.innerHTML = "";
    const cls = setIdx===0 ? 'till-cell' : 'vault-cell';
    DENOMS.forEach(d => {
      const row = document.createElement('div');
      row.className = "row";
      const inputId = `${containerId}-${d.mult}`;
      row.innerHTML = `<label for="${inputId}">${d.label}</label><input type="number" id="${inputId}" class="${cls}" data-mult="${d.mult}" oninput="calc()" value="0">`;
      box.appendChild(row);
      const inp = row.querySelector('input');
      attachNumpad(inp, d.label);
    });
  });
}

/* ═══════════════════════════════════════════
   DYNAMIC ROW BUILDERS
═══════════════════════════════════════════ */
export function addHsRow(lbl='', val='', rid=null) {
  session.hsRowCount++;
  const id = `hs-row-${session.hsRowCount}`;
  const stableId = rid || genRowId();
  const row = document.createElement('div');
  row.className = "row"; row.id = id;
  row.dataset.rid = stableId;
  row.innerHTML = `
    <input type="text" class="lbl-input hs-lbl" placeholder="Home Service ${session.hsRowCount}" value="${escHtml(lbl)}">
    <input type="number" class="hs-val" value="${val||0}" oninput="calc()">
    <button class="del-row-btn" onclick="delRow('${id}',true)" aria-label="Remove row">✕</button>`;
  document.getElementById('hs-rows').appendChild(row);
  const inp = row.querySelector('.hs-val');
  attachNumpad(inp);
  calc();
}

export function addAuxStripRow(lbl='', price='', qty='', rid=null) {
  session.auxStripCount++;
  const id = `aux-strip-row-${session.auxStripCount}`;
  const stableId = rid || genRowId();
  const sc = document.getElementById('ledger-strips');
  const row = document.createElement('div');
  row.className = "row strip-row"; row.id = id;
  row.dataset.rid = stableId;
  row.innerHTML = `
    <input type="text" class="lbl-input aux-strip-lbl" placeholder="Extra item" value="${escHtml(lbl)}" style="flex:1;">
    <input type="number" class="aux-strip-price" value="${price||0}" oninput="calc()" style="width:80px;">
    <input type="number" class="aux-strip-qty"   value="${qty||0}"   oninput="calc()" style="width:80px;">
    <input type="number" class="aux-strip-total" readonly style="width:80px;">
    <button class="del-row-btn" onclick="delRow('${id}',true)" aria-label="Remove row">✕</button>`;
  sc.appendChild(row);
  attachNumpad(row.querySelector('.aux-strip-price'), 'Unit Price');
  attachNumpad(row.querySelector('.aux-strip-qty'),   'Quantity');
  calc();
}

/* per-account entry-row counters, keyed by account index, so ids stay unique
   across add/remove/hydrate cycles within a single ledger session */

export function addNamedAccountBlock(accountIdx, lbl) {
  const container = document.getElementById('ledger-named-credits');
  const block = document.createElement('div');
  block.className = "named-account-block";
  block.id = `named-account-${accountIdx}`;
  block.dataset.accountIdx = accountIdx;
  block.innerHTML = `
    <div class="named-account-head">${escHtml(lbl)}</div>
    <div class="named-account-rows"></div>
    <div class="named-account-add-wrap">
      <button type="button" class="add-row-btn add-row-btn-sm" onclick="addNamedCreditEntryRow(${accountIdx})">＋ Add entry</button>
    </div>`;
  container.appendChild(block);
  compState.namedEntrySeq[accountIdx] = 0;
}

export function addNamedCreditEntryRow(accountIdx, desc='', val=0, rid=null) {
  const block = document.getElementById(`named-account-${accountIdx}`);
  if(!block) return;
  const rowsBox = block.querySelector('.named-account-rows');
  compState.namedEntrySeq[accountIdx] = (compState.namedEntrySeq[accountIdx]||0) + 1;
  const seq   = compState.namedEntrySeq[accountIdx];
  const rowId = `named-entry-row-${accountIdx}-${seq}`;
  const valId = `named-entry-val-${accountIdx}-${seq}`;
  const stableId = rid || genRowId();
  const row = document.createElement('div');
  row.className = "row named-entry-row"; row.id = rowId;
  row.dataset.accountIdx = accountIdx;
  row.dataset.rid = stableId;
  row.innerHTML = `
    <input type="text" class="lbl-input named-entry-desc" placeholder="Description (optional)" value="${escHtml(desc)}">
    <div style="display:flex;gap:4px;align-items:center;">
      <button type="button" class="btn btn-ghost btn-sm" style="padding:4px 8px;" onclick="toggleSign('${valId}')" aria-label="Toggle positive or negative">±</button>
      <input type="number" class="named-entry-val" id="${valId}" value="${val||0}" oninput="calc()" style="width:90px;">
    </div>
    <button class="del-row-btn" onclick="delRow('${rowId}',true)" aria-label="Remove row">✕</button>`;
  rowsBox.appendChild(row);
  attachNumpad(row.querySelector('.named-entry-val'));
  calc();
}

export function addTierCreditRow(num) {
  const container = document.getElementById('ledger-tier-credits');
  const row = document.createElement('div');
  row.className = "row three-col"; row.id = `tier-row-${num}`;
  row.innerHTML = `
    <select id="sel-tier-${num}" onchange="openTierPicker(${num})"></select>
    <select id="sel-name-${num}" onchange="calc()"></select>
    <div style="display:flex;gap:4px;align-items:center;">
      <button type="button" class="btn btn-ghost btn-sm" style="padding:4px 8px;" onclick="toggleSign('in-nested-${num}')" aria-label="Toggle positive or negative">±</button>
      <input type="number" id="in-nested-${num}" oninput="calc()" placeholder="Amount" style="width:90px;">
    </div>`;
  container.appendChild(row);

  /* replace selects with tap-friendly modal triggers */
  const tierSel = row.querySelector(`#sel-tier-${num}`);
  const nameSel = row.querySelector(`#sel-name-${num}`);

  /* build tier select */
  tierSel.innerHTML = "<option value=''>— Group —</option>";
  db.settings.subTiers.forEach((t,ti) => {
    const o = document.createElement('option'); o.value = ti; o.textContent = t.type;
    tierSel.appendChild(o);
  });
  nameSel.innerHTML = "<option value=''>— Name —</option>";

  /* make selects open modal picker on click */
  tierSel.addEventListener('mousedown', function(e) {
    e.preventDefault();
    const opts = [{value:'', label:'— Select group —'},
      ...db.settings.subTiers.map((t,ti)=>({value:String(ti), label:t.type}))];
    openModalPicker('Select Group', opts, tierSel.value, (v) => {
      tierSel.value = v;
      populateNameDropdown(num);
    });
  });
  nameSel.addEventListener('mousedown', function(e) {
    e.preventDefault();
    const tIdx = tierSel.value;
    if(tIdx === '') { alert('Please select a group first.'); return; }
    const tier = db.settings.subTiers[parseInt(tIdx)];
    const opts = [{value:'', label:'— Select name —'},
      ...(tier?.names||[]).map(n=>({value:n, label:n}))];
    openModalPicker('Select Name', opts, nameSel.value, (v) => {
      nameSel.value = v; calc();
    });
  });

  const inp = row.querySelector(`#in-nested-${num}`);
  attachNumpad(inp, 'Amount');
}

export function addAuxCreditRow(lbl='', val='', rid=null) {
  session.auxCreditCount++;
  const id = `aux-cred-row-${session.auxCreditCount}`;
  const valId = `aux-cred-val-${session.auxCreditCount}`;
  const stableId = rid || genRowId();
  const row = document.createElement('div');
  row.className = "row"; row.id = id;
  row.dataset.rid = stableId;
  row.innerHTML = `
    <input type="text"   class="lbl-input aux-cred-lbl" placeholder="Other account name" value="${escHtml(lbl)}">
    <div style="display:flex;gap:4px;align-items:center;">
      <button type="button" class="btn btn-ghost btn-sm" style="padding:4px 8px;" onclick="toggleSign('${valId}')" aria-label="Toggle positive or negative">±</button>
      <input type="number" class="aux-cred-val" id="${valId}" value="${val||0}" oninput="calc()" style="width:90px;">
    </div>
    <button class="del-row-btn" onclick="delRow('${id}',true)" aria-label="Remove row">✕</button>`;
  document.getElementById('ledger-aux-credits').appendChild(row);
  attachNumpad(row.querySelector('.aux-cred-val'));
  calc();
}

export function addDepositRow(lbl='', val='', rid=null) {
  session.depositCount++;
  const id = `dep-row-${session.depositCount}`;
  const stableId = rid || genRowId();
  const row = document.createElement('div');
  row.className = "row"; row.id = id;
  row.dataset.rid = stableId;
  row.innerHTML = `
    <input type="text"   class="lbl-input dep-lbl" placeholder="Safe drop reference" value="${escHtml(lbl)}">
    <input type="number" class="dep-val" value="${val||0}" oninput="calc()">
    <button class="del-row-btn" onclick="delRow('${id}',true)" aria-label="Remove row">✕</button>`;
  document.getElementById('ledger-deposits').appendChild(row);
  attachNumpad(row.querySelector('.dep-val'));
  calc();
}

export function addMiscRow(lbl='', val='', rid=null) {
  session.miscCount++;
  const id = `misc-row-${session.miscCount}`;
  const stableId = rid || genRowId();
  const row = document.createElement('div');
  row.className = "row misc-row"; row.id = id;
  row.dataset.rid = stableId;
  row.innerHTML = `
    <input type="text"   id="misc-lbl-${session.miscCount}" class="lbl-input" placeholder="Charge / note" value="${escHtml(lbl)}">
    <input type="number" id="misc-val-${session.miscCount}" value="${val||0}" style="width:90px;" oninput="calc()">
    <button class="del-row-btn" onclick="delRow('${id}',true)" aria-label="Remove row">✕</button>`;
  document.getElementById('ledger-misc').appendChild(row);
  const inp = row.querySelector('input[type="number"]');
  attachNumpad(inp);
  calc();
}

export function delRow(id, recalc) {
  const el = document.getElementById(id);
  if(el) el.remove();
  if(recalc) calc();
}

export function openTierPicker(_num) { /* triggered by change, handled via mousedown */ }

/* ═══════════════════════════════════════════
   LEDGER INIT
═══════════════════════════════════════════ */

/* ── SAVE ACTION SHEET ───────────────────────────────────── */
export function showSaveAction(title, sub, buttons) {
  document.getElementById('save-action-title').textContent = title;
  document.getElementById('save-action-sub').textContent   = sub;
  const btns = document.getElementById('save-action-btns');
  btns.innerHTML = '';
  buttons.forEach(b => {
    const el = document.createElement('button');
    el.className = 'btn ' + (b.style || 'btn-ghost');
    el.textContent = b.label;
    el.onclick = () => {
      document.getElementById('save-action-overlay').classList.add('hidden');
      b.action();
    };
    btns.appendChild(el);
  });
  document.getElementById('save-action-overlay').classList.remove('hidden');
}


export function g(id) { return document.getElementById(id); }
export function set(id, v) { const el=g(id); if(el) el.value=v; }
export function val(id) { const el=g(id); return el?parseFloat(el.value)||0:0; }

/* A sheet only "counts" for calendar dots, manifest, carry-over,
   and Final aggregation once it has been explicitly Saved
   (saveSheet sets draft=false). Auto-drafts (draft=true) are
   excluded until then. */
export function isRealSheet(rec) {
  return !!rec && rec.draft !== true;
}
export function getRealSheet(key) {
  const rec = db.sheets[key];
  return isRealSheet(rec) ? rec : null;
}

/* Steps ONE slot forward (dir=+1) or backward (dir=-1) from (ds,shift)
   within that date's actual slot list (daySlots — Night/Evening always
   addressable, plus whatever's really saved: Morning and/or Handover*).
   Crossing past either end of the list rolls over to the neighboring
   date's fixed anchor — always Night going forward, always Evening
   going backward — which stays trivial regardless of how many
   Handovers a day has, precisely because Night/Evening are fixed
   sentinels (seq 10 / 9999) that are always first/last by construction. */
function stepOneSlot(ds, shift, dir) {
  const slots = daySlots(ds);
  const idx = slots.findIndex(s => s.shift === shift);
  const curIdx = idx === -1 ? (dir > 0 ? -1 : slots.length) : idx;
  const nextIdx = curIdx + dir;
  if(nextIdx >= 0 && nextIdx < slots.length) {
    return { date: ds, shift: slots[nextIdx].shift };
  }
  const d = new Date(ds);
  d.setDate(d.getDate() + dir);
  const outDs = d.toISOString().split('T')[0];
  return dir > 0 ? { date: outDs, shift: 'Night' } : { date: outDs, shift: 'Evening' };
}

/* Was pure calendar math on a fixed 3-name array (Night/Morning/
   Evening) — now walks the actual per-date slot list so a Handover
   closing is a real, addressable stop in the sequence. For any date
   with no Handovers, daySlots() always yields exactly the same
   3 slots in the same order today's fixed array did, so this
   produces byte-identical results to the old implementation for
   every existing (Handover-free) record — see
   tests/timeline-step.test.mjs for the regression proof. */
export function timelineStep(ds, shift, n) {
  const dir = n >= 0 ? 1 : -1;
  const steps = Math.abs(n);
  let cur = { date: ds, shift };
  for(let i = 0; i < steps; i++) cur = stepOneSlot(cur.date, cur.shift, dir);
  return { key: `${cur.date}_${cur.shift}`, date: cur.date, shift: cur.shift };
}

export function buildPrintSheet() {
  const parts = session.activeKey ? session.activeKey.split('_') : ['',''];
  const ds = parts[0], shift = parts[1];
  const psRow = (label, value, cls='') => `<div class="ps-row ${cls}"><span>${escHtml(label)}</span><span>${escHtml(value)}</span></div>`;
  const psRowOrEmpty = (label, raw, cls='') => {
    const n = parseFloat(raw)||0;
    return n !== 0 ? psRow(label, n.toLocaleString('en-PK'), cls) : psRow(label, '—', cls + ' ps-empty');
  };
  const num   = (id) => (parseFloat(g(id)?.value)||0).toLocaleString('en-PK');
  const numRaw= (id) => parseFloat(g(id)?.value)||0;
  const branchName = db.settings.branchName || 'Bahria Town Branch';
  const genStamp = new Date().toLocaleString('en-PK', {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});

  /* ════════════════════════════════════════════════════════
     PAGE 1 — SHIFT CLOSING
  ════════════════════════════════════════════════════════ */

  /* Identity strip */
  const idStrip = `
    <div class="ps-idstrip">
      <div class="ps-idchip"><div class="ps-idchip-label">Date</div><div class="ps-idchip-val">${ds || '—'}</div></div>
      <div class="ps-idchip"><div class="ps-idchip-label">Closing</div><div class="ps-idchip-val">${srLabel(shift)}</div></div>
      <div class="ps-idchip"><div class="ps-idchip-label">Mode</div><div class="ps-idchip-val">${(session.activeMode||'shift').toUpperCase()}</div></div>
      <div class="ps-idchip"><div class="ps-idchip-label">Status</div><div class="ps-idchip-val">${session.isSheetLocked ? 'CLOSED' : 'DRAFT'}</div></div>
    </div>`;

  /* Sale Info box */
  let infoRows = '';
  infoRows += psRow('Computer Cash Sale', num('in-sys-cash'));
  infoRows += psRow('Shift Sale (POS delta)', num('out-shift-sale'));
  infoRows += psRow('Sale Book 1', num('in-book-1'));
  infoRows += psRow('Sale Book 2', num('in-book-2'));
  infoRows += psRow('Customers', num('out-cust'));
  infoRows += psRow('Last Bill #', g('in-last-bill-num')?.value || '—');
  infoRows += psRow('Last Bill Amount', num('in-last-bill-amt'));

  /* Returns box */
  let retRows = '';
  retRows += psRowOrEmpty('Return 1', g('pos-ret-1')?.value);
  retRows += psRowOrEmpty('Return 2', g('pos-ret-2')?.value);
  retRows += psRowOrEmpty('Return 3', g('pos-ret-3')?.value);
  retRows += psRowOrEmpty('System Return', g('pos-ret-sys')?.value);
  retRows += psRow('TOTAL RETURNS', num('out-total-returns'), 'ps-total');
  retRows += psRow('NET SHIFT SALE', num('out-net-sale'), 'ps-highlight');

  /* Card Sales (CC) box */
  let ccRows = '';
  ccRows += psRow('Bank Alfalah', num('in-alfalah'));
  ccRows += psRow('Keenu Machine', num('in-keenu'));
  ccRows += psRowOrEmpty('Computer Card Sale (−)', g('in-comp-sale')?.value);
  ccRows += psRow('Current CC', num('out-curr-cc'));
  ccRows += psRow('Previous Day CC (carried)', num('out-prev-cc'));
  ccRows += psRow('TOTAL CC', (numRaw('out-prev-cc')+numRaw('out-curr-cc')).toLocaleString('en-PK'), 'ps-total');

  /* Till Cash (denominations) box */
  let tillRows = '';
  document.querySelectorAll('.till-cell').forEach(el => {
    const lbl = el.closest('.row')?.querySelector('label')?.textContent || '';
    if((parseFloat(el.value)||0) !== 0) tillRows += psRow(lbl, (parseFloat(el.value)||0).toLocaleString('en-PK'));
  });
  if(!tillRows) tillRows = psRow('— no denominations counted —', '', 'ps-empty');
  tillRows += psRow('TOTAL TILL CASH', num('out-subtotal-c'), 'ps-total');

  /* Draw / Vault Cash box */
  let drawRows = '';
  document.querySelectorAll('.vault-cell').forEach(el => {
    const lbl = el.closest('.row')?.querySelector('label')?.textContent || '';
    if((parseFloat(el.value)||0) !== 0) drawRows += psRow(lbl, (parseFloat(el.value)||0).toLocaleString('en-PK'));
  });
  if(!drawRows) drawRows = psRow('— no vault cash counted —', '', 'ps-empty');
  drawRows += psRow('TOTAL DRAW CASH', num('out-subtotal-d'), 'ps-total');

  /* HS + Strips box */
  let stripRows = '';
  document.querySelectorAll('#hs-rows .row').forEach(row => {
    const name = row.querySelector('.hs-lbl')?.value;
    const v    = row.querySelector('.hs-val')?.value;
    if(name && (parseFloat(v)||0) !== 0) stripRows += psRow(name, (parseFloat(v)||0).toLocaleString('en-PK'));
  });
  document.querySelectorAll('#ledger-strips .strip-row').forEach(row => {
    const name = row.querySelector('.strip-name')?.textContent || row.querySelector('.aux-strip-lbl')?.value;
    const qty  = row.querySelector('.strip-qty,.aux-strip-qty')?.value;
    const line = row.querySelector('.strip-line,.aux-strip-total')?.value;
    if(name && (parseFloat(qty)||0) !== 0) stripRows += psRow(`${name} ×${qty}`, (parseFloat(line)||0).toLocaleString('en-PK'));
  });
  if(!stripRows) stripRows = psRow('— no items —', '', 'ps-empty');
  stripRows += psRow('TOTAL HS + STRIPS', num('out-total-hs')==='0'&&num('out-total-a')==='0' ? '0' : (numRaw('out-total-hs')+numRaw('out-total-a')).toLocaleString('en-PK'), 'ps-total');

  /* Credit Detail box */
  let credRows = '';
  credRows += psRow('Carried from Previous', num('out-prev-credit'));
  if(numRaw('in-credit-adj') !== 0) credRows += psRow('Credit Adjustment', num('in-credit-adj'));
  document.querySelectorAll('.named-account-block').forEach(block => {
    const acctLbl = block.querySelector('.named-account-head')?.textContent || '';
    block.querySelectorAll('.named-entry-row').forEach(row => {
      const valEl  = row.querySelector('.named-entry-val');
      const v      = parseFloat(valEl?.value)||0;
      if(v === 0) return;
      const desc   = row.querySelector('.named-entry-desc')?.value?.trim();
      const rowLbl = desc ? `${acctLbl} — ${desc}` : acctLbl;
      credRows += psRow(rowLbl, v.toLocaleString('en-PK'));
    });
  });
  for(let i=1;i<=3;i++) {
    const grp = g(`sel-tier-${i}`), name = g(`sel-name-${i}`), amt = g(`in-nested-${i}`);
    if(amt && (parseFloat(amt.value)||0) !== 0) {
      const grpLbl  = grp?.selectedOptions?.[0]?.textContent || '';
      const nameLbl = name?.selectedOptions?.[0]?.textContent || '';
      credRows += psRow(`${grpLbl} — ${nameLbl}`, (parseFloat(amt.value)||0).toLocaleString('en-PK'));
    }
  }
  document.querySelectorAll('#ledger-aux-credits .row').forEach(row => {
    const lbl = row.querySelector('.aux-cred-lbl')?.value;
    const v   = row.querySelector('.aux-cred-val')?.value;
    if(lbl && (parseFloat(v)||0) !== 0) credRows += psRow(lbl, (parseFloat(v)||0).toLocaleString('en-PK'));
  });
  if(credRows === psRow('Carried from Previous', num('out-prev-credit'))) { /* no-op guard, keep as-is */ }
  credRows += psRow('TOTAL CREDIT', num('out-total-e'), 'ps-total');

  /* Deposit Detail box */
  let depRows = '';
  depRows += psRow('Carried from Previous', num('out-prev-dep'));
  document.querySelectorAll('#ledger-deposits .row').forEach(row => {
    const lbl = row.querySelector('.dep-lbl')?.value;
    const v   = row.querySelector('.dep-val')?.value;
    if(lbl && (parseFloat(v)||0) !== 0) depRows += psRow(lbl, (parseFloat(v)||0).toLocaleString('en-PK'));
  });
  depRows += psRow('TOTAL DEPOSITS', num('out-total-f'), 'ps-total');

  /* Misc Charges box */
  let miscRows = '';
  document.querySelectorAll('#ledger-misc .misc-row').forEach(row => {
    const lbl = row.querySelector('.lbl-input')?.value;
    const v   = row.querySelector('input[type="number"]')?.value;
    if(lbl) miscRows += psRow(lbl, (parseFloat(v)||0).toLocaleString('en-PK'));
  });
  if(!miscRows) miscRows = psRow('— no items —', '', 'ps-empty');
  miscRows += psRow('TOTAL MISC', num('out-total-g'), 'ps-total');

  /* Grand Summary box */
  let sumRows = '';
  sumRows += psRow('HS + Strips', (numRaw('out-total-hs')+numRaw('out-total-a')).toLocaleString('en-PK'));
  sumRows += psRow('Misc', num('out-total-g'));
  sumRows += psRow('CC (Card Sales)', (numRaw('out-prev-cc')+numRaw('out-curr-cc')).toLocaleString('en-PK'));
  sumRows += psRow('Till Cash', num('out-subtotal-c'));
  sumRows += psRow('Draw Cash', num('out-subtotal-d'));
  sumRows += psRow('Credit', num('out-total-e'));
  sumRows += psRow('Deposits', num('out-total-f'));
  sumRows += psRow('GRAND TOTAL', num('out-grand'), 'ps-total');
  sumRows += psRow('Less: Cash Reserve (float)', '45,000', 'ps-minus');
  sumRows += psRow('Liquid Cash', num('out-liquid'));
  sumRows += psRow('Less: Previous Cash Position', num('out-prev-cash'), 'ps-minus');
  if(numRaw('in-extra-cash') !== 0) sumRows += psRow('Less: Extra Cash Added', num('in-extra-cash'), 'ps-minus');
  sumRows += psRow('NET CASH AVAILABLE', num('out-net-cash'), 'ps-highlight');

  /* Hero variance band — page 1 */
  const diffLbl1 = document.getElementById('ban-variance-label')?.textContent?.trim() || 'Variance';
  const diffVal1 = document.getElementById('ban-variance')?.textContent?.trim() || 'Rs. 0';
  const isShort1 = diffLbl1.toLowerCase().includes('less');
  const hero1 = `
    <div class="ps-hero ${isShort1 ? 'ps-hero-short' : ''}">
      <div>
        <div class="ps-hero-label">${diffLbl1} — Net Cash vs Net Sale</div>
        <div class="ps-hero-val">${diffVal1}</div>
      </div>
      <div class="ps-hero-sub">Net Cash Available minus Net Shift Sale. Zero means the till matches exactly.</div>
    </div>`;

  let ticks1 = '';
  for(let t=60; t<1100; t+=46) ticks1 += `<div class="ps-tick" style="top:${t}px;"></div>`;

  const page1 = `
    <div class="ps-page ps-page-shift">
      <div class="ps-spine"><div class="ps-spine-ticks">${ticks1}</div><div class="ps-spine-label">${srLabel(shift)} · ${ds||''}</div></div>
      <div class="ps-content">

        <div class="ps-letterhead">
          <div class="ps-brand">
            <h1>Fazal Din's Pharma Plus</h1>
            <p>${escHtml(branchName)}</p>
          </div>
          <div class="ps-doctype">
            <span class="ps-doctype-tag">${(session.activeMode||'shift')==='final'?'Final Closing':'Shift Closing'}</span>
            <div class="ps-doctype-date">${ds || '—'} · ${srLabel(shift)} · ${session.isSheetLocked?'CLOSED':'DRAFT'} · Generated ${genStamp}</div>
          </div>
        </div>

        <div class="ps-main3">

          <!-- COL 1: Cash & Summary -->
          <div class="ps-col">
            <div class="ps-box"><h4>Till Cash</h4>${tillRows}</div>
            <div class="ps-box"><h4>Draw / Vault Cash</h4>${drawRows}</div>
            <div class="ps-box"><h4>Deposit Details</h4>${depRows}</div>
            <div class="ps-box ps-box-accent"><h4>Grand Summary</h4>${sumRows}</div>
          </div>

          <!-- COL 2: HS, Misc -->
          <div class="ps-col">
            <div class="ps-box"><h4>HS Details &amp; Strips</h4>${stripRows}</div>
            <div class="ps-box"><h4>Miscellaneous Credits</h4>${miscRows}</div>
          </div>

          <!-- COL 3: Sale, CC, Returns, Credit -->
          <div class="ps-col">
            <div class="ps-box"><h4>Sale Info</h4>${infoRows}</div>
            <div class="ps-box"><h4>Credit Card Sales (CC)</h4>${ccRows}</div>
            <div class="ps-box ps-box-accent"><h4>Returns &amp; Net Sale</h4>${retRows}</div>
            <div class="ps-box"><h4>Credit Detail</h4>${credRows}</div>
          </div>

        </div>

        ${hero1}

      </div>
      <div class="ps-foot"><span>Fazal Din's Pharma Plus — Shift Register</span><span class="ps-foot-page">Page 1 of 2</span></div>
    </div>`;

  /* ════════════════════════════════════════════════════════
     PAGE 2 — FINAL CLOSING (Period Aggregation)
  ════════════════════════════════════════════════════════ */

  const shiftsLabel = g('out-final-shifts')?.value || '— none —';
  const shiftChips = (shiftsLabel.includes('—') ? shiftsLabel.split('—')[1] : shiftsLabel)
    .split(',').map(s=>s.trim()).filter(Boolean)
    .map(s => `<span class="ps-chip">${s}</span>`).join('') || `<span class="ps-chip">— none yet —</span>`;

  /* Part 1 — Net Final Sale */
  let part1Rows = '';
  part1Rows += psRow('POS Sale', num('out-final-same-sys'), 'ps-plus');
  part1Rows += psRow('Book Bills', num('out-final-books'), 'ps-plus');
  part1Rows += psRow('Customers', num('out-final-same-cust'), 'ps-plus');
  part1Rows += psRow('Manual Returns', num('out-final-man-ret'), 'ps-minus ps-red');
  part1Rows += psRow('System Returns', num('out-final-same-sysret'), 'ps-minus ps-red');
  part1Rows += psRowOrEmpty('Additional System Returns', g('in-final-sys-returns')?.value, 'ps-minus ps-red');
  part1Rows += psRow('NET FINAL SALE', num('out-final-net-sale'), 'ps-highlight');

  /* Part 2 — Net Final Cash Available */
  let part2Rows = '';
  part2Rows += psRow('Net Cash Available (after float)', num('out-final-net-cash-base'));
  part2Rows += psRow('Pre-date POS Sales', num('out-final-pre-sys'), 'ps-minus ps-red');
  part2Rows += psRow('Pre-date Customers', num('out-final-pre-cust'), 'ps-minus ps-red');
  part2Rows += psRow('Pre-date System Returns', num('out-final-pre-sysret'), 'ps-minus ps-red');
  part2Rows += psRow('Extra Cash Added to Pharmacy', num('out-final-extra-cash'), 'ps-minus ps-red');
  part2Rows += psRow('Target Net Sale (Part 1 result)', num('out-final-target-sale'), 'ps-minus ps-red');
  part2Rows += psRow('NET FINAL CASH AVAILABLE', num('out-final-net-cash'), 'ps-highlight');

  /* Variance detail box */
  let varRows = '';
  varRows += psRow('Pre-date Total (POS + Cust − SysRet)', num('out-final-pre-total'));
  const diffLbl2 = g('out-final-diff-label')?.textContent?.trim() || 'Plus / Less (Final Audit)';
  const isShort2 = diffLbl2.toLowerCase().includes('less');
  varRows += psRow(diffLbl2, num('out-final-diff'), isShort2 ? 'ps-red' : 'ps-highlight');

  /* Hero variance band — page 2 */
  const hero2 = `
    <div class="ps-hero ${isShort2 ? 'ps-hero-short' : ''}">
      <div>
        <div class="ps-hero-label">${diffLbl2} — Period Reconciliation</div>
        <div class="ps-hero-val">Rs. ${num('out-final-diff')}</div>
      </div>
      <div class="ps-hero-sub">Net Final Cash Available compared to Net Final Sale across the full period since the last Final Closing.</div>
    </div>`;

  let ticks2 = '';
  for(let t=60; t<1100; t+=46) ticks2 += `<div class="ps-tick" style="top:${t}px;"></div>`;

  const page2 = `
    <div class="ps-page ps-page-final">
      <div class="ps-spine ps-spine-final"><div class="ps-spine-ticks">${ticks2}</div><div class="ps-spine-label">Final Closing · ${ds||''}</div></div>
      <div class="ps-content">
        <div class="ps-letterhead">
          <div class="ps-brand">
            <h1>Fazal Din's Pharma Plus</h1>
            <p>${escHtml(branchName)}</p>
          </div>
          <div class="ps-doctype">
            <span class="ps-doctype-tag">Final Closing</span>
            <div class="ps-doctype-date">${ds || '—'} · ${srLabel(shift)}</div>
          </div>
        </div>
        ${idStrip}
        <div class="ps-box"><h4><span class="ps-box-icon">🗂️</span>Shifts Since Last Final</h4>
          <div style="padding:10px 12px;"><div class="ps-chiprow">${shiftChips}</div></div>
        </div>
        <div class="ps-grid2">
          <div class="ps-box ps-box-final"><h4><span class="ps-box-icon">📊</span>Part 1 — Net Final Sale</h4>${part1Rows}</div>
          <div class="ps-box ps-box-final"><h4><span class="ps-box-icon">💵</span>Part 2 — Net Final Cash Available</h4>${part2Rows}</div>
        </div>
        <div class="ps-box"><h4><span class="ps-box-icon">⚖️</span>Variance (Final Audit)</h4>${varRows}</div>
        ${hero2}
      </div>
      <div class="ps-foot"><span>Fazal Din's Pharma Plus — Shift Register</span><span class="ps-foot-page">Page 2 of 2 · Generated ${genStamp}</span></div>
    </div>`;

  document.getElementById('print-sheet').innerHTML = page1 + page2;
}


export async function renderPDF() {
  buildPrintSheet();
  const sheet = document.getElementById('print-sheet');
  sheet.classList.add('show');
  await new Promise(r => setTimeout(r, 120));

  const { jsPDF } = window.jspdf;
  const pdf   = new jsPDF('p', 'mm', 'a4');
  const pageW = 210; /* A4 mm */
  const pageH = 297;

  const pages = sheet.querySelectorAll('.ps-page');
  for(let i = 0; i < pages.length; i++) {
    const canvas = await html2canvas(pages[i], {
      scale: 2,
      useCORS: true,
      width: 794,
      height: 1123,
      windowWidth: 794
    });
    if(i > 0) pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pageW, pageH);
  }

  sheet.classList.remove('show');
  return pdf;
}


/* ── PDF MODAL (from Saved Records) ─────────────────────── */

export function openPdfModal(key) {
  compState.pdfModalKey = key;
  document.getElementById('pdf-modal-status').textContent = '';
  document.getElementById('pdf-modal-overlay').classList.remove('hidden');
}

export function closePdfModal() {
  document.getElementById('pdf-modal-overlay').classList.add('hidden');
  compState.pdfModalKey = null;
}

/* Print/Save PDF only now — WhatsApp export moved to the image
   pipeline (pdfModalShareImage / imageViewerShareCurrent below),
   since the Export modal now shares a PNG instead of a PDF. */
export async function pdfModalAction() {
  const key = compState.pdfModalKey;
  if(!key) return;
  const statusEl = document.getElementById('pdf-modal-status');
  statusEl.textContent = 'Generating PDF…';

  /* Temporarily load the sheet into the ledger (hidden) so buildPrintSheet can read DOM */
  const prevKey  = session.activeKey;
  const prevMode = session.activeMode;
  session.activeKey  = key;
  session.activeMode = db.sheets[key]?.profileMode || 'shift';
  const parts = key.split('_');
  initLedger(parts[0], parts[1], session.activeMode);
  await new Promise(r => setTimeout(r, 120)); /* let DOM settle */

  try {
    const pdf  = await renderPDF();
    const fname = `${parts[0]}_${srLabel(parts[1]).replace(/\s+/g,'_')}.pdf`;
    pdf.save(fname);
    buildPrintSheet();
    const sheet = document.getElementById('print-sheet');
    sheet.classList.add('show');
    setTimeout(() => { window.print(); sheet.classList.remove('show'); }, 200);
    closePdfModal();
  } catch(e) {
    statusEl.textContent = 'Failed: ' + e.message;
  }

  /* Restore previous state */
  session.activeKey  = prevKey;
  session.activeMode = prevMode;
  if(prevKey) { const p = prevKey.split('_'); initLedger(p[0], p[1], prevMode); }
  else goToDashboard();
}


/* ── CLOSING IMAGE VIEWER (View as Image / Send Image to WhatsApp) ──
   Rasterizes ONLY the shift-closing page (.ps-page-shift, page 1) —
   never the Final Closing period-aggregation page 2 — reusing the
   exact same buildPrintSheet()+html2canvas pipeline as renderPDF().
   The fullscreen viewer swipes across the 10 most recently SAVED
   (non-draft) records, newest first — same ordering as the dashboard
   list (sheetSortKey, Floor 5). Every rendered image is cached in
   memory for the life of the page so re-visiting is instant, and
   renders are serialized through imgState.chain since they all share
   the one hidden #print-sheet DOM node — running two at once would
   have them clobber each other mid-render. ── */
const imgState = {
  keys:  [],              /* ordered record keys for this viewer session, newest first */
  index: 0,
  cache: new Map(),       /* key -> PNG dataURL */
  chain: Promise.resolve() /* serializes access to the shared #print-sheet DOM */
};

function imgRecentKeys(aroundKey) {
  const all = Object.keys(db.sheets)
    .filter(k => db.sheets[k] && !db.sheets[k].draft)
    .sort((a, b) => sheetSortKey(b).localeCompare(sheetSortKey(a))); /* newest first */
  let list = all.slice(0, 10);
  if(aroundKey && !list.includes(aroundKey)) list = [aroundKey, ...list].slice(0, 10);
  return list;
}

/* Actually rasterizes one record's page-1 into a PNG dataURL.
   Not exported — always go through renderClosingImage() so calls
   stay serialized against the shared hidden DOM. */
async function _imgRenderKey(key) {
  if(imgState.cache.has(key)) return imgState.cache.get(key);
  const rec = getRealSheet(key);
  if(!rec) return null;

  /* Same temporary-load-into-hidden-ledger trick pdfModalAction uses,
     but silent:true so it never flips the visible page out from under
     the fullscreen viewer sitting on top of it. */
  const prevKey  = session.activeKey;
  const prevMode = session.activeMode;
  const parts = key.split('_');
  session.activeKey  = key;
  session.activeMode = rec.profileMode || 'shift';
  initLedger(parts[0], parts[1], session.activeMode, {silent:true});
  await new Promise(r => setTimeout(r, 120)); /* let DOM settle */

  buildPrintSheet();
  const sheet = document.getElementById('print-sheet');
  sheet.classList.add('show');
  await new Promise(r => setTimeout(r, 60));

  let dataURL = null;
  const page1 = sheet.querySelector('.ps-page-shift');
  if(page1) {
    const canvas = await html2canvas(page1, { scale: 2, useCORS: true, width: 794, height: 1123, windowWidth: 794 });
    dataURL = canvas.toDataURL('image/png');
    imgState.cache.set(key, dataURL);
  }
  sheet.classList.remove('show');

  /* Restore whatever was actually open before this background render */
  session.activeKey  = prevKey;
  session.activeMode = prevMode;
  if(prevKey) { const p = prevKey.split('_'); initLedger(p[0], p[1], prevMode, {silent:true}); }

  return dataURL;
}

function renderClosingImage(key) {
  const result = imgState.chain.then(() => _imgRenderKey(key));
  imgState.chain = result.catch(() => null); /* keep the chain alive even if one render fails */
  return result;
}

/* ── PINCH-TO-ZOOM state for the fullscreen image reader ──
   Kept separate from imgState (which is about *which* record/page is
   showing) — this is purely the current pan/zoom transform applied
   on top of whatever image is currently displayed. Reset to 1x
   whenever the record changes or the viewer closes. */
const imgZoomState = { scale: 1, tx: 0, ty: 0 };

function applyImageZoom() {
  const img = document.getElementById('img-reader-img');
  if(img) img.style.transform = `translate(${imgZoomState.tx}px, ${imgZoomState.ty}px) scale(${imgZoomState.scale})`;
}

function resetImageZoom(animate) {
  imgZoomState.scale = 1; imgZoomState.tx = 0; imgZoomState.ty = 0;
  const img = document.getElementById('img-reader-img');
  if(!img) return;
  if(animate) {
    img.style.transition = 'transform .2s ease';
    applyImageZoom();
    setTimeout(() => { img.style.transition = ''; }, 200);
  } else {
    img.style.transition = '';
    applyImageZoom();
  }
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

/* Keep panned image from drifting entirely off-screen once zoomed */
function clampImageZoomTranslate(vpRect) {
  const maxX = (imgZoomState.scale - 1) * vpRect.width  / 2;
  const maxY = (imgZoomState.scale - 1) * vpRect.height / 2;
  imgZoomState.tx = clamp(imgZoomState.tx, -maxX, maxX);
  imgZoomState.ty = clamp(imgZoomState.ty, -maxY, maxY);
}

export function openImageViewer(startKey) {
  imgState.keys  = imgRecentKeys(startKey);
  imgState.index = Math.max(0, imgState.keys.indexOf(startKey));
  closePdfModal();
  document.getElementById('image-reader').classList.remove('hidden');
  imageViewerShow();
}

export function closeImageViewer() {
  resetImageZoom(false);
  document.getElementById('image-reader').classList.add('hidden');
}

async function imageViewerShow() {
  resetImageZoom(false);
  const key = imgState.keys[imgState.index];
  if(!key) return;
  const img     = document.getElementById('img-reader-img');
  const status  = document.getElementById('img-reader-status');
  const counter = document.getElementById('img-reader-counter');
  const label   = document.getElementById('img-reader-label');
  const btnPrev = document.querySelector('.img-reader-nav-prev');
  const btnNext = document.querySelector('.img-reader-nav-next');

  const parts = key.split('_');
  counter.textContent = `${imgState.index + 1} / ${imgState.keys.length}`;
  label.textContent   = `${parts[0]} — ${srLabel(parts[1])}`;
  btnPrev.disabled = (imgState.index === 0);
  btnNext.disabled = (imgState.index === imgState.keys.length - 1);

  const cached = imgState.cache.get(key);
  if(cached) {
    img.src = cached; img.classList.remove('hidden'); status.classList.add('hidden');
  } else {
    img.classList.add('hidden'); status.classList.remove('hidden'); status.textContent = 'Rendering…';
  }

  const dataURL = await renderClosingImage(key);
  if(imgState.keys[imgState.index] !== key) return; /* user already swiped away */
  if(dataURL) {
    img.src = dataURL; img.classList.remove('hidden'); status.classList.add('hidden');
  } else {
    status.textContent = 'Could not render this record.';
  }

  /* Prefetch neighbors quietly so the next swipe feels instant */
  const nextKey = imgState.keys[imgState.index + 1];
  const prevKeyN = imgState.keys[imgState.index - 1];
  if(nextKey && !imgState.cache.has(nextKey)) renderClosingImage(nextKey);
  if(prevKeyN && !imgState.cache.has(prevKeyN)) renderClosingImage(prevKeyN);
}

export function imageViewerNext() {
  if(imgState.index < imgState.keys.length - 1) { imgState.index++; imageViewerShow(); }
}
export function imageViewerPrev() {
  if(imgState.index > 0) { imgState.index--; imageViewerShow(); }
}

async function shareClosingImage(key) {
  const dataURL = await renderClosingImage(key);
  if(!dataURL) { alert('Could not generate an image for this record.'); return; }
  const parts = key.split('_');
  const fname = `${parts[0]}_${srLabel(parts[1]).replace(/\s+/g,'_')}.png`;
  const blob  = await (await fetch(dataURL)).blob();
  const file  = new File([blob], fname, {type:'image/png'});

  if(navigator.canShare && navigator.canShare({files:[file]})) {
    await navigator.share({ files:[file], title:`Closing — ${parts[0]} ${srLabel(parts[1])}`, text:`Closing sheet for ${parts[0]} — ${srLabel(parts[1])}` });
  } else {
    const a = document.createElement('a'); a.href = dataURL; a.download = fname;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    const msg = encodeURIComponent(`Closing — ${parts[0]} ${srLabel(parts[1])}. Image downloaded — please attach it here.`);
    window.open(`https://wa.me/923028496090?text=${msg}`, '_blank');
  }
}

/* "Send Image to WhatsApp" from within the fullscreen viewer —
   shares whichever record is currently on screen. */
export async function imageViewerShareCurrent() {
  const key = imgState.keys[imgState.index];
  if(key) await shareClosingImage(key);
}

/* "View as Image" from the Export Closing modal */
export function pdfModalViewImage() {
  const key = compState.pdfModalKey;
  if(key) openImageViewer(key);
}

/* "Send Image to WhatsApp" from the Export Closing modal — shares
   immediately without opening the fullscreen viewer. */
export async function pdfModalShareImage() {
  const key = compState.pdfModalKey;
  if(!key) return;
  const statusEl = document.getElementById('pdf-modal-status');
  statusEl.textContent = 'Preparing image…';
  try {
    await shareClosingImage(key);
    statusEl.textContent = '';
    closePdfModal();
  } catch(e) {
    statusEl.textContent = 'Failed: ' + e.message;
  }
}

/* ── Touch gestures, scoped to #img-reader-viewport:
   - One finger, not zoomed  → swipe left/right to move between records
     (same touchstart/end shape as the Closing Book reader's own
     gesture handling in closing-book.js — kept independent, this
     file never imports from closing-book.js, and vice versa).
   - Two fingers             → pinch to zoom (1x–4x), anchored on the
     midpoint between the fingers.
   - One finger, zoomed in   → drag to pan around the zoomed image.
   - Double-tap              → toggle between 1x and 2.5x.
   Zoom/pan state (imgZoomState) resets to 1x whenever the record
   changes or the reader closes, so it never leaks between images. ── */
(function initImageViewerGestures() {
  const vp  = document.getElementById('img-reader-viewport');
  const img = document.getElementById('img-reader-img');
  if(!vp || !img) return;

  let mode = null; /* 'swipe' | 'pinch' | 'pan' */
  let startX = 0, startY = 0;
  let pinchStartDist = 0, pinchStartScale = 1;
  let panStartX = 0, panStartY = 0, panStartTx = 0, panStartTy = 0;
  let lastTapAt = 0;

  const touchDist = (a, b) => Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);

  vp.addEventListener('touchstart', (e) => {
    if(e.touches.length === 2) {
      mode = 'pinch';
      pinchStartDist  = touchDist(e.touches[0], e.touches[1]);
      pinchStartScale = imgZoomState.scale;
      return;
    }
    if(e.touches.length !== 1) { mode = null; return; }

    const now = Date.now();
    if(now - lastTapAt < 300) {
      /* double-tap: toggle zoom */
      lastTapAt = 0;
      mode = null;
      if(imgZoomState.scale > 1) {
        resetImageZoom(true);
      } else {
        imgZoomState.scale = 2.5;
        img.style.transition = 'transform .2s ease';
        applyImageZoom();
        setTimeout(() => { img.style.transition = ''; }, 200);
      }
      return;
    }
    lastTapAt = now;

    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    if(imgZoomState.scale > 1) {
      mode = 'pan';
      panStartX = startX; panStartY = startY;
      panStartTx = imgZoomState.tx; panStartTy = imgZoomState.ty;
    } else {
      mode = 'swipe';
    }
  }, { passive: true });

  vp.addEventListener('touchmove', (e) => {
    if(mode === 'pinch' && e.touches.length === 2) {
      const d = touchDist(e.touches[0], e.touches[1]);
      imgZoomState.scale = clamp(pinchStartScale * (d / pinchStartDist), 1, 4);
      clampImageZoomTranslate(vp.getBoundingClientRect());
      applyImageZoom();
    } else if(mode === 'pan' && e.touches.length === 1) {
      imgZoomState.tx = panStartTx + (e.touches[0].clientX - panStartX);
      imgZoomState.ty = panStartTy + (e.touches[0].clientY - panStartY);
      clampImageZoomTranslate(vp.getBoundingClientRect());
      applyImageZoom();
    }
  }, { passive: true });

  vp.addEventListener('touchend', (e) => {
    if(mode === 'pinch') {
      if(imgZoomState.scale <= 1.02) resetImageZoom(true);
      mode = null;
      return;
    }
    if(mode === 'pan') { mode = null; return; }

    if(mode === 'swipe' && e.changedTouches.length === 1) {
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if(Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if(dx < 0) imageViewerNext(); else imageViewerPrev();
      }
    }
    mode = null;
  }, { passive: true });
})();

/* Escape-to-close for this reader is centralized in app.js's
   ESCAPE_CLOSABLE_MODALS list alongside every other modal — only
   the arrow-key paging (viewer-specific) lives here. */
document.addEventListener('keydown', (e) => {
  const reader = document.getElementById('image-reader');
  if(!reader || reader.classList.contains('hidden')) return;
  if(e.key === 'ArrowRight') imageViewerNext();
  else if(e.key === 'ArrowLeft') imageViewerPrev();
});


export function openEditModal(key) {
  key = key || session.activeKey;
  compState.editModalKey = key;
  const currentMode = db.sheets[key]?.profileMode || 'shift';
  editModalSelectMode(currentMode);
  document.getElementById('edit-modal-pin').value = '';
  document.getElementById('edit-modal-err').textContent = '';
  document.getElementById('edit-modal-overlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('edit-modal-pin').focus(), 120);
}

export function closeEditModal() {
  document.getElementById('edit-modal-overlay').classList.add('hidden');
  compState.editModalKey = null;
}

export function editModalOutsideClick(e) {
  if(e.target === document.getElementById('edit-modal-overlay')) closeEditModal();
}

export function editModalSelectMode(mode) {
  const btnShift = document.getElementById('em-btn-shift');
  const btnFinal = document.getElementById('em-btn-final');
  btnShift.className = 'edit-mode-btn' + (mode === 'shift' ? ' active-shift' : '');
  btnFinal.className = 'edit-mode-btn' + (mode === 'final' ? ' active-final' : '');
  btnShift.dataset.selected = mode === 'shift' ? '1' : '';
}

export function getEditModalMode() {
  return document.getElementById('em-btn-shift').dataset.selected === '1' ? 'shift' : 'final';
}

export function confirmEditModal() {
  const pin = document.getElementById('edit-modal-pin').value;
  const errEl = document.getElementById('edit-modal-err');
  if(!checkPin(pin)) {
    errEl.textContent = 'Incorrect PIN — try again.';
    document.getElementById('edit-modal-pin').value = '';
    document.getElementById('edit-modal-pin').focus();
    return;
  }
  const key     = compState.editModalKey;
  const newMode = getEditModalMode();
  closeEditModal();
  alLog('edit-open', key);
  /* Apply mode change to saved record before opening */
  setSheetProfileMode(key, newMode);
  session.activeKey  = key;
  session.activeMode = newMode;
  session.overrides  = db.sheets[key]?.overrides || {};
  const p    = key.split('_');
  initLedger(p[0], p[1], session.activeMode, { forEdit: true });
  setLockedState(false);
}


export function toggleMoreMenu() {
  const m = document.getElementById('ltb-more-menu');
  if(m) m.classList.toggle('hidden');
}
document.addEventListener('click', function(e) {
  const wrap = document.getElementById('ltb-more-wrap');
  if(wrap && !wrap.contains(e.target)) {
    const m = document.getElementById('ltb-more-menu');
    if(m) m.classList.add('hidden');
  }
});

/* ═══════════════════════════════════════════
   CLEAR ALL FIELDS
═══════════════════════════════════════════ */
export function clearAllFields() {
  if(!confirm('Clear ALL fields on this sheet? This cannot be undone unless you saved a draft.')) return;
  session.overrides = {};
  session.isSavedSheet = false;
  const parts = session.activeKey ? session.activeKey.split('_') : ['',''];
  flushInputs();
  pullPreviousShift(parts[0], parts[1], session.activeMode);
  calc();
}


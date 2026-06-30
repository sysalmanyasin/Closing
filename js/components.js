/* ═══════════════════════════════════════════════════════════════
   FLOOR 4 — COMPONENTS
   Pure UI building blocks: numpad, modal picker, row builders,
   toast, print sheet, PDF/WhatsApp export, edit modal, more menu.
═══════════════════════════════════════════════════════════════ */

let numpadTarget    = null;
let numpadRawStr    = "";
let numpadCallback  = null;

function openNumpad(inputEl, label, onConfirm) {
  numpadTarget   = inputEl;
  numpadCallback = onConfirm || null;
  numpadRawStr   = (inputEl.value && inputEl.value !== "0") ? String(inputEl.value) : "";
  document.getElementById('numpad-label').textContent = label || inputEl.closest('.row')?.querySelector('label,span.row-lbl')?.textContent?.trim() || "Enter value";
  renderNumpadDisplay();
  document.getElementById('numpad-overlay').classList.remove('hidden');
}

function renderNumpadDisplay() {
  const el = document.getElementById('numpad-display');
  el.textContent = numpadRawStr || "0";
  el.className = 'numpad-display ' + (numpadRawStr ? 'has-val' : 'empty-val');
}

function npKey(k) {
  if(k === 'back')  { numpadRawStr = numpadRawStr.slice(0,-1); }
  else if(k === 'clear') { numpadRawStr = ""; }
  else if(k === '.') {
    if(!numpadRawStr.includes('.')) numpadRawStr += (numpadRawStr ? '.' : '0.');
  }
  else {
    if(numpadRawStr.length < 12) numpadRawStr += k;
  }
  renderNumpadDisplay();
}

function npConfirm() {
  if(numpadTarget) {
    numpadTarget.value = numpadRawStr || "0";
    numpadTarget.dispatchEvent(new Event('input', {bubbles:true}));
  }
  if(numpadCallback) numpadCallback(numpadRawStr || "0");
  closeNumpad();
}

function closeNumpad() {
  document.getElementById('numpad-overlay').classList.add('hidden');
  numpadTarget = null; numpadRawStr = ""; numpadCallback = null;
}

function numpadOutsideClick(e) {
  if(e.target === document.getElementById('numpad-overlay')) closeNumpad();
}

/* attach numpad to a number input — NUMPAD DISABLED, using native keyboard */
function attachNumpad(el, label) {
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
let modalPickerTarget   = null;
let modalPickerCallback = null;

function openModalPicker(title, options, currentVal, onPick) {
  modalPickerCallback = onPick;
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

function closeModalPicker() {
  document.getElementById('modal-picker-overlay').classList.add('hidden');
  modalPickerTarget = null; modalPickerCallback = null;
}

/* ═══════════════════════════════════════════
   COLLAPSIBLE CARDS
═══════════════════════════════════════════ */
function toggleCard(id) {
  const card = document.getElementById(id);
  if(!card) return;
  /* Cloud sync card uses a separate explicit body div */
  if(id === 'card-cloud-sync') {
    const body = document.getElementById('card-cloud-sync-body');
    const icon = card.querySelector('.collapse-icon');
    const hidden = body.style.display === 'none';
    body.style.display = hidden ? 'block' : 'none';
    if(icon) icon.textContent = hidden ? '▼' : '▶';
  } else {
    card.classList.toggle('collapsed');
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
};

/* ═══════════════════════════════════════════
   PAGE NAVIGATION
═══════════════════════════════════════════ */

function buildDenomRows() {
  ['denom-till','denom-vault'].forEach((containerId, setIdx) => {
    const box = document.getElementById(containerId);
    box.innerHTML = "";
    const cls = setIdx===0 ? 'till-cell' : 'vault-cell';
    DENOMS.forEach(d => {
      const row = document.createElement('div');
      row.className = "row";
      row.innerHTML = `<label>${d.label}</label><input type="number" class="${cls}" data-mult="${d.mult}" oninput="calc()" value="0">`;
      box.appendChild(row);
      const inp = row.querySelector('input');
      attachNumpad(inp, d.label);
    });
  });
}

/* ═══════════════════════════════════════════
   DYNAMIC ROW BUILDERS
═══════════════════════════════════════════ */
function addHsRow(lbl='', val='') {
  hsRowCount++;
  const id = `hs-row-${hsRowCount}`;
  const row = document.createElement('div');
  row.className = "row"; row.id = id;
  row.innerHTML = `
    <input type="text" class="lbl-input hs-lbl" placeholder="Home Service ${hsRowCount}" value="${lbl}">
    <input type="number" class="hs-val" value="${val||0}" oninput="calc()">
    <button class="del-row-btn" onclick="delRow('${id}',true)">✕</button>`;
  document.getElementById('hs-rows').appendChild(row);
  const inp = row.querySelector('.hs-val');
  attachNumpad(inp);
  calc();
}

function addAuxStripRow(lbl='', price='', qty='') {
  auxStripCount++;
  const id = `aux-strip-row-${auxStripCount}`;
  const sc = document.getElementById('ledger-strips');
  const row = document.createElement('div');
  row.className = "row strip-row"; row.id = id;
  row.innerHTML = `
    <input type="text" class="lbl-input aux-strip-lbl" placeholder="Extra item" value="${lbl}" style="flex:1;">
    <input type="number" class="aux-strip-price" value="${price||0}" oninput="calc()" style="width:80px;">
    <input type="number" class="aux-strip-qty"   value="${qty||0}"   oninput="calc()" style="width:80px;">
    <input type="number" class="aux-strip-total" readonly style="width:80px;">
    <button class="del-row-btn" onclick="delRow('${id}',true)">✕</button>`;
  sc.appendChild(row);
  attachNumpad(row.querySelector('.aux-strip-price'), 'Unit Price');
  attachNumpad(row.querySelector('.aux-strip-qty'),   'Quantity');
  calc();
}

function addNamedCreditRow(lbl, idSuffix) {
  const container = document.getElementById('ledger-named-credits');
  const row = document.createElement('div');
  const rowId = `named-cred-row-${idSuffix}`;
  row.className = "row"; row.id = rowId;
  row.dataset.creditIdx = idSuffix;
  row.innerHTML = `
    <span class="row-lbl named-cred-lbl">${lbl}</span>
    <input type="number" class="named-cred-val" id="in-named-cred-${idSuffix}" value="0" oninput="calc()">`;
  container.appendChild(row);
  const inp = row.querySelector('input');
  attachNumpad(inp, lbl);
}

function addTierCreditRow(num) {
  const container = document.getElementById('ledger-tier-credits');
  const row = document.createElement('div');
  row.className = "row three-col"; row.id = `tier-row-${num}`;
  row.innerHTML = `
    <select id="sel-tier-${num}" onchange="openTierPicker(${num})"></select>
    <select id="sel-name-${num}" onchange="calc()"></select>
    <input type="number" id="in-nested-${num}" oninput="calc()" placeholder="Amount" style="width:100px;">`;
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

function addAuxCreditRow(lbl='', val='') {
  auxCreditCount++;
  const id = `aux-cred-row-${auxCreditCount}`;
  const row = document.createElement('div');
  row.className = "row"; row.id = id;
  row.innerHTML = `
    <input type="text"   class="lbl-input aux-cred-lbl" placeholder="Other account name" value="${lbl}">
    <input type="number" class="aux-cred-val" value="${val||0}" oninput="calc()">
    <button class="del-row-btn" onclick="delRow('${id}',true)">✕</button>`;
  document.getElementById('ledger-aux-credits').appendChild(row);
  attachNumpad(row.querySelector('.aux-cred-val'));
  calc();
}

function addDepositRow(lbl='', val='') {
  depositCount++;
  const id = `dep-row-${depositCount}`;
  const row = document.createElement('div');
  row.className = "row"; row.id = id;
  row.innerHTML = `
    <input type="text"   class="lbl-input dep-lbl" placeholder="Safe drop reference" value="${lbl}">
    <input type="number" class="dep-val" value="${val||0}" oninput="calc()">
    <button class="del-row-btn" onclick="delRow('${id}',true)">✕</button>`;
  document.getElementById('ledger-deposits').appendChild(row);
  attachNumpad(row.querySelector('.dep-val'));
  calc();
}

function addMiscRow(lbl='', val='', status='Active') {
  miscCount++;
  const id = `misc-row-${miscCount}`;
  const row = document.createElement('div');
  row.className = "row misc-row"; row.id = id;
  row.innerHTML = `
    <input type="text"   id="misc-lbl-${miscCount}" class="lbl-input" placeholder="Charge / note" value="${lbl}">
    <input type="number" id="misc-val-${miscCount}" value="${val||0}" style="width:90px;" oninput="calc()">
    <select id="misc-st-${miscCount}" onchange="calc()" style="width:110px;text-align:left;font-size:0.78rem;">
      <option value="Active"    ${status==='Active'?'selected':''}>Active</option>
      <option value="Confirmed" ${status==='Confirmed'?'selected':''}>Confirmed / Nil</option>
      <option value="Cleared"   ${status==='Cleared'?'selected':''}>Cleared / Omit</option>
    </select>
    <button class="del-row-btn" onclick="delRow('${id}',true)">✕</button>`;
  document.getElementById('ledger-misc').appendChild(row);
  const inp = row.querySelector('input[type="number"]');
  attachNumpad(inp);

  /* modal picker for status select */
  const st = row.querySelector('select');
  st.addEventListener('mousedown', function(e) {
    e.preventDefault();
    openModalPicker('Set Status', [
      {value:'Active',    label:'Active'},
      {value:'Confirmed', label:'Confirmed / Nil'},
      {value:'Cleared',   label:'Cleared / Omit'}
    ], st.value, (v) => { st.value = v; calc(); });
  });
  calc();
}

function delRow(id, recalc) {
  const el = document.getElementById(id);
  if(el) el.remove();
  if(recalc) calc();
}

function openTierPicker(num) { /* triggered by change, handled via mousedown */ }

/* ═══════════════════════════════════════════
   LEDGER INIT
═══════════════════════════════════════════ */

let _toastTimer = null;
function showToast(msg, ms = 2200) {
  const el = document.getElementById('app-toast');
  if(!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  if(_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

/* ── SAVE ACTION SHEET ───────────────────────────────────── */
function showSaveAction(title, sub, buttons) {
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


function g(id) { return document.getElementById(id); }
function set(id, v) { const el=g(id); if(el) el.value=v; }
function val(id) { const el=g(id); return el?parseFloat(el.value)||0:0; }

/* A sheet only "counts" for calendar dots, manifest, carry-over,
   and Final aggregation once it has been explicitly Saved
   (saveSheet sets draft=false). Auto-drafts (draft=true) are
   excluded until then. */
function isRealSheet(rec) {
  return !!rec && rec.draft !== true;
}
function getRealSheet(key) {
  const rec = db.sheets[key];
  return isRealSheet(rec) ? rec : null;
}

function timelineStep(ds, shift, n) {
  let d   = new Date(ds);
  let idx = SHIFTS.indexOf(shift) + n;
  if(idx >= SHIFTS.length) {
    d.setDate(d.getDate() + Math.floor(idx/SHIFTS.length)); idx = idx % SHIFTS.length;
  } else if(idx < 0) {
    const steps = Math.ceil(Math.abs(idx)/SHIFTS.length);
    d.setDate(d.getDate() - steps);
    idx = (SHIFTS.length + (idx % SHIFTS.length)) % SHIFTS.length;
  }
  const outDs = d.toISOString().split('T')[0];
  return {key:`${outDs}_${SHIFTS[idx]}`, date:outDs, shift:SHIFTS[idx]};
}

function buildPrintSheet() {
  const parts = activeKey ? activeKey.split('_') : ['',''];
  const ds = parts[0], shift = parts[1];
  const psRow = (label, value, cls='') => `<div class="ps-row ${cls}"><span>${label}</span><span>${value}</span></div>`;
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
      <div class="ps-idchip"><div class="ps-idchip-label">Mode</div><div class="ps-idchip-val">${(activeMode||'shift').toUpperCase()}</div></div>
      <div class="ps-idchip"><div class="ps-idchip-label">Status</div><div class="ps-idchip-val">${isSheetLocked ? 'CLOSED' : 'DRAFT'}</div></div>
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
  document.querySelectorAll('.named-cred-lbl').forEach((lblEl, i) => {
    const valEl = document.querySelectorAll('.named-cred-val')[i];
    if((parseFloat(valEl?.value)||0) !== 0) credRows += psRow(lblEl.textContent, (parseFloat(valEl.value)||0).toLocaleString('en-PK'));
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
    const stNum = row.id.replace('misc-row-','');
    const status = g(`misc-st-${stNum}`)?.value || 'Active';
    if(lbl && status !== 'Cleared') miscRows += psRow(`${lbl} [${status}]`, (parseFloat(v)||0).toLocaleString('en-PK'));
  });
  if(!miscRows) miscRows = psRow('— no active items —', '', 'ps-empty');
  miscRows += psRow('TOTAL MISC', num('out-total-g'), 'ps-total');

  /* Grand Summary box */
  let sumRows = '';
  sumRows += psRow('HS + Strips', (numRaw('out-total-hs')+numRaw('out-total-a')).toLocaleString('en-PK'));
  sumRows += psRow('Misc (active)', num('out-total-g'));
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
            <p>${branchName}</p>
          </div>
          <div class="ps-doctype">
            <span class="ps-doctype-tag">${(activeMode||'shift')==='final'?'Final Closing':'Shift Closing'}</span>
            <div class="ps-doctype-date">${ds || '—'} · ${srLabel(shift)} · ${isSheetLocked?'CLOSED':'DRAFT'} · Generated ${genStamp}</div>
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
            <p>${branchName}</p>
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


async function renderPDF() {
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
let _pdfModalKey = null;

function openPdfModal(key) {
  _pdfModalKey = key;
  document.getElementById('pdf-modal-status').textContent = '';
  document.getElementById('pdf-modal-overlay').classList.remove('hidden');
}

function closePdfModal() {
  document.getElementById('pdf-modal-overlay').classList.add('hidden');
  _pdfModalKey = null;
}

async function pdfModalAction(type) {
  const key = _pdfModalKey;
  if(!key) return;
  const statusEl = document.getElementById('pdf-modal-status');
  statusEl.textContent = type === 'whatsapp' ? 'Preparing PDF…' : 'Generating PDF…';

  /* Temporarily load the sheet into the ledger (hidden) so buildPrintSheet can read DOM */
  const prevKey  = activeKey;
  const prevMode = activeMode;
  activeKey  = key;
  activeMode = db.sheets[key]?.profileMode || 'shift';
  const parts = key.split('_');
  initLedger(parts[0], parts[1], activeMode);
  await new Promise(r => setTimeout(r, 120)); /* let DOM settle */

  try {
    const pdf  = await renderPDF();
    const fname = `${parts[0]}_${srLabel(parts[1]).replace(/\s+/g,'_')}.pdf`;

    if(type === 'print') {
      pdf.save(fname);
      buildPrintSheet();
      const sheet = document.getElementById('print-sheet');
      sheet.classList.add('show');
      setTimeout(() => { window.print(); sheet.classList.remove('show'); }, 200);
      closePdfModal();
    } else {
      const blob = pdf.output('blob');
      const file = new File([blob], fname, {type:'application/pdf'});
      if(navigator.canShare && navigator.canShare({files:[file]})) {
        await navigator.share({ files:[file], title:`Closing — ${parts[0]} ${srLabel(parts[1])}`, text:`Closing sheet for ${parts[0]} — ${srLabel(parts[1])}` });
      } else {
        pdf.save(fname);
        const msg = encodeURIComponent(`Closing — ${parts[0]} ${srLabel(parts[1])}. PDF downloaded — please attach it here.`);
        window.open(`https://wa.me/923028496090?text=${msg}`, '_blank');
      }
      closePdfModal();
    }
  } catch(e) {
    statusEl.textContent = 'Failed: ' + e.message;
  }

  /* Restore previous state */
  activeKey  = prevKey;
  activeMode = prevMode;
  if(prevKey) { const p = prevKey.split('_'); initLedger(p[0], p[1], prevMode); }
  else goToDashboard();
}

function exportPDF() {
  const status = document.getElementById('pdf-status');
  status.style.display='block'; status.textContent='Generating PDF…';
  /* expand all collapsed cards so the printout shows everything */
  document.querySelectorAll('#page-ledger .card.collapsed').forEach(c => c.classList.remove('collapsed'));
  renderPDF().then(pdf => {
    const parts = activeKey ? activeKey.split('_') : ['sheet','closing'];
    const fname = `${parts[0]}_${srLabel(parts[1]).replace(/\s+/g,'_')}.pdf`;
    pdf.save(fname);
    /* also trigger system print dialog for physical print */
    buildPrintSheet();
    const sheet = document.getElementById('print-sheet');
    sheet.classList.add('show');
    setTimeout(() => { window.print(); sheet.classList.remove('show'); }, 200);
    status.style.display='none';
  }).catch(e => { status.textContent='PDF failed: '+e.message; });
}

function sendWhatsApp() {
  const status = document.getElementById('pdf-status');
  status.style.display='block'; status.textContent='Preparing PDF for WhatsApp…';
  const parts = activeKey ? activeKey.split('_') : ['sheet','closing'];
  const fname = `${parts[0]}_${srLabel(parts[1]).replace(/\s+/g,'_')}.pdf`;
  renderPDF().then(async pdf => {
    const blob = pdf.output('blob');
    const file = new File([blob], fname, {type:'application/pdf'});
    if(navigator.canShare && navigator.canShare({files:[file]})) {
      await navigator.share({
        files:[file],
        title: `PharmaPos Closing — ${parts[0]} ${srLabel(parts[1])}`,
        text: `Closing sheet for ${parts[0]} — ${srLabel(parts[1])}`
      });
      status.style.display='none';
    } else {
      /* fallback: download PDF and open WhatsApp chat for manual attach */
      pdf.save(fname);
      const msg = encodeURIComponent(`PharmaPos Closing — ${parts[0]} ${srLabel(parts[1])}. PDF downloaded — please attach it here.`);
      window.open(`https://wa.me/923028496090?text=${msg}`, '_blank');
      status.style.display='none';
    }
  }).catch(e => { status.textContent='WhatsApp share failed: '+e.message; });
}


let _editModalKey = null;

function openEditModal(key) {
  _editModalKey = key;
  const currentMode = db.sheets[key]?.profileMode || 'shift';
  editModalSelectMode(currentMode);
  document.getElementById('edit-modal-pin').value = '';
  document.getElementById('edit-modal-err').textContent = '';
  document.getElementById('edit-modal-overlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('edit-modal-pin').focus(), 120);
}

function closeEditModal() {
  document.getElementById('edit-modal-overlay').classList.add('hidden');
  _editModalKey = null;
}

function editModalOutsideClick(e) {
  if(e.target === document.getElementById('edit-modal-overlay')) closeEditModal();
}

function editModalSelectMode(mode) {
  const btnShift = document.getElementById('em-btn-shift');
  const btnFinal = document.getElementById('em-btn-final');
  btnShift.className = 'edit-mode-btn' + (mode === 'shift' ? ' active-shift' : '');
  btnFinal.className = 'edit-mode-btn' + (mode === 'final' ? ' active-final' : '');
  btnShift.dataset.selected = mode === 'shift' ? '1' : '';
}

function getEditModalMode() {
  return document.getElementById('em-btn-shift').dataset.selected === '1' ? 'shift' : 'final';
}

function confirmEditModal() {
  const pin = document.getElementById('edit-modal-pin').value;
  const errEl = document.getElementById('edit-modal-err');
  if(pin !== PIN) {
    errEl.textContent = 'Incorrect PIN — try again.';
    document.getElementById('edit-modal-pin').value = '';
    document.getElementById('edit-modal-pin').focus();
    return;
  }
  const key     = _editModalKey;
  const newMode = getEditModalMode();
  closeEditModal();
  /* Apply mode change to saved record before opening */
  if(db.sheets[key] && db.sheets[key].profileMode !== newMode) {
    db.sheets[key].profileMode = newMode;
    persist();
  }
  activeKey  = key;
  activeMode = newMode;
  overrides  = db.sheets[key]?.overrides || {};
  const p    = key.split('_');
  initLedger(p[0], p[1], activeMode);
  setLockedState(false);
}


function toggleMoreMenu() {
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
   COLLAPSE / EXPAND ALL
═══════════════════════════════════════════ */
function collapseAllCards() {
  document.querySelectorAll('#page-ledger .card').forEach(c => c.classList.add('collapsed'));
}
function expandAllCards() {
  document.querySelectorAll('#page-ledger .card').forEach(c => c.classList.remove('collapsed'));
}

/* ═══════════════════════════════════════════
   CLEAR ALL FIELDS
═══════════════════════════════════════════ */
function clearAllFields() {
  if(!confirm('Clear ALL fields on this sheet? This cannot be undone unless you saved a draft.')) return;
  overrides = {};
  isSavedSheet = false;
  const parts = activeKey ? activeKey.split('_') : ['',''];
  flushInputs();
  pullPreviousShift(parts[0], parts[1], activeMode);
  calc();
}


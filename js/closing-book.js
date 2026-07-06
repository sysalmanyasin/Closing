/* ═══════════════════════════════════════════════════════════════
   FLOOR 5 (Extension) — CLOSING BOOK
   Assembles every closing in a date/shift range into a single
   flip-through "book" — reusing the exact same print-sheet markup
   already used for individual PDF exports, so the book looks
   identical to the printed register. Assembly is cached per range
   (invalidated only if the underlying sheet data actually changes);
   the reader supports swipe/next-prev paging, zoom (1x/2x/4x/8x,
   plus pinch), a jump-to-date dropdown, and resumes on the last
   page you were viewing. Export produces one multi-page PDF named
   "{Brand} Closing {FromShift} {FromDate} to {ToShift} {ToDate}".
   Reads/renders like Pages (Floor 5); calls into Actions (Floor 3)
   to build each sheet, same as the rest of the app.
═══════════════════════════════════════════════════════════════ */

import { repoGetLocal, repoSetLocal } from './repository.js';
import { daySlots, db, getSeq, srLabel, session } from './state.js';
import { initLedger, setLockedState } from './actions.js';
import { buildPrintSheet, timelineStep } from './components.js';
import { sheetSortKey } from './pages.js';

/* CRITICAL: never use Date#toISOString() to derive a "date string" here.
   toISOString() always converts to UTC — for any timezone AHEAD of UTC
   (Pakistan is UTC+5, the app's real deployment timezone), local midnight
   lands on the PREVIOUS UTC calendar day, silently shifting every date
   in the book back by one and breaking every db.sheets[key] lookup.
   This reads the Date object's LOCAL year/month/day instead, which is
   what session.activeKey/db.sheets keys are actually built from everywhere else
   in the app (via date-picker input values, not UTC conversion). */
export function _cbLocalDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}


/* This file's own transient state — file-local, never read by
   another floor directly. cbIsAssembling() below is the one
   sanctioned peek Actions (Floor 3) is allowed. */
const cbState = {
  cache:           {},   /* cacheKey -> { pages, fingerprint, builtAt } */
  currentCacheKey: null,
  currentPage:     0,
  zoom:            1,
  assemblyMode:    false /* guards scheduleAutoSave() while looping through sheets */
};

/* Accessor for Actions (Floor 3) — see scheduleAutoSave() in
   actions.js — instead of it reaching into cbState directly. */
export function cbIsAssembling() { return cbState.assemblyMode; }

/* ── Defaults when the tab is opened ─────────────────────── */
export function initClosingBookDefaults() {
  const fromEl = document.getElementById('cb-from-date');
  const toEl   = document.getElementById('cb-to-date');
  if(fromEl && !fromEl.value) setClosingBookShortcut(3);
}

export function setClosingBookShortcut(days) {
  const today = new Date();
  const from  = new Date(today);
  from.setDate(from.getDate() - (days - 1));
  document.getElementById('cb-from-date').value  = _cbLocalDateStr(from);
  document.getElementById('cb-from-shift').value = 'Night';
  document.getElementById('cb-to-date').value    = _cbLocalDateStr(today);
  document.getElementById('cb-to-shift').value   = 'Evening';
}

/* "Last N Closings" — counts back N individual shifts (not calendar
   days), anchored on the LAST SAVED shift (not just "today's Evening",
   since today may not have a full day of closings yet). Falls back to
   today's Evening only if nothing has ever been saved. Uses the same
   Night→Morning→Evening step function (timelineStep) the rest of the
   app uses for chronology. */
export function setClosingBookShortcutClosings(n) {
  const savedKeys = Object.keys(db.sheets).filter(k => db.sheets[k] && db.sheets[k].draft !== true);

  let toDs, toShift;
  if(savedKeys.length) {
    savedKeys.sort((a, b) => sheetSortKey(a).localeCompare(sheetSortKey(b)));
    const lastParts = savedKeys[savedKeys.length - 1].split('_');
    toDs    = lastParts[0];
    toShift = lastParts[1];
  } else {
    toDs    = _cbLocalDateStr(new Date());
    toShift = 'Evening';
  }

  const start = timelineStep(toDs, toShift, -(n - 1));
  document.getElementById('cb-from-date').value  = start.date;
  document.getElementById('cb-from-shift').value = start.shift;
  document.getElementById('cb-to-date').value    = toDs;
  document.getElementById('cb-to-shift').value   = toShift;
}

/* ── Range enumeration: walks calendar day-by-day, and for EACH day
   asks state.js's daySlots() what actually exists that day — Night
   and Evening always, plus whatever real middle closings/Handovers
   are saved — rather than assuming a fixed 3-name array. For a date
   with no Handovers this produces exactly Night→Morning→Evening,
   same as before; a date with a Handover includes it in the right
   spot automatically. ─────────────────────────────────────────── */
export function enumerateClosingBookEntries(fromDs, fromShift, toDs, toShift) {
  const entries = [];
  let d = new Date(fromDs + 'T00:00:00');
  const end = new Date(toDs + 'T00:00:00');

  while(d <= end) {
    const ds = _cbLocalDateStr(d);
    const isFirstDay = (ds === fromDs);
    const isLastDay  = (ds === toDs);
    const slots   = daySlots(ds); /* [{shift, seq}, ...] already in seq order */
    const fromIdx = isFirstDay ? slots.findIndex(s => s.shift === fromShift) : -1;
    const toIdx   = isLastDay  ? slots.findIndex(s => s.shift === toShift)   : -1;
    slots.forEach((s, idx) => {
      if(isFirstDay && fromIdx !== -1 && idx < fromIdx) return;
      if(isLastDay  && toIdx   !== -1 && idx > toIdx)   return;
      entries.push({ date: ds, shift: s.shift, key: `${ds}_${s.shift}` });
    });
    d.setDate(d.getDate() + 1);
  }
  return entries;
}

/* ── Cheap content fingerprint for cache invalidation ────────
   Any edit to a sheet changes its JSON, so this changes too —
   that's all "unless underlying sheet data changed" needs. ──── */
export function _cbHashStr(s) {
  let h = 0;
  for(let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return h;
}
export function computeClosingBookFingerprint(entries) {
  return entries.map(e => {
    const rec = db.sheets[e.key];
    return rec ? (e.key + ':' + _cbHashStr(JSON.stringify(rec))) : (e.key + ':none');
  }).join('|');
}

/* ── Cover & placeholder pages (styled to match the print sheet) ── */
export function buildClosingBookCoverPage(entries, fromDs, fromShift, toDs, toShift) {
  const recorded = entries.filter(e => db.sheets[e.key]).length;
  const finals   = entries.filter(e => db.sheets[e.key] && db.sheets[e.key].profileMode === 'final').length;
  const drafts   = entries.filter(e => db.sheets[e.key] && db.sheets[e.key].draft === true).length;
  const missing  = entries.length - recorded;
  const branchName = db.settings.branchName || 'Bahria Town Branch';
  const genStamp = new Date().toLocaleString('en-PK', {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
  const stat = (label, val) => `<div class="cb-stat"><div class="cb-stat-val">${val}</div><div class="cb-stat-label">${label}</div></div>`;

  return `
    <div class="ps-page cb-cover-page">
      <div class="ps-content" style="margin-left:0;padding:70px 55px;">
        <div class="ps-letterhead" style="border-bottom:2px solid #1c2b2b;padding-bottom:16px;">
          <div class="ps-brand">
            <h1>Fazal Din's Pharma Plus</h1>
            <p>${branchName}</p>
          </div>
        </div>
        <div class="cb-cover-title">📖 Closing Book</div>
        <div class="cb-cover-range">${fromDs} · ${srLabel(fromShift)}<br><span class="cb-cover-arrow">↓</span><br>${toDs} · ${srLabel(toShift)}</div>
        <div class="cb-cover-stats">
          ${stat('Shifts in Range', entries.length)}
          ${stat('Recorded', recorded)}
          ${stat('Final Closings', finals)}
          ${stat('Still Draft', drafts)}
          ${stat('Missing', missing)}
        </div>
        <div class="cb-cover-gen">Generated ${genStamp}</div>
      </div>
    </div>`;
}

export function buildClosingBookPlaceholderPage(e) {
  return `
    <div class="ps-page cb-placeholder-page">
      <div class="ps-content" style="margin-left:0;height:100%;display:flex;align-items:center;justify-content:center;">
        <div style="text-align:center;color:#94a3b8;">
          <div style="font-size:3.2rem;">🗒️</div>
          <div style="font-size:1.15rem;font-weight:700;margin-top:14px;color:#64748b;">No closing recorded</div>
          <div style="font-size:1rem;margin-top:6px;">${e.date} · ${srLabel(e.shift)}</div>
        </div>
      </div>
    </div>`;
}

/* ── Assembly ─────────────────────────────────────────────── */
export async function generateClosingBook() {
  const fromDs    = document.getElementById('cb-from-date').value;
  const fromShift = document.getElementById('cb-from-shift').value;
  const toDs      = document.getElementById('cb-to-date').value;
  const toShift   = document.getElementById('cb-to-shift').value;
  const statusEl  = document.getElementById('cb-generate-status');
  const genBtn    = document.getElementById('cb-generate-btn');

  if(cbState.assemblyMode) return; /* already assembling — ignore a double-tap rather than run two overlapping loops */

  if(!fromDs || !toDs) { alert('Pick both a "From" and "To" date.'); return; }

  const fromCmp = fromDs + '_' + String(getSeq(fromDs, fromShift)).padStart(6,'0');
  const toCmp   = toDs   + '_' + String(getSeq(toDs, toShift)).padStart(6,'0');
  if(fromCmp > toCmp) { alert('The "From" point must be before or equal to the "To" point.'); return; }

  const entries = enumerateClosingBookEntries(fromDs, fromShift, toDs, toShift);
  if(!entries.length) { alert('No shifts fall in that range.'); return; }
  if(entries.length > 120 && !confirm(`This range covers ${entries.length} shifts and may take a little while to assemble. Continue?`)) return;

  const cacheKey    = `${fromDs}_${fromShift}__${toDs}_${toShift}`;
  const fingerprint = computeClosingBookFingerprint(entries);
  const cached      = cbState.cache[cacheKey];

  if(cached && cached.fingerprint === fingerprint) {
    openClosingBookReader(cacheKey);
    return;
  }

  statusEl.classList.remove('hidden');
  statusEl.textContent = `Assembling book… 0 / ${entries.length}`;
  if(genBtn) genBtn.disabled = true;

  /* remember whatever ledger context was open so we can restore it
     after looping through every sheet in the range */
  const savedActiveKey   = session.activeKey;
  const savedActiveMode  = session.activeMode;
  const savedOverrides   = session.overrides;
  /* if the user had a locked/saved sheet unlocked for editing via PIN
     right now, remember that — otherwise restoring it below would leave
     it looking locked again, forcing them to re-enter the PIN even
     though nothing they'd typed was lost (drafts auto-save regardless). */
  const savedWasUnlockedForEdit = !!(savedActiveKey && !session.isSheetLocked && db.sheets[savedActiveKey] && db.sheets[savedActiveKey].draft !== true);

  cbState.assemblyMode = true;

  try {
    const pages = [{ type: 'cover', html: buildClosingBookCoverPage(entries, fromDs, fromShift, toDs, toShift), label: 'Cover' }];

    for(let i = 0; i < entries.length; i++) {
      const e   = entries[i];
      const rec = db.sheets[e.key];
      const pageLabel = `${e.date} · ${srLabel(e.shift)}`;

      if(!rec) {
        pages.push({ type: 'placeholder', html: buildClosingBookPlaceholderPage(e), date: e.date, shift: e.shift, label: pageLabel });
      } else {
        session.activeKey  = e.key;
        session.activeMode = rec.profileMode || 'shift';
        session.overrides  = rec.overrides || {};
        initLedger(e.date, e.shift, session.activeMode, { silent: true });
        buildPrintSheet();

        const sheetEl   = document.getElementById('print-sheet');
        const shiftPage = sheetEl ? sheetEl.querySelector('.ps-page-shift') : null;
        pages.push({ type: 'shift', html: shiftPage ? shiftPage.outerHTML : '', date: e.date, shift: e.shift, label: pageLabel });

        /* last entry in the range always also gets the Final
           Aggregation page, even for an ordinary shift closing */
        if(i === entries.length - 1) {
          const finalPage = sheetEl ? sheetEl.querySelector('.ps-page-final') : null;
          if(finalPage) pages.push({ type: 'final', html: finalPage.outerHTML, date: e.date, shift: e.shift, label: pageLabel + ' — Final Aggregation' });
        }
      }

      statusEl.textContent = `Assembling book… ${i + 1} / ${entries.length}`;
      if(i % 5 === 4) await new Promise(r => setTimeout(r, 0)); /* yield so the UI doesn't lock up */
    }

    cbState.cache[cacheKey] = { pages, fingerprint, builtAt: Date.now() };
  } catch(err) {
    console.error('Closing Book assembly failed:', err);
    alert('Something went wrong assembling the book. Please try again — if it keeps happening, try a smaller date range.');
    return;
  } finally {
    /* guaranteed to run even on error, so a bad sheet can't permanently
       strand assembly mode as "on" (which would silently block every
       future attempt) or leave the ledger context unrestored */
    cbState.assemblyMode = false;
    if(genBtn) genBtn.disabled = false;
    statusEl.classList.add('hidden');

    if(savedActiveKey) {
      session.activeKey  = savedActiveKey;
      session.activeMode = savedActiveMode;
      session.overrides  = savedOverrides;
      const p = savedActiveKey.split('_');
      initLedger(p[0], p[1], savedActiveMode, { forEdit: savedWasUnlockedForEdit, silent: true });
      if(savedWasUnlockedForEdit) setLockedState(false);
    }
  }

  openClosingBookReader(cacheKey);
}

/* ── Reader ───────────────────────────────────────────────── */
export function openClosingBookReader(cacheKey) {
  cbState.currentCacheKey = cacheKey;
  document.getElementById('cb-reader').classList.remove('hidden');
  populateClosingBookJumpSelect();

  const pages    = cbState.cache[cacheKey].pages;
  const lastPage = parseInt(repoGetLocal('cb-last-page:' + cacheKey), 10);
  cbState.currentPage = (!isNaN(lastPage) && lastPage >= 0 && lastPage < pages.length) ? lastPage : 0;
  cbState.zoom = 1;
  renderClosingBookPage();
}

/* Exits the fullscreen reader back to the Closing Book tab. The
   assembled book stays cached (cbState.cache), so re-opening it — either
   via the range picker's Generate button or by navigating back here —
   shows the same book instantly instead of rebuilding it. */
export function closeClosingBookReader() {
  document.getElementById('cb-reader').classList.add('hidden');
}

export function populateClosingBookJumpSelect() {
  const sel   = document.getElementById('cb-jump-select');
  const pages = cbState.cache[cbState.currentCacheKey].pages;
  sel.innerHTML = pages.map((p, i) => `<option value="${i}">${i === 0 ? '📕 Cover' : (i + 1) + '. ' + p.label}</option>`).join('');
}

export function _cbComputeFitScale() {
  const vp = document.getElementById('cb-viewport');
  if(!vp || !vp.clientWidth) return 0.4;
  return Math.max(0.18, (vp.clientWidth - 20) / 794);
}

export function _cbApplyStageScale() {
  const scale = _cbComputeFitScale() * cbState.zoom;
  const stage = document.getElementById('cb-page-stage');
  const sizer = document.getElementById('cb-page-sizer');
  if(stage) stage.style.transform = `scale(${scale})`;
  /* transform:scale() only changes what's painted, not the element's
     box for scrolling purposes — without this, most of a zoomed page
     is visually "there" but unreachable, with no way to scroll to it.
     Sizing the wrapper to the real scaled pixel dimensions gives the
     viewport's overflow:auto something genuine to scroll to. */
  if(sizer) {
    sizer.style.width  = (794  * scale) + 'px';
    sizer.style.height = (1123 * scale) + 'px';
  }
  const vp = document.getElementById('cb-viewport');
  if(vp) vp.classList.toggle('cb-viewport-zoomed', cbState.zoom > 1);
}

export function renderClosingBookPage() {
  const cache = cbState.cache[cbState.currentCacheKey];
  if(!cache) return;
  const pages = cache.pages;
  const stage = document.getElementById('cb-page-stage');

  stage.innerHTML = pages[cbState.currentPage].html;
  _cbApplyStageScale();

  document.getElementById('cb-page-counter').textContent = `${cbState.currentPage + 1} / ${pages.length}`;
  document.getElementById('cb-jump-select').value = cbState.currentPage;
  document.getElementById('cb-btn-prev').disabled = (cbState.currentPage === 0);
  document.getElementById('cb-btn-next').disabled = (cbState.currentPage === pages.length - 1);

  const vp = document.getElementById('cb-viewport');
  vp.scrollTop = 0; vp.scrollLeft = 0;

  repoSetLocal('cb-last-page:' + cbState.currentCacheKey, String(cbState.currentPage));
}

/* cheap re-scale during a live pinch gesture — no HTML re-injection */
export function _cbApplyZoomOnly() {
  _cbApplyStageScale();
}

export function closingBookNext() {
  const pages = cbState.cache[cbState.currentCacheKey]?.pages;
  if(pages && cbState.currentPage < pages.length - 1) { cbState.currentPage++; renderClosingBookPage(); }
}
export function closingBookPrev() {
  if(cbState.currentPage > 0) { cbState.currentPage--; renderClosingBookPage(); }
}
export function closingBookJump(idxStr) {
  const idx = parseInt(idxStr, 10);
  if(!isNaN(idx)) { cbState.currentPage = idx; renderClosingBookPage(); }
}
export function closingBookZoom(z) {
  cbState.zoom = z;
  renderClosingBookPage();
}

/* ── Swipe to turn pages (only at 1x — pinch/pan takes over once
   zoomed) & pinch-to-zoom, both scoped to #cb-viewport ─────────── */
(function initClosingBookGestures() {
  const vp = document.getElementById('cb-viewport');
  if(!vp) return;

  let swipeStartX = 0, swipeStartY = 0, swiping = false;
  let pinchStartDist = 0, pinchStartZoom = 1;

  const dist = (t) => {
    const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  vp.addEventListener('touchstart', (e) => {
    if(e.touches.length === 2) {
      swiping = false;
      pinchStartDist = dist(e.touches);
      pinchStartZoom = cbState.zoom;
    } else if(e.touches.length === 1 && cbState.zoom === 1) {
      swiping = true;
      swipeStartX = e.touches[0].clientX;
      swipeStartY = e.touches[0].clientY;
    } else {
      swiping = false;
    }
  }, { passive: true });

  vp.addEventListener('touchmove', (e) => {
    if(e.touches.length === 2 && pinchStartDist > 0) {
      const scale = dist(e.touches) / pinchStartDist;
      cbState.zoom = Math.min(8, Math.max(1, pinchStartZoom * scale));
      _cbApplyZoomOnly();
    }
  }, { passive: true });

  vp.addEventListener('touchend', (e) => {
    if(e.touches.length < 2) pinchStartDist = 0;
    if(swiping && e.changedTouches.length === 1) {
      const dx = e.changedTouches[0].clientX - swipeStartX;
      const dy = e.changedTouches[0].clientY - swipeStartY;
      if(Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if(dx < 0) closingBookNext(); else closingBookPrev();
      }
    }
    swiping = false;
    /* settle the scale after a pinch ends without re-injecting HTML */
    if(pinchStartDist === 0) _cbApplyStageScale();
  }, { passive: true });

  window.addEventListener('resize', () => { if(cbState.currentCacheKey) _cbApplyZoomOnly(); });
})();

/* ── Desktop input: no touch/swipe on a mouse, so give the reader
   keyboard equivalents. Scoped to only fire while the reader is open,
   so arrow keys don't hijack typing elsewhere in the app. Panning a
   zoomed page and mouse-wheel scrolling already work for free — the
   viewport is a plain overflow:auto box with visible scrollbars. ── */
document.addEventListener('keydown', (e) => {
  const reader = document.getElementById('cb-reader');
  if(!reader || reader.classList.contains('hidden')) return;
  if(e.key === 'ArrowRight')      { e.preventDefault(); closingBookNext(); }
  else if(e.key === 'ArrowLeft')  { e.preventDefault(); closingBookPrev(); }
  else if(e.key === 'Escape')     { e.preventDefault(); closeClosingBookReader(); }
});

/* ── Export as one multi-page PDF ────────────────────────────
   "{Brand} Closing {FromShift} {FromDate} to {ToShift} {ToDate}" */
export async function exportClosingBookPdf() {
  const cache = cbState.cache[cbState.currentCacheKey];
  if(!cache) return;

  const btn = document.getElementById('cb-btn-export');
  const originalText = btn.textContent;
  btn.disabled = true;

  const holder = document.createElement('div');
  holder.className = 'ps-sheet-scope';
  holder.style.cssText = 'position:fixed;left:0;top:0;z-index:-1;background:#fff;';
  document.body.appendChild(holder);

  try {
    const { jsPDF } = window.jspdf;
    const pdf   = new jsPDF('p', 'mm', 'a4');
    const pageW = 210, pageH = 297;
    const pages = cache.pages;

    for(let i = 0; i < pages.length; i++) {
      btn.textContent = `⏳ Rendering PDF… ${Math.round((i / pages.length) * 100)}%`;
      holder.innerHTML = pages[i].html;
      const pageEl = holder.firstElementChild;
      await new Promise(r => setTimeout(r, 30));
      const canvas = await html2canvas(pageEl, { scale: 2, useCORS: true, width: 794, height: 1123, windowWidth: 794 });
      if(i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pageW, pageH);
    }

    const [fromKey, toKey]       = cbState.currentCacheKey.split('__');
    const [fromDs, fromShift]    = fromKey.split('_');
    const [toDs, toShift]        = toKey.split('_');
    const brand   = db.settings.bookBrandCode || 'FDPP BT';
    const fmtDate = ds => new Date(ds + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const filename = `${brand} Closing ${fromShift} ${fmtDate(fromDs)} to ${toShift} ${fmtDate(toDs)}.pdf`;

    pdf.save(filename);
  } finally {
    document.body.removeChild(holder);
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

/* ═══════════════════════════════════════════════════════════════
   UX PASS TESTS — sync status chip, accessibility enhancer,
   menu-only walkthrough, and CSS/markup guards for the phone pass
   (text floor, safe-area, viewport, service-worker shell).
   Loads the REAL index.html into jsdom, same approach as the
   end-to-end test.
═══════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const html = read('../index.html');
const css  = read('../css/main.css');
const sw   = read('../sw.js');
const nav  = read('../js/ledger-nav.js');

const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
global.window   = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.localStorage = dom.window.localStorage;
global.alert = () => {};
global.confirm = () => true;
if(!dom.window.matchMedia) dom.window.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){} });
dom.window.Element.prototype.scrollIntoView = () => {};

const { syncChipFor } = await import('../js/sync.js');
const { enhanceA11y } = await import('../js/a11y.js');
const WT = await import('../js/walkthrough.js');

/* ── #3 Sync status chip ───────────────────────────────────── */
test('sync chip: wording and state for every sync condition', () => {
  assert.deepEqual(
    (({ state, label }) => ({ state, label }))(syncChipFor('ok', 'Synced at 6:30:12 pm (14 records)')),
    { state: 'ok', label: 'Saved ✓' });
  assert.equal(syncChipFor('busy', 'Syncing to cloud…').label, 'Syncing…');
  assert.equal(syncChipFor('busy', 'Checking for updates…').state, 'busy');
  assert.equal(syncChipFor('offline', 'x').label, 'Offline, will sync');
  assert.equal(syncChipFor('error', 'Upload failed: boom', true).state, 'offline', 'a failure while offline is "offline", not "failed"');
  assert.equal(syncChipFor('error', 'Upload failed: boom', false).label, 'Sync failed, tap to retry');
  assert.equal(syncChipFor('error', 'Sync error: Network error').state, 'error');
  assert.equal(syncChipFor('error', 'Supabase unreachable — retrying…').state, 'error');
  assert.equal(syncChipFor('error', 'Live sync unavailable — TIMED_OUT (still syncing on save/reload)').state, 'warn');
  assert.equal(syncChipFor('ok', 'Live sync connected').state, 'info');
  assert.ok(syncChipFor('ok', 'x'.repeat(200)).label.length <= 40, 'info labels are truncated for the bar');
});

test('sync chip: the full technical text is kept for the tooltip', () => {
  assert.equal(syncChipFor('error', 'Upload failed: row level security').detail, 'Upload failed: row level security');
});

test('sync chip: markup is a keyboard-operable status button wired to the retry handler', () => {
  const tb = document.getElementById('sync-topbar');
  assert.equal(tb.getAttribute('role'), 'button');
  assert.equal(tb.getAttribute('tabindex'), '0');
  assert.match(tb.getAttribute('onclick'), /syncTopbarTap\(\)/);
  assert.equal(document.getElementById('sync-tb-text').getAttribute('aria-live'), 'polite');
});

/* ── #9 Viewport + safe areas ──────────────────────────────── */
test('viewport: viewport-fit=cover and safe-area padding are present', () => {
  const vp = document.querySelector('meta[name="viewport"]').getAttribute('content');
  assert.match(vp, /viewport-fit=cover/);
  assert.match(css, /body \{[^}]*env\(safe-area-inset-top\)[^}]*env\(safe-area-inset-bottom\)/s);
  assert.match(css, /#sync-topbar \{[^}]*env\(safe-area-inset-top\)/s);
  assert.match(css, /\.save-action-sheet \{[^}]*env\(safe-area-inset-bottom\)/s);
});

/* ── #1 Text size ──────────────────────────────────────────── */
test('text size: nothing below 0.72rem, and only dense report grids below 0.8rem', () => {
  const small = [];
  let printDepth = null, depth = 0;
  css.split('\n').forEach((line, i) => {
    if(printDepth === null && line.trim().startsWith('@media print')) printDepth = depth;
    const m = line.match(/font-size:\s*(0\.\d+)rem/);
    if(m && printDepth === null && parseFloat(m[1]) < 0.8) small.push({ line: i + 1, size: parseFloat(m[1]), text: line.trim() });
    depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
    if(printDepth !== null && depth <= printDepth) printDepth = null;
  });
  assert.ok(small.every(s => s.size >= 0.72), 'floor is 0.72rem: ' + JSON.stringify(small.filter(s => s.size < 0.72)));
  /* The few allowed exceptions are the 10-column report grids and the desktop-only sidebar caption */
  assert.ok(small.length <= 17, `unexpectedly many sub-0.8rem sizes: ${small.length}`);
});

test('touch targets: 44px rules exist for row controls and the remove/undo buttons', () => {
  assert.match(css, /\.del-row-btn \{[^}]*min-width: 44px; min-height: 44px/s);
  assert.match(css, /\.row input\[type="number"\][^{]*\{\s*min-height: 44px/s);
});

/* ── #8 Accessibility ──────────────────────────────────────── */
test('a11y: after enhancement every button in the shipped markup has an accessible name', () => {
  enhanceA11y(document);
  const nameless = Array.from(document.querySelectorAll('button, [role="button"]')).filter(b => {
    const name = b.getAttribute('aria-label') || b.getAttribute('aria-labelledby') || b.textContent;
    return !/[\p{L}\p{N}]/u.test(name || '');
  });
  assert.equal(nameless.length, 0, 'unnamed buttons: ' + nameless.map(b => b.outerHTML.slice(0, 80)).join(' | '));
});

test('a11y: clickable divs/spans become focusable buttons; backdrops and no-op headers do not', () => {
  document.body.insertAdjacentHTML('beforeend',
    '<div id="t-click" onclick="x()">tap</div>' +
    '<div id="t-overlay" onclick="x()"><p>backdrop</p></div>');
  enhanceA11y(document);
  const c = document.getElementById('t-click');
  assert.equal(c.getAttribute('role'), 'button');
  assert.equal(c.getAttribute('tabindex'), '0');
  assert.equal(document.getElementById('t-overlay').getAttribute('role'), 'dialog', '-overlay ids are dialogs, not buttons');
  const sectionHead = document.querySelector('.ledger-section > .card-head');
  assert.ok(sectionHead && !sectionHead.hasAttribute('role'), 'ledger section headers stay non-interactive (focus mode no-op)');
});

test('a11y: existing attributes are never overwritten, unlabeled inputs get a name', () => {
  document.body.insertAdjacentHTML('beforeend',
    '<button id="t-b1" aria-label="Keep me" title="Other">✕</button>' +
    '<button id="t-b2" title="Remove row">✕</button>' +
    '<div class="row"><label>Total Credit:</label><input id="t-in" type="number"></div>');
  enhanceA11y(document);
  assert.equal(document.getElementById('t-b1').getAttribute('aria-label'), 'Keep me');
  assert.equal(document.getElementById('t-b2').getAttribute('aria-label'), 'Remove row');
  assert.equal(document.getElementById('t-in').getAttribute('aria-label'), 'Total Credit');
});

test('a11y: variance banner has non-color indicators', () => {
  assert.match(css, /\[data-state="less"\]::before \{ content: "▼ "/);
  assert.match(css, /\[data-state="plus"\]::before \{ content: "▲ "/);
  assert.match(css, /:focus-visible \{\s*outline: 3px solid/);
});

/* ── #10 Walkthrough ───────────────────────────────────────── */
test('walkthrough: covers every ledger section chip, in order, exactly once', () => {
  const labels = [...nav.matchAll(/label:\s*'([^']+)'/g)].map(m => m[1]);
  assert.ok(labels.length >= 14, 'expected the ledger section list');
  const covered = WT.WALKTHROUGH_STEPS.flatMap(s => s.chips || []);
  assert.deepEqual(covered, labels);
});

test('walkthrough: opens only on request, steps through, and closes', () => {
  const before = document.getElementById('walkthrough-overlay');
  assert.ok(!before || before.classList.contains('hidden'), 'must not be open until asked');

  WT.openWalkthrough();
  const ov = document.getElementById('walkthrough-overlay');
  assert.ok(ov && !ov.classList.contains('hidden'));
  assert.equal(ov.getAttribute('role'), 'dialog');
  assert.equal(document.getElementById('wt-count').textContent, `Step 1 of ${WT.WALKTHROUGH_STEPS.length}`);
  assert.ok(document.getElementById('wt-back').classList.contains('hidden'), 'no Back on the first step');

  for(let i = 1; i < WT.WALKTHROUGH_STEPS.length; i++) document.getElementById('wt-next').click();
  assert.equal(document.getElementById('wt-next').textContent, 'Got it');
  document.getElementById('wt-next').click();
  assert.ok(ov.classList.contains('hidden'));

  WT.openWalkthrough();
  document.getElementById('wt-skip').click();
  assert.ok(ov.classList.contains('hidden'));
});

test('walkthrough: never auto-opens when a sheet is opened', async () => {
  const actions = read('../js/actions.js');
  assert.ok(!/walkthrough/i.test(actions), 'actions.js must not reference the walkthrough');
  assert.equal(typeof WT.maybeShowWalkthrough, 'undefined');
  localStorage.clear();
  const { loadKey } = await import('../js/pages.js');
  loadKey('2026-07-11_Night');
  await new Promise(r => setTimeout(r, 1000));
  const ov = document.getElementById('walkthrough-overlay');
  assert.ok(!ov || ov.classList.contains('hidden'));
});

test('walkthrough: reachable from the ledger menu and closable with Escape', () => {
  assert.match(html, /openWalkthrough\(\);toggleMoreMenu\(\)/);
  const app = read('../js/app.js');
  assert.match(app, /id: 'walkthrough-overlay'/);
});

/* ── Offline shell ─────────────────────────────────────────── */
test('service worker caches the new modules and the cache version was bumped', () => {
  assert.match(sw, /'\.\/js\/walkthrough\.js'/);
  assert.match(sw, /'\.\/js\/a11y\.js'/);
  assert.match(sw, /CACHE_NAME = 'pharmpos-closing-v5\.19'/);
});

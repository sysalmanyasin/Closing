/* ═══════════════════════════════════════════════════════════════
   END-TO-END: Responsible Closing Person + Staff Ledger
   Loads the REAL index.html into jsdom and drives the REAL modules —
   same harness pattern as e2e-handover.test.mjs. Covers:
   1. The dropdown is populated from db.settings.staff on open.
   2. confirmSummaryAndSave() REFUSES to finalize without a name
      picked (the core accountability guarantee), and succeeds once
      one is chosen — while saveDraft()/saveSheet() at the Actions
      layer remain ungated (autosave / carry-forward must not break).
   3. buildSheetRecord()/hydrate() round-trip responsibleStaff.
   4. signedVariance() correctly turns the stored absolute finalDiff
      back into a signed number using finalDiffLabel.
   5. renderStaffLedger() groups by staff and totals variance
      correctly, and excludes drafts.
═══════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });

global.window   = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.localStorage = dom.window.localStorage;

let lastAlert = null;
global.alert   = (msg) => { lastAlert = msg; };
global.confirm = () => true;
global.prompt  = () => '1218'; /* default Admin PIN */

if(!dom.window.matchMedia) dom.window.matchMedia = () => ({ matches:false, addListener(){}, removeListener(){} });
dom.window.Element.prototype.scrollIntoView = () => {};

test('Responsible Closing Person + Staff Ledger — driven through the real app', async (t) => {
  const State     = await import('../js/state.js');
  const Actions   = await import('../js/actions.js');
  const Pages     = await import('../js/pages.js');
  const LedgerNav = await import('../js/ledger-nav.js');

  const { db, session } = State;
  const DS = '2026-07-20';

  db.sheets = {};
  db.creditLedger = [];
  db.activityLog  = [];
  db.settings.staff = [
    { name: 'Ali Raza',  pin: '1111' },
    { name: 'Sara Khan', pin: '2222' },
  ];
  session.currentActor = 'Admin';

  function setVal(id, v) {
    const el = document.getElementById(id);
    assert.ok(el, `expected element #${id} to exist in the real ledger DOM`);
    el.value = v;
  }

  await t.test('Dropdown is populated from db.settings.staff on open', () => {
    Pages.loadKey(`${DS}_Night`);
    const sel = document.getElementById('sel-responsible-staff');
    assert.ok(sel, 'responsible-staff select should exist');
    const optionValues = Array.from(sel.options).map(o => o.value);
    assert.ok(optionValues.includes('Ali Raza'));
    assert.ok(optionValues.includes('Sara Khan'));
    assert.equal(sel.value, '', 'should start blank on a new draft — never auto-filled from session.currentActor');
  });

  await t.test('confirmSummaryAndSave() refuses to finalize with no name picked', () => {
    setVal('in-sys-cash', 50000);
    setVal('out-curr-cc', 5000);
    Actions.calc();
    document.getElementById('sel-responsible-staff').value = '';
    lastAlert = null;
    LedgerNav.openSummaryModal();
    LedgerNav.confirmSummaryAndSave();
    assert.ok(lastAlert && /Responsible Closing Person/.test(lastAlert), 'should alert about the missing name');
    assert.equal(db.sheets[`${DS}_Night`], undefined, 'must NOT have been finalized/saved to db.sheets');
    const warn = document.getElementById('responsible-staff-warn');
    assert.equal(warn.classList.contains('hidden'), false, 'inline warning should now be visible');
  });

  await t.test('confirmSummaryAndSave() succeeds once a name is picked', () => {
    document.getElementById('sel-responsible-staff').value = 'Ali Raza';
    LedgerNav.openSummaryModal();
    LedgerNav.confirmSummaryAndSave();
    const rec = db.sheets[`${DS}_Night`];
    assert.ok(rec, 'Night record should now be saved');
    assert.equal(rec.draft, false);
    assert.equal(rec.responsibleStaff, 'Ali Raza');
  });

  await t.test('hydrate() restores the saved name when the sheet is reopened', () => {
    Pages.loadKey(`${DS}_Morning`); /* navigate away */
    Pages.loadKey(`${DS}_Night`);   /* navigate back — real code path calls hydrate() via loadKey */
    assert.equal(document.getElementById('sel-responsible-staff').value, 'Ali Raza');
  });

  await t.test('Autosave (saveDraft) is never blocked by the responsible-staff gate', () => {
    Pages.loadKey(`${DS}_Morning`);
    document.getElementById('sel-responsible-staff').value = ''; /* deliberately left blank */
    setVal('in-sys-cash', 80000);
    Actions.calc();
    Actions.saveDraft();
    const rec = db.sheets[`${DS}_Morning`];
    assert.ok(rec, 'draft save should succeed even without a responsible person set yet');
    assert.equal(rec.draft, true);
  });

  await t.test('signedVariance() derives sign from finalDiffLabel, not from finalDiff\'s own sign', () => {
    assert.equal(Pages.signedVariance({ finalDiff: 500, finalDiffLabel: '＋ Plus (Final Audit):' }), 500);
    assert.equal(Pages.signedVariance({ finalDiff: 500, finalDiffLabel: '－ Less (Final Audit):' }), -500);
    assert.equal(Pages.signedVariance({ finalDiff: 0,   finalDiffLabel: '' }), 0);
  });

  await t.test('renderStaffLedger() groups by staff, totals variance, and excludes drafts', () => {
    // Build a small controlled dataset directly (isolates the report
    // logic from the cash-math engine, which earlier sub-tests above
    // already exercised for real).
    db.sheets = {
      '2026-07-18_Night':   { draft: false, profileMode: 'shift', responsibleStaff: 'Ali Raza',  finalDiff: 200, finalDiffLabel: 'Plus (Final Audit)' },
      '2026-07-18_Morning': { draft: false, profileMode: 'shift', responsibleStaff: 'Sara Khan', finalDiff: 300, finalDiffLabel: 'Less (Final Audit)' },
      '2026-07-19_Night':   { draft: false, profileMode: 'shift', responsibleStaff: 'Ali Raza',  finalDiff: 100, finalDiffLabel: 'Less (Final Audit)' },
      '2026-07-19_Morning': { draft: true,  profileMode: 'shift', responsibleStaff: '',           finalDiff: 999, finalDiffLabel: 'Less (Final Audit)' },
    };
    Pages.goToStaffLedger();          // gated by prompt() -> '1218' (Admin PIN), stubbed above
    Pages.slSwitchGrouping('staff');

    const countBadge = document.getElementById('sl-count-badge').textContent;
    assert.match(countBadge, /3 records? matched/, 'the draft record must be excluded from the count');

    const box = document.getElementById('sl-entries-container').innerHTML;
    assert.match(box, /Ali Raza/);
    assert.match(box, /Sara Khan/);
    assert.doesNotMatch(box, /Not set/, 'the excluded draft\'s blank name must not leak into the grouped view');

    // Ali Raza: +200 and -100 => net +100 (surplus). Sara Khan: -300.
    // Grand total across the 3 finalized records: 200 - 300 - 100 = -200.
    const grand = document.getElementById('sl-grand-total').textContent;
    assert.match(grand, /−\s*Rs\.\s*200/, `expected a net shortage of Rs. 200, got "${grand}"`);
  });
});

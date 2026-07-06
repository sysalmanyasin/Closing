/* ═══════════════════════════════════════════════════════════════
   END-TO-END INTEGRATION TEST
   Loads the REAL index.html into a real DOM (jsdom) and imports the
   REAL app modules — not mocks, not reference oracles — then drives
   an actual day through them: Night → Morning → an inserted Handover
   → Evening, all saved for real, exactly the sequence a cashier
   going through an early-handover day would produce. This is the
   "test everything, very very carefully" pass: it exercises the
   full stack (initLedger, calc, saveSheet, timelineStep, carry-
   forward, Closing Book range assembly, Credit Ledger grouping,
   Activity Log) together, the way the browser actually would.
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
global.alert   = (msg) => { /* swallow — logged only on failure below */ global.__lastAlert = msg; };
global.confirm = () => true;
global.prompt  = () => '1218'; /* default Admin PIN — only hit if a test path needs it */

// jsdom doesn't implement matchMedia/ResizeObserver/scrollIntoView; stub what the app calls
if(!dom.window.matchMedia) dom.window.matchMedia = () => ({ matches:false, addListener(){}, removeListener(){} });
dom.window.Element.prototype.scrollIntoView = () => {};

test('End-to-end: a full day with an inserted Handover, driven through the real app', async (t) => {
  const State    = await import('../js/state.js');
  const Actions  = await import('../js/actions.js');
  const Pages    = await import('../js/pages.js');
  const Components = await import('../js/components.js');
  const ClosingBook = await import('../js/closing-book.js');
  const LedgerEngine = await import('../js/ledger-engine.js');
  const ActivityLog  = await import('../js/activity-log.js');

  const { db, session } = State;
  const DS = '2026-07-10';

  // Clean slate — this is a fresh scripted day, independent of any repoLoad() state
  db.sheets = {};
  db.creditLedger = [];
  db.activityLog  = [];
  session.currentActor = 'Integration Test';

  function setVal(id, v) {
    const el = document.getElementById(id);
    assert.ok(el, `expected element #${id} to exist in the real ledger DOM`);
    el.value = v;
  }
  function getVal(id) {
    const el = document.getElementById(id);
    return el ? parseFloat(el.value) || 0 : undefined;
  }

  await t.test('Night — open, fill, save', () => {
    Pages.loadKey(`${DS}_Night`);
    assert.equal(session.activeKey, `${DS}_Night`);
    setVal('in-sys-cash', 50000);
    setVal('out-curr-cc', 5000);
    Actions.calc();
    Actions.saveSheet();
    const rec = db.sheets[`${DS}_Night`];
    assert.ok(rec, 'Night record should be saved');
    assert.equal(rec.draft, false);
    assert.equal(rec.inSysCash, 50000);
  });

  await t.test('Morning — open, fill, save; carries forward from Night correctly', () => {
    Pages.loadKey(`${DS}_Morning`);
    assert.equal(session.activeKey, `${DS}_Morning`);
    // Morning's carried CC should equal Night's own outPrevCC (same-day shared base rule)
    const nightRec = db.sheets[`${DS}_Night`];
    assert.equal(getVal('out-prev-cc'), parseFloat(nightRec.outPrevCC) || 0);
    setVal('in-sys-cash', 80000);
    setVal('out-curr-cc', 7000);
    Actions.calc();
    Actions.saveSheet();
    const rec = db.sheets[`${DS}_Morning`];
    assert.ok(rec);
    assert.equal(rec.inSysCash, 80000);
  });

  await t.test('Insert Handover after Morning — correct key, seq, and carried-forward values', () => {
    const slot = Actions.computeNextHandoverSlot(DS);
    assert.equal(slot.key, `${DS}_Handover1`);
    assert.equal(slot.seq, 30); // Morning=20, +10

    Actions.insertHandoverClosing(DS);
    assert.equal(session.activeKey, `${DS}_Handover1`);
    const placeholder = db.sheets[`${DS}_Handover1`];
    assert.ok(placeholder, 'Handover placeholder should exist');
    assert.equal(placeholder.shiftLabel, 'Handover');
    assert.equal(placeholder.seq, 30);

    // Carry-forward: Handover follows Morning, so it should share Night's
    // CC base too (the "else" branch in pullPreviousShift/refreshCarryForwardFromPrevious
    // — anything that isn't literally "Night" shares the same-day base)
    const nightRec = db.sheets[`${DS}_Night`];
    assert.equal(getVal('out-prev-cc'), parseFloat(nightRec.outPrevCC) || 0);
    // Credit carried forward should come from Morning's own outTotalE
    const morningRec = db.sheets[`${DS}_Morning`];
    assert.equal(getVal('out-prev-credit'), parseFloat(morningRec.outTotalE) || 0);
  });

  await t.test('Save the Handover as a real closed shift', () => {
    setVal('in-sys-cash', 15000);
    Actions.calc();
    Actions.saveSheet();
    const rec = db.sheets[`${DS}_Handover1`];
    assert.equal(rec.draft, false);
    assert.equal(rec.seq, 30);
    assert.equal(rec.shiftLabel, 'Handover');
    assert.equal(rec.inSysCash, 15000);
  });

  await t.test('Evening — carries forward from the Handover, not from Morning directly', () => {
    Pages.loadKey(`${DS}_Evening`);
    assert.equal(session.activeKey, `${DS}_Evening`);
    const handoverRec = db.sheets[`${DS}_Handover1`];
    assert.equal(getVal('out-prev-credit'), parseFloat(handoverRec.outTotalE) || 0);
    setVal('in-sys-cash', 60000);
    Actions.calc();
    Actions.saveSheet();
    const rec = db.sheets[`${DS}_Evening`];
    assert.equal(rec.draft, false);
  });

  await t.test('timelineStep walks the whole real day correctly, forward and backward', () => {
    assert.equal(Components.timelineStep(DS, 'Night', 1).key,     `${DS}_Morning`);
    assert.equal(Components.timelineStep(DS, 'Morning', 1).key,   `${DS}_Handover1`);
    assert.equal(Components.timelineStep(DS, 'Handover1', 1).key, `${DS}_Evening`);
    assert.equal(Components.timelineStep(DS, 'Evening', -1).key,  `${DS}_Handover1`);
    assert.equal(Components.timelineStep(DS, 'Evening', -3).key,  `${DS}_Night`);
  });

  await t.test('Closing Book range enumeration includes the Handover in the right position', () => {
    const entries = ClosingBook.enumerateClosingBookEntries(DS, 'Night', DS, 'Evening');
    assert.deepEqual(entries.map(e => e.key), [
      `${DS}_Night`, `${DS}_Morning`, `${DS}_Handover1`, `${DS}_Evening`
    ]);
  });

  await t.test('Credit Ledger grouping sorts the Handover correctly among the day\u2019s snapshots', () => {
    const snaps = [
      { date: DS, shift: 'Night' },
      { date: DS, shift: 'Evening' },
      { date: DS, shift: 'Handover1' },
      { date: DS, shift: 'Morning' },
    ];
    const groups = LedgerEngine.clGroupByDate(snaps);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].snaps.map(s => s.shift), ['Evening', 'Handover1', 'Morning', 'Night']);
  });

  await t.test('shiftsSinceLastFinal counts the Handover as a real shift (Option A, confirmed)', () => {
    const count = Pages.shiftsSinceLastFinal();
    assert.equal(count, 4); // Night, Morning, Handover1, Evening — all real, none Final yet
  });

  await t.test('Activity Log recorded every real step, attributed to the actor', () => {
    const entries = ActivityLog.alAllEntries();
    const keys = entries.map(e => e.key);
    assert.ok(keys.includes(`${DS}_Night`));
    assert.ok(keys.includes(`${DS}_Morning`));
    assert.ok(keys.includes(`${DS}_Handover1`));
    assert.ok(keys.includes(`${DS}_Evening`));
    entries.forEach(e => assert.equal(e.actor, 'Integration Test'));
    // Night's first save should log as 'create' (nothing to diff against)
    const nightEntries = ActivityLog.alEntriesForKey(`${DS}_Night`);
    assert.equal(nightEntries[nightEntries.length - 1].action, 'create');
  });

  await t.test('A second, ordinary day with NO Handover still behaves exactly as before', () => {
    const DS2 = '2026-07-11';
    Pages.loadKey(`${DS2}_Night`);
    Actions.saveSheet();
    Pages.loadKey(`${DS2}_Morning`);
    Actions.saveSheet();
    Pages.loadKey(`${DS2}_Evening`);
    Actions.saveSheet();
    const entries = ClosingBook.enumerateClosingBookEntries(DS2, 'Night', DS2, 'Evening');
    assert.deepEqual(entries.map(e => e.key), [
      `${DS2}_Night`, `${DS2}_Morning`, `${DS2}_Evening`
    ]);
    assert.equal(Components.timelineStep(DS2, 'Morning', 1).key, `${DS2}_Evening`);
  });
});

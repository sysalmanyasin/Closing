/* ═══════════════════════════════════════════════════════════════
   END-TO-END: Row soft-delete (strike-through + confirm + undo)
   Loads the REAL index.html into jsdom and drives the REAL modules.
   Covers, for the Misc (Ongoing/Misc Charges) rows specifically —
   the same mechanism also applies to HS, Aux Credit, Deposit and
   Aux Strip rows via the shared delRow()/markRowDeleted():
   1. delRow() asks for confirmation before removing a row.
   2. A declined confirmation leaves the row fully intact and included
      in the total.
   3. A confirmed delete keeps the row in the DOM (struck through,
      read-only) and drops it out of the Misc (G) total.
   4. delRow() on an already-deleted row is Undo — no confirmation,
      restores the value and the total immediately.
   5. buildSheetRecord()/hydrate() round-trip the deleted flag.
   6. pullPreviousShift() does NOT carry a deleted misc row into the
      next shift.
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

let confirmReturns = true;
let confirmCallCount = 0;
global.confirm = () => { confirmCallCount++; return confirmReturns; };
global.alert   = () => {};
global.prompt  = () => '1218';

if(!dom.window.matchMedia) dom.window.matchMedia = () => ({ matches:false, addListener(){}, removeListener(){} });
dom.window.Element.prototype.scrollIntoView = () => {};

test('Row soft-delete (strike-through + confirm + undo) — driven through the real app', async (t) => {
  const State     = await import('../js/state.js');
  const Actions   = await import('../js/actions.js');
  const Pages     = await import('../js/pages.js');
  const Components = await import('../js/components.js');

  const { db, session } = State;
  const DS = '2026-07-21';

  db.sheets = {};
  db.settings.staff = [{ name: 'Ali Raza', pin: '1111' }];
  session.currentActor = 'Admin';

  Pages.loadKey(`${DS}_Night`);
  document.getElementById('sel-responsible-staff').value = 'Ali Raza';

  function miscTotal() { return parseFloat(document.getElementById('out-total-g').value) || 0; }
  function lastMiscRowId() { return document.getElementById('ledger-misc').lastElementChild.id; }

  await t.test('adding two misc rows sums normally', () => {
    Components.addMiscRow('914 Umer Block', 780);
    Components.addMiscRow('Khurram', 290);
    Actions.calc();
    assert.equal(miscTotal(), 1070);
  });

  await t.test('delRow() asks for confirmation; declining leaves the row untouched', () => {
    confirmReturns = false;
    confirmCallCount = 0;
    const rowId = lastMiscRowId(); // 'Khurram' row
    Components.delRow(rowId, true);
    assert.equal(confirmCallCount, 1, 'should have prompted for confirmation');
    const row = document.getElementById(rowId);
    assert.equal(row.classList.contains('row-deleted'), false, 'declined — must NOT be marked deleted');
    assert.equal(miscTotal(), 1070, 'total unchanged after a declined delete');
  });

  await t.test('confirmed delete strikes the row through and drops it from the total', () => {
    confirmReturns = true;
    const rowId = lastMiscRowId(); // 'Khurram' row
    Components.delRow(rowId, true);
    const row = document.getElementById(rowId);
    assert.equal(row.classList.contains('row-deleted'), true);
    assert.equal(row.querySelector('input[type="number"]').readOnly, true, 'value input should be locked once deleted');
    assert.equal(row.querySelector('.del-row-btn').textContent, '↺', 'button should flip to Undo');
    assert.equal(miscTotal(), 780, 'Khurram (290) must be excluded from Total Misc (C) once deleted');
  });

  await t.test('delRow() on an already-deleted row undoes it immediately, no confirmation needed', () => {
    confirmReturns = false; /* if this were treated as a fresh delete it would bail out and stay deleted */
    confirmCallCount = 0;
    const rowId = lastMiscRowId(); // still the 'Khurram' row, now deleted
    Components.delRow(rowId, true);
    assert.equal(confirmCallCount, 0, 'undo must not prompt for confirmation');
    const row = document.getElementById(rowId);
    assert.equal(row.classList.contains('row-deleted'), false);
    assert.equal(row.querySelector('.del-row-btn').textContent, '✕', 'button should flip back to delete');
    assert.equal(miscTotal(), 1070, 'restored row should count again');
  });

  await t.test('buildSheetRecord()/hydrate() round-trip the deleted flag', () => {
    confirmReturns = true;
    const rowId = lastMiscRowId();
    Components.delRow(rowId, true); // delete 'Khurram' again, for real this time
    assert.equal(miscTotal(), 780);

    Actions.saveDraft();
    const rec = db.sheets[`${DS}_Night`];
    const khurram = rec.miscRows.find(r => r.label === 'Khurram');
    assert.ok(khurram, 'deleted row must still be present in the saved record');
    assert.equal(khurram.deleted, true);
    const umerBlock = rec.miscRows.find(r => r.label === '914 Umer Block');
    assert.equal(umerBlock.deleted, false);

    // Navigate away and back — exercises hydrate() for real
    Pages.loadKey(`${DS}_Morning`);
    Pages.loadKey(`${DS}_Night`);
    const rows = Array.from(document.querySelectorAll('#ledger-misc .misc-row'));
    const restoredKhurram = rows.find(r => r.querySelector('.lbl-input').value === 'Khurram');
    assert.ok(restoredKhurram, 'Khurram row should still be present after reopening');
    assert.equal(restoredKhurram.classList.contains('row-deleted'), true, 'should still render struck-through after hydrate()');
    assert.equal(miscTotal(), 780, 'total should still exclude it after reopening');
  });

  await t.test('pullPreviousShift() does not carry a deleted misc row into the next shift', () => {
    // Carry-forward only reads a finalized sheet (getRealSheet() excludes
    // draft:true — see components.js) so finalize Night for real here.
    document.getElementById('sel-responsible-staff').value = 'Ali Raza';
    Actions.saveSheet();
    Pages.loadKey(`${DS}_Morning`);
    const rows = Array.from(document.querySelectorAll('#ledger-misc .misc-row'));
    const labels = rows.map(r => r.querySelector('.lbl-input').value);
    assert.ok(labels.includes('914 Umer Block'), 'non-deleted row should still carry forward');
    assert.ok(!labels.includes('Khurram'), 'deleted row must NOT carry forward to the next shift');
  });
});

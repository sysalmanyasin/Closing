import './setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { db } from '../js/state.js';
import { buildRbdRows } from '../js/rbd-history.js';

function resetDb() {
  db.sheets = {};
}

describe('buildRbdRows — Returns / Book Bill / Deposit, every closing', () => {
  test('reads Return 1/2/3, System Return, Book Bill 1/2, and the first 3 deposit rows', () => {
    resetDb();
    db.sheets['2026-08-30_Evening'] = {
      profileMode: 'shift',
      posRet1: 10199, posRet2: 335, posRet3: 0, posRetSys: 0,
      inBook1: 0, inBook2: 0,
      deposits: [
        { id: 'a', lbl: '', val: 90000, deleted: false },
        { id: 'b', lbl: '', val: 0,     deleted: false },
        { id: 'c', lbl: '', val: 0,     deleted: false }
      ]
    };

    const rows = buildRbdRows('2026-08-30', '2026-08-30');
    const evening = rows.find(r => r.shift === 'Evening');

    assert.ok(evening, 'Evening row should be present');
    assert.equal(evening.ret1, 10199);
    assert.equal(evening.ret2, 335);
    assert.equal(evening.ret3, 0);
    assert.equal(evening.retSys, 0);
    assert.equal(evening.book1, 0);
    assert.equal(evening.book2, 0);
    assert.equal(evening.dep1, 90000);
    assert.equal(evening.dep2, 0);
    assert.equal(evening.dep3, 0);
    assert.equal(evening.status, 'Shift');
  });

  test('Status reads "Final" for a Final Closing record, "Shift" otherwise', () => {
    resetDb();
    db.sheets['2026-08-30_Morning'] = { profileMode: 'final' };
    db.sheets['2026-08-30_Night']   = { profileMode: 'shift' };
    db.sheets['2026-08-30_Evening'] = {}; // no profileMode at all — still "Shift"

    const rows = buildRbdRows('2026-08-30', '2026-08-30');
    assert.equal(rows.find(r => r.shift === 'Morning').status, 'Final');
    assert.equal(rows.find(r => r.shift === 'Night').status, 'Shift');
    assert.equal(rows.find(r => r.shift === 'Evening').status, 'Shift');
  });

  test('a day with no records at all still returns Night/Morning/Evening rows, marked hasData:false', () => {
    resetDb();
    const rows = buildRbdRows('2026-08-31', '2026-08-31');
    assert.equal(rows.length, 3);
    assert.ok(rows.every(r => r.hasData === false));
    assert.deepEqual(rows.map(r => r.shift).sort(), ['Evening', 'Morning', 'Night'].sort());
  });

  test('every real day slot is included — Night, Morning, Evening always, plus a saved Handover', () => {
    resetDb();
    db.sheets['2026-08-30_Night']     = { profileMode: 'shift' };
    db.sheets['2026-08-30_Morning']   = { profileMode: 'shift' };
    db.sheets['2026-08-30_Handover1'] = { seq: 25, shiftLabel: 'Handover', profileMode: 'shift' };
    db.sheets['2026-08-30_Evening']   = { profileMode: 'final' };

    const rows = buildRbdRows('2026-08-30', '2026-08-30');
    assert.equal(rows.length, 4);
    assert.ok(rows.some(r => r.shift === 'Handover'), 'the Handover record uses its shiftLabel as the display name');
  });

  test('deposits[] excludes soft-deleted rows and only takes the first 3 remaining, in order', () => {
    resetDb();
    db.sheets['2026-08-30_Evening'] = {
      deposits: [
        { id: 'a', val: 1000, deleted: true },  // deleted — must be skipped
        { id: 'b', val: 2000, deleted: false },
        { id: 'c', val: 3000, deleted: false },
        { id: 'd', val: 4000, deleted: false },
        { id: 'e', val: 5000, deleted: false }  // 4th live row — beyond the 3 report columns, dropped
      ]
    };

    const rows = buildRbdRows('2026-08-30', '2026-08-30');
    const evening = rows.find(r => r.shift === 'Evening');
    assert.equal(evening.dep1, 2000);
    assert.equal(evening.dep2, 3000);
    assert.equal(evening.dep3, 4000);
  });

  test('rows are ordered newest date first, and newest shift first within a date', () => {
    resetDb();
    const rows = buildRbdRows('2026-08-29', '2026-08-31');

    // date descending
    const dates = rows.map(r => r.date);
    assert.equal(dates[0], '2026-08-31');
    assert.equal(dates[dates.length - 1], '2026-08-29');

    // within the first date block (2026-08-31), Evening should come
    // before Morning, which should come before Night
    const firstDateShifts = rows.filter(r => r.date === '2026-08-31').map(r => r.shift);
    assert.deepEqual(firstDateShifts, ['Evening', 'Morning', 'Night']);
  });

  test('missing/non-numeric fields are treated as zero rather than throwing', () => {
    resetDb();
    db.sheets['2026-08-30_Evening'] = {}; // nothing filled in yet

    const rows = buildRbdRows('2026-08-30', '2026-08-30');
    const evening = rows.find(r => r.shift === 'Evening');
    assert.equal(evening.hasData, true);
    assert.equal(evening.ret1, 0);
    assert.equal(evening.book1, 0);
    assert.equal(evening.dep1, 0);
  });

  test('flags draft:true for an unsaved draft record', () => {
    resetDb();
    db.sheets['2026-08-30_Evening'] = { draft: true };
    const rows = buildRbdRows('2026-08-30', '2026-08-30');
    assert.equal(rows.find(r => r.shift === 'Evening').draft, true);
  });

  test('returns an empty array when "from" is after "to", or either date is missing', () => {
    resetDb();
    assert.deepEqual(buildRbdRows('2026-08-10', '2026-08-01'), []);
    assert.deepEqual(buildRbdRows('', '2026-08-01'), []);
    assert.deepEqual(buildRbdRows('2026-08-01', ''), []);
  });
});

import './setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { db } from '../js/state.js';
import { buildMediqHistoryRows, buildMediqMonthRows } from '../js/mediq-history.js';

function resetDb() {
  db.sheets = {};
}

describe('buildMediqHistoryRows — date-wise, every closing', () => {
  test('reads order count, previous MEDIQ, and the extra (collected − pharmacy bill)', () => {
    resetDb();
    db.sheets['2026-08-30_Evening'] = {
      profileMode: 'shift',
      outPrevMediq: 500,
      mediqRows: [
        { id: 'a', billNum: '2446568', val: 1350, pharmBill: 1035, deleted: false },
        { id: 'b', billNum: '2446570', val: 1310, pharmBill: 1211, deleted: false }
      ]
    };

    const rows = buildMediqHistoryRows('2026-08-30', '2026-08-30');
    const evening = rows.find(r => r.shift === 'Evening');

    assert.ok(evening, 'Evening row should be present');
    assert.equal(evening.orderCount, 2);
    assert.equal(evening.prevMediq, 500);
    // (1350-1035) + (1310-1211) + 500 carried = 315 + 99 + 500 = 914
    assert.equal(evening.extra, 914);
    assert.equal(evening.status, 'Shift');
  });

  test('soft-deleted orders are excluded from both the count and the extra', () => {
    resetDb();
    db.sheets['2026-08-30_Evening'] = {
      mediqRows: [
        { id: 'a', val: 1000, pharmBill: 800, deleted: false },
        { id: 'b', val: 5000, pharmBill: 1000, deleted: true } // removed — must not count
      ]
    };
    const rows = buildMediqHistoryRows('2026-08-30', '2026-08-30');
    const evening = rows.find(r => r.shift === 'Evening');
    assert.equal(evening.orderCount, 1);
    assert.equal(evening.extra, 200);
  });

  test('a record with no mediqRows array falls back to the legacy gross outTotalI', () => {
    resetDb();
    db.sheets['2026-08-30_Evening'] = { outTotalI: 2660 }; // pre-migration record
    const rows = buildMediqHistoryRows('2026-08-30', '2026-08-30');
    const evening = rows.find(r => r.shift === 'Evening');
    assert.equal(evening.extra, 2660);
    assert.equal(evening.orderCount, 0);
  });

  test('Status reads "Final" for a Final Closing record, "Shift" otherwise', () => {
    resetDb();
    db.sheets['2026-08-30_Morning'] = { profileMode: 'final' };
    db.sheets['2026-08-30_Night']   = { profileMode: 'shift' };
    db.sheets['2026-08-30_Evening'] = {};

    const rows = buildMediqHistoryRows('2026-08-30', '2026-08-30');
    assert.equal(rows.find(r => r.shift === 'Morning').status, 'Final');
    assert.equal(rows.find(r => r.shift === 'Night').status, 'Shift');
    assert.equal(rows.find(r => r.shift === 'Evening').status, 'Shift');
  });

  test('a day with no records at all still returns Night/Morning/Evening rows, marked hasData:false', () => {
    resetDb();
    const rows = buildMediqHistoryRows('2026-08-31', '2026-08-31');
    assert.equal(rows.length, 3);
    assert.ok(rows.every(r => r.hasData === false));
    assert.deepEqual(rows.map(r => r.shift).sort(), ['Evening', 'Morning', 'Night'].sort());
  });

  test('rows are ordered newest date first, and newest shift first within a date', () => {
    resetDb();
    const rows = buildMediqHistoryRows('2026-08-29', '2026-08-31');
    const dates = rows.map(r => r.date);
    assert.equal(dates[0], '2026-08-31');
    assert.equal(dates[dates.length - 1], '2026-08-29');

    const firstDateShifts = rows.filter(r => r.date === '2026-08-31').map(r => r.shift);
    assert.deepEqual(firstDateShifts, ['Evening', 'Morning', 'Night']);
  });

  test('flags draft:true for an unsaved draft record', () => {
    resetDb();
    db.sheets['2026-08-30_Evening'] = { draft: true };
    const rows = buildMediqHistoryRows('2026-08-30', '2026-08-30');
    assert.equal(rows.find(r => r.shift === 'Evening').draft, true);
  });

  test('returns an empty array when "from" is after "to", or either date is missing', () => {
    resetDb();
    assert.deepEqual(buildMediqHistoryRows('2026-08-10', '2026-08-01'), []);
    assert.deepEqual(buildMediqHistoryRows('', '2026-08-01'), []);
    assert.deepEqual(buildMediqHistoryRows('2026-08-01', ''), []);
  });
});

describe('buildMediqMonthRows — month-wise rollup', () => {
  test('groups date-wise rows by calendar month, newest month first', () => {
    const rows = [
      { date: '2026-09-05', hasData: true, orderCount: 2, prevMediq: 0,   extra: 300 },
      { date: '2026-09-17', hasData: true, orderCount: 1, prevMediq: 100, extra: 414 },
      { date: '2026-08-20', hasData: true, orderCount: 3, prevMediq: 0,   extra: 500 },
      { date: '2026-08-01', hasData: false, orderCount: 0, prevMediq: 0, extra: 0 } // empty slot — excluded
    ];
    const months = buildMediqMonthRows(rows);

    assert.equal(months.length, 2);
    assert.equal(months[0].month, '2026-09');
    assert.equal(months[1].month, '2026-08');

    assert.equal(months[0].shiftCount, 2);
    assert.equal(months[0].orderCount, 3);
    assert.equal(months[0].prevMediq, 100);
    assert.equal(months[0].extra, 714);

    assert.equal(months[1].shiftCount, 1);
    assert.equal(months[1].orderCount, 3);
    assert.equal(months[1].extra, 500);
  });

  test('a month with only empty (hasData:false) slots does not appear at all', () => {
    const rows = [
      { date: '2026-08-01', hasData: false, orderCount: 0, prevMediq: 0, extra: 0 },
      { date: '2026-08-02', hasData: false, orderCount: 0, prevMediq: 0, extra: 0 }
    ];
    assert.deepEqual(buildMediqMonthRows(rows), []);
  });

  test('returns an empty array for an empty input', () => {
    assert.deepEqual(buildMediqMonthRows([]), []);
  });
});

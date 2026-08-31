import './setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { db } from '../js/state.js';
import { buildCcHistoryRows } from '../js/cc-history.js';

function resetDb() {
  db.sheets = {};
}

describe('buildCcHistoryRows — Evening (Closing 3) only, per day', () => {
  test('computes CC = (Bank Alfalah + Keenu) - Computer Card Sale for a single day', () => {
    resetDb();
    db.sheets['2026-08-29_Evening'] = { inAlfalah: 166294, inKeenu: 99307, inCompSale: 227529 };

    const rows = buildCcHistoryRows('2026-08-29', '2026-08-29');

    assert.equal(rows.length, 1);
    assert.equal(rows[0].date, '2026-08-29');
    assert.equal(rows[0].hasData, true);
    assert.equal(rows[0].alfalah, 166294);
    assert.equal(rows[0].keenu, 99307);
    assert.equal(rows[0].compSale, 227529);
    assert.equal(rows[0].cc, (166294 + 99307) - 227529);
  });

  test('ignores Night and Morning records for the same date — Evening only', () => {
    resetDb();
    db.sheets['2026-08-29_Night']   = { inAlfalah: 999, inKeenu: 999, inCompSale: 999 };
    db.sheets['2026-08-29_Morning'] = { inAlfalah: 888, inKeenu: 888, inCompSale: 888 };
    db.sheets['2026-08-29_Evening'] = { inAlfalah: 122545, inKeenu: 209124, inCompSale: 294095 };

    const rows = buildCcHistoryRows('2026-08-29', '2026-08-29');

    assert.equal(rows.length, 1);
    assert.equal(rows[0].alfalah, 122545);
    assert.equal(rows[0].keenu, 209124);
    assert.equal(rows[0].compSale, 294095);
    assert.equal(rows[0].cc, (122545 + 209124) - 294095);
  });

  test('a day with no saved Evening closing still gets a row, marked hasData:false', () => {
    resetDb();
    db.sheets['2026-08-29_Evening'] = { inAlfalah: 100, inKeenu: 50, inCompSale: 30 };
    // 2026-08-30 has nothing saved at all

    const rows = buildCcHistoryRows('2026-08-29', '2026-08-30');

    assert.equal(rows.length, 2);
    assert.equal(rows[0].hasData, true);
    assert.equal(rows[1].date, '2026-08-30');
    assert.equal(rows[1].hasData, false);
    assert.equal(rows[1].cc, 0);
  });

  test('walks every calendar day in the range inclusive of both endpoints, in order', () => {
    resetDb();
    const rows = buildCcHistoryRows('2026-08-01', '2026-08-05');
    assert.deepEqual(rows.map(r => r.date), [
      '2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05'
    ]);
  });

  test('correctly walks across a month boundary (local-date stepping, no UTC drift)', () => {
    resetDb();
    const rows = buildCcHistoryRows('2026-08-30', '2026-09-01');
    assert.deepEqual(rows.map(r => r.date), ['2026-08-30', '2026-08-31', '2026-09-01']);
  });

  test('treats missing/non-numeric card fields as zero rather than throwing', () => {
    resetDb();
    db.sheets['2026-08-29_Evening'] = {}; // nothing filled in yet (mid-shift draft)

    const rows = buildCcHistoryRows('2026-08-29', '2026-08-29');

    assert.equal(rows[0].hasData, true);
    assert.equal(rows[0].alfalah, 0);
    assert.equal(rows[0].keenu, 0);
    assert.equal(rows[0].compSale, 0);
    assert.equal(rows[0].cc, 0);
  });

  test('flags draft:true when the Evening record is still an unsaved draft', () => {
    resetDb();
    db.sheets['2026-08-29_Evening'] = { inAlfalah: 10, inKeenu: 10, inCompSale: 5, draft: true };

    const rows = buildCcHistoryRows('2026-08-29', '2026-08-29');
    assert.equal(rows[0].draft, true);
  });

  test('a negative CC (returns/refunds exceeding card machine totals) is preserved, not clamped', () => {
    resetDb();
    db.sheets['2026-08-29_Evening'] = { inAlfalah: 10, inKeenu: 10, inCompSale: 50 };

    const rows = buildCcHistoryRows('2026-08-29', '2026-08-29');
    assert.equal(rows[0].cc, -30);
  });

  test('returns an empty array when "from" is after "to"', () => {
    resetDb();
    const rows = buildCcHistoryRows('2026-08-10', '2026-08-01');
    assert.deepEqual(rows, []);
  });

  test('returns an empty array when either date is missing', () => {
    resetDb();
    assert.deepEqual(buildCcHistoryRows('', '2026-08-01'), []);
    assert.deepEqual(buildCcHistoryRows('2026-08-01', ''), []);
    assert.deepEqual(buildCcHistoryRows(null, null), []);
  });

  test('a single-day range (from === to) returns exactly one row', () => {
    resetDb();
    db.sheets['2026-08-29_Evening'] = { inAlfalah: 1, inKeenu: 1, inCompSale: 1 };
    const rows = buildCcHistoryRows('2026-08-29', '2026-08-29');
    assert.equal(rows.length, 1);
  });
});

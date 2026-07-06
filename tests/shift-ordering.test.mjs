import './setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { db } from '../js/state.js';
import { sheetSortKey } from '../js/pages.js';
import { enumerateClosingBookEntries } from '../js/closing-book.js';
import { clGroupByDate } from '../js/ledger-engine.js';

function resetSheets() { db.sheets = {}; }

/* ── Reference oracle for the OLD sheetSortKey — a fixed
   {Night:0, Morning:1, Evening:2} map, no db.sheets awareness. ── */
const OLD_CHRONO = { Night: 0, Morning: 1, Evening: 2 };
function oldSheetSortKey(k) {
  const parts = k.split('_');
  return parts[0] + '_' + (OLD_CHRONO[parts[1]] ?? 9);
}

describe('sheetSortKey — regression: same RELATIVE ordering as the old fixed-map implementation', () => {
  test('a full day of Night/Morning/Evening sorts identically old vs new', () => {
    resetSheets();
    const keys = ['2026-07-05_Evening', '2026-07-05_Night', '2026-07-05_Morning'];
    const oldSorted = [...keys].sort((a, b) => oldSheetSortKey(a).localeCompare(oldSheetSortKey(b)));
    const newSorted = [...keys].sort((a, b) => sheetSortKey(a).localeCompare(sheetSortKey(b)));
    assert.deepEqual(newSorted, oldSorted);
    assert.deepEqual(newSorted, ['2026-07-05_Night', '2026-07-05_Morning', '2026-07-05_Evening']);
  });

  test('multiple dates sort identically old vs new', () => {
    resetSheets();
    const keys = [
      '2026-07-06_Night', '2026-07-05_Evening', '2026-07-05_Night',
      '2026-07-05_Morning', '2026-07-04_Evening'
    ];
    const oldSorted = [...keys].sort((a, b) => oldSheetSortKey(a).localeCompare(oldSheetSortKey(b)));
    const newSorted = [...keys].sort((a, b) => sheetSortKey(a).localeCompare(sheetSortKey(b)));
    assert.deepEqual(newSorted, oldSorted);
  });
});

describe('sheetSortKey — new behavior: a Handover sorts between its neighbors', () => {
  test('Handover1 (seq 30) sorts after Morning (seq 20) and before Evening (seq 9999)', () => {
    resetSheets();
    db.sheets['2026-07-05_Handover1'] = { draft: false, seq: 30, shiftLabel: 'Handover' };
    const keys = ['2026-07-05_Evening', '2026-07-05_Handover1', '2026-07-05_Night', '2026-07-05_Morning'];
    const sorted = [...keys].sort((a, b) => sheetSortKey(a).localeCompare(sheetSortKey(b)));
    assert.deepEqual(sorted, [
      '2026-07-05_Night', '2026-07-05_Morning', '2026-07-05_Handover1', '2026-07-05_Evening'
    ]);
  });
});

describe('clGroupByDate — regression + new behavior', () => {
  test('groups and orders Night/Morning/Evening newest-first within a date, same as before', () => {
    resetSheets();
    const snaps = [
      { date: '2026-07-05', shift: 'Night' },
      { date: '2026-07-05', shift: 'Evening' },
      { date: '2026-07-05', shift: 'Morning' },
    ];
    const groups = clGroupByDate(snaps);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].snaps.map(s => s.shift), ['Evening', 'Morning', 'Night']);
  });

  test('a Handover sits between Morning and Evening in newest-first order', () => {
    resetSheets();
    db.sheets['2026-07-05_Handover1'] = { draft: false, seq: 30, shiftLabel: 'Handover' };
    const snaps = [
      { date: '2026-07-05', shift: 'Night' },
      { date: '2026-07-05', shift: 'Evening' },
      { date: '2026-07-05', shift: 'Handover1' },
      { date: '2026-07-05', shift: 'Morning' },
    ];
    const groups = clGroupByDate(snaps);
    assert.deepEqual(groups[0].snaps.map(s => s.shift), ['Evening', 'Handover1', 'Morning', 'Night']);
  });
});

describe('enumerateClosingBookEntries — regression: identical to the old fixed 3-shift enumeration', () => {
  test('a plain multi-day range with no Handovers produces the same sequence as before', () => {
    resetSheets();
    const entries = enumerateClosingBookEntries('2026-07-04', 'Night', '2026-07-05', 'Evening');
    assert.deepEqual(entries.map(e => e.key), [
      '2026-07-04_Night', '2026-07-04_Morning', '2026-07-04_Evening',
      '2026-07-05_Night', '2026-07-05_Morning', '2026-07-05_Evening',
    ]);
  });

  test('a same-day partial range (Morning to Evening) trims correctly, same as before', () => {
    resetSheets();
    const entries = enumerateClosingBookEntries('2026-07-05', 'Morning', '2026-07-05', 'Evening');
    assert.deepEqual(entries.map(e => e.key), ['2026-07-05_Morning', '2026-07-05_Evening']);
  });

  test('new behavior: a Handover on an in-range day is included automatically', () => {
    resetSheets();
    db.sheets['2026-07-05_Handover1'] = { draft: false, seq: 30, shiftLabel: 'Handover' };
    const entries = enumerateClosingBookEntries('2026-07-04', 'Night', '2026-07-05', 'Evening');
    assert.deepEqual(entries.map(e => e.key), [
      '2026-07-04_Night', '2026-07-04_Morning', '2026-07-04_Evening',
      '2026-07-05_Night', '2026-07-05_Morning', '2026-07-05_Handover1', '2026-07-05_Evening',
    ]);
  });

  test('new behavior: starting the range exactly at a Handover excludes everything before it that same day', () => {
    resetSheets();
    db.sheets['2026-07-05_Handover1'] = { draft: false, seq: 30, shiftLabel: 'Handover' };
    const entries = enumerateClosingBookEntries('2026-07-05', 'Handover1', '2026-07-05', 'Evening');
    assert.deepEqual(entries.map(e => e.key), ['2026-07-05_Handover1', '2026-07-05_Evening']);
  });
});

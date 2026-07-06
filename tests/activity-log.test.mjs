import './setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { db, session } from '../js/state.js';
import {
  diffRecords, alLog, alCommit, alBeginSession, alAllEntries, alEntriesForKey
} from '../js/activity-log.js';

function resetDb() {
  db.sheets = {};
  db.activityLog = [];
  session.currentActor = 'Test Actor';
}

describe('diffRecords — scalar fields', () => {
  test('reports a changed flat field with a friendly label', () => {
    const before = { inSysCash: 1000, outCust: 50 };
    const after  = { inSysCash: 1200, outCust: 50 };
    const changes = diffRecords(before, after);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].field, 'inSysCash');
    assert.equal(changes[0].label, 'Computer Cash Sale');
    assert.equal(changes[0].from, 1000);
    assert.equal(changes[0].to, 1200);
  });

  test('ignores fields that are effectively unchanged (both blank/zero)', () => {
    const before = { creditAdj: 0, extraCash: undefined };
    const after  = { creditAdj: '', extraCash: 0 };
    assert.deepEqual(diffRecords(before, after), []);
  });

  test('skips bookkeeping fields (draft, locked, savedAt, finalDiffLabel) entirely', () => {
    const before = { draft: true, locked: false, savedAt: 1000, finalDiffLabel: 'Less' };
    const after  = { draft: false, locked: true, savedAt: 2000, finalDiffLabel: 'Plus' };
    assert.deepEqual(diffRecords(before, after), []);
  });

  test('falls back to camelCase→Title Case for fields with no curated label', () => {
    const before = { someObscureField: 1 };
    const after  = { someObscureField: 2 };
    const changes = diffRecords(before, after);
    assert.equal(changes[0].label, 'Some Obscure Field');
  });

  test('returns no changes at all when before is null (first-ever save)', () => {
    assert.deepEqual(diffRecords(null, { inSysCash: 500 }), []);
  });
});

describe('diffRecords — id-keyed free-form row arrays', () => {
  test('detects a row value change, matched by id not position', () => {
    const before = { miscRows: [{ id: 'r1', label: 'Wipes', val: 100 }, { id: 'r2', label: 'Tape', val: 50 }] };
    const after  = { miscRows: [{ id: 'r1', label: 'Wipes', val: 150 }, { id: 'r2', label: 'Tape', val: 50 }] };
    const changes = diffRecords(before, after);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].field, 'miscRows');
    assert.equal(changes[0].from, '100');
    assert.equal(changes[0].to, '150');
  });

  test('a deleted middle row is reported as removed, not as every later row "changing"', () => {
    const before = {
      miscRows: [
        { id: 'r1', label: 'A', val: 10 },
        { id: 'r2', label: 'B', val: 20 },
        { id: 'r3', label: 'C', val: 30 },
      ]
    };
    const after = {
      miscRows: [
        { id: 'r1', label: 'A', val: 10 },
        { id: 'r3', label: 'C', val: 30 },
      ]
    };
    const changes = diffRecords(before, after);
    assert.equal(changes.length, 1);
    assert.match(changes[0].label, /row removed/);
    assert.match(changes[0].label, /B/);
  });

  test('a newly added row is reported as added', () => {
    const before = { deposits: [{ id: 'd1', lbl: 'Safe A', val: 500 }] };
    const after  = { deposits: [{ id: 'd1', lbl: 'Safe A', val: 500 }, { id: 'd2', lbl: 'Safe B', val: 300 }] };
    const changes = diffRecords(before, after);
    assert.equal(changes.length, 1);
    assert.match(changes[0].label, /row added/);
    assert.match(changes[0].label, /Safe B/);
  });

  test('reordering rows with no value change produces no diff', () => {
    const before = { hsRows: [{ id: 'h1', lbl: 'Water', val: 100 }, { id: 'h2', lbl: 'Juice', val: 200 }] };
    const after  = { hsRows: [{ id: 'h2', lbl: 'Juice', val: 200 }, { id: 'h1', lbl: 'Water', val: 100 }] };
    assert.deepEqual(diffRecords(before, after), []);
  });
});

describe('diffRecords — indexed arrays (stripQtys/tillValues/vaultValues)', () => {
  test('detects a positional value change', () => {
    const before = { tillValues: [5, 5, 11, 13, 58, 900] };
    const after  = { tillValues: [5, 5, 12, 13, 58, 900] };
    const changes = diffRecords(before, after);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].field, 'tillValues[2]');
    assert.equal(changes[0].from, 11);
    assert.equal(changes[0].to, 12);
  });
});

describe('alLog / alCommit / alAllEntries / alEntriesForKey', () => {
  test('alLog appends an entry tagged with the current actor', () => {
    resetDb();
    alLog('delete', '2026-07-05_Night');
    const entries = alAllEntries();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].actor, 'Test Actor');
    assert.equal(entries[0].action, 'delete');
    assert.equal(entries[0].key, '2026-07-05_Night');
  });

  test('alCommit logs "create" with no diff on a record\'s first save', () => {
    resetDb();
    alCommit('save', '2026-07-05_Night', { inSysCash: 1000 });
    const entries = alEntriesForKey('2026-07-05_Night');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].action, 'create');
    assert.deepEqual(entries[0].changes, []);
  });

  test('a second alCommit in the same session diffs against the first, not against nothing', () => {
    resetDb();
    const key = '2026-07-05_Night';
    alCommit('save-draft', key, { inSysCash: 1000 });
    alCommit('save', key, { inSysCash: 1500 });
    const entries = alEntriesForKey(key);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].action, 'save'); // newest first
    assert.equal(entries[0].changes.length, 1);
    assert.equal(entries[0].changes[0].from, 1000);
    assert.equal(entries[0].changes[0].to, 1500);
  });

  test('alBeginSession followed by alCommit reports what changed since the sheet was opened', () => {
    resetDb();
    const key = '2026-07-05_Morning';
    alBeginSession(key, { inSysCash: 2000, outCust: 40 });
    alCommit('save', key, { inSysCash: 2200, outCust: 40 });
    const entries = alEntriesForKey(key);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].action, 'save');
    assert.equal(entries[0].changes.length, 1);
    assert.equal(entries[0].changes[0].field, 'inSysCash');
  });
});

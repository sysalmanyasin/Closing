import './setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { db } from '../js/state.js';
import {
  clBuildSnapshot, clGroupByDate, clAllLabels,
  mlAllSnapshots, retentionCutoffDate, staleRecordKeys, countRecordsOlderThan,
} from '../js/ledger-engine.js';

function resetDb() {
  db.sheets = {};
  db.creditLedger = [];
}

describe('clBuildSnapshot', () => {
  test('extracts non-zero named/tier/aux credits and totals', () => {
    resetDb();
    const rec = {
      profileMode: 'shift',
      outPrevCredit: 1000,
      creditAdj: 50,
      outTotalE: 2500,
      namedCredits: [
        { lbl: 'Corporate Account', desc: 'monthly', val: 300 },
        { lbl: 'Wholesale Ledger', val: 0 }, // zero — should be excluded
      ],
      tierCredits: [
        { name: 'Dr. Salman', val: 200 },
        { name: '', val: 100 }, // no name — should be excluded
      ],
      auxCredits: [
        { lbl: 'Walk-in customer', val: 150 },
      ],
    };

    const snap = clBuildSnapshot('2026-07-03_Night', rec);

    assert.equal(snap.date, '2026-07-03');
    assert.equal(snap.shift, 'Night');
    assert.equal(snap.openingCredit, 1000);
    assert.equal(snap.creditAdj, 50);
    assert.equal(snap.totalCredit, 2500);
    assert.equal(snap.lines.length, 3, 'zero-value and unnamed entries should be filtered out');
    assert.ok(snap.lines.some(l => l.category === 'named' && l.lbl === 'Corporate Account' && l.val === 300));
    assert.ok(snap.lines.some(l => l.category === 'tier' && l.lbl === 'Dr. Salman' && l.val === 200));
    assert.ok(snap.lines.some(l => l.category === 'aux' && l.lbl === 'Walk-in customer' && l.val === 150));
  });

  test('handles a record with no credit entries at all', () => {
    const snap = clBuildSnapshot('2026-07-01_Morning', { profileMode: 'final' });
    assert.equal(snap.lines.length, 0);
    assert.equal(snap.mode, 'final');
    assert.equal(snap.openingCredit, 0);
  });
});

describe('clGroupByDate — the Night-starts-the-day ordering', () => {
  test('groups by date and sorts shifts Evening, Morning, Night within a date (latest shift first)', () => {
    const snapshots = [
      { date: '2026-07-02', shift: 'Night',   key: 'a' },
      { date: '2026-07-02', shift: 'Evening', key: 'b' },
      { date: '2026-07-02', shift: 'Morning', key: 'c' },
      { date: '2026-07-01', shift: 'Night',   key: 'd' },
    ];

    const groups = clGroupByDate(snapshots);

    assert.equal(groups.length, 2, 'two distinct dates');
    assert.equal(groups[0].date, '2026-07-02', 'most recent date first');
    assert.deepEqual(
      groups[0].snaps.map(s => s.shift),
      ['Evening', 'Morning', 'Night'],
      'within a date, latest-shift-first — this is the ordering the Saved Records list depends on'
    );
    assert.equal(groups[1].date, '2026-07-01');
  });
});

describe('clAllLabels', () => {
  test('collects unique labels across all snapshots', () => {
    resetDb();
    db.creditLedger = [
      { key: 'a', lines: [{ lbl: 'Corporate Account' }, { lbl: 'Dr. Salman' }] },
      { key: 'b', lines: [{ lbl: 'Corporate Account' }, { lbl: 'Walk-in customer' }] },
    ];
    const labels = clAllLabels();
    assert.deepEqual(labels, ['Corporate Account', 'Dr. Salman', 'Walk-in customer']);
  });
});

describe('mlAllSnapshots (Misc/Ongoing Ledger)', () => {
  test('reads live from db.sheets, skips drafts and empty/zero rows', () => {
    resetDb();
    db.sheets = {
      '2026-07-03_Night': {
        draft: false,
        profileMode: 'shift',
        miscRows: [
          { label: 'Waqas', val: 2922 },
          { label: '', val: 0 },       // both empty — excluded
          { label: 'Customer', val: 200 },
        ],
      },
      '2026-07-03_Morning': { draft: true, miscRows: [{ label: 'Should be skipped', val: 999 }] },
      '2026-07-02_Evening': { draft: false, profileMode: 'final', miscRows: [] },
    };

    const snaps = mlAllSnapshots();

    assert.equal(snaps.length, 1, 'draft and empty-row records excluded');
    assert.equal(snaps[0].key, '2026-07-03_Night');
    assert.equal(snaps[0].lines.length, 2);
    assert.equal(snaps[0].total, 3122);
  });
});

describe('Data retention math', () => {
  test('retentionCutoffDate returns N months back in YYYY-MM-DD form', () => {
    const cutoff = retentionCutoffDate(6);
    assert.match(cutoff, /^\d{4}-\d{2}-\d{2}$/);
    const cutoffDate = new Date(cutoff + 'T00:00:00');
    const expected = new Date();
    expected.setMonth(expected.getMonth() - 6);
    assert.equal(cutoffDate.getUTCFullYear(), expected.getFullYear());
    assert.equal(cutoffDate.getUTCMonth(), expected.getMonth());
  });

  test('staleRecordKeys / countRecordsOlderThan only match records older than N months', () => {
    resetDb();
    const oldDate = retentionCutoffDate(7); // definitely older than a 6-month cutoff
    db.sheets = {
      [`${oldDate}_Night`]: { profileMode: 'shift' },
      '2099-01-01_Evening': { profileMode: 'shift' }, // far future — never stale
    };

    const stale = staleRecordKeys(6);
    assert.equal(stale.length, 1);
    assert.equal(stale[0], `${oldDate}_Night`);
    assert.equal(countRecordsOlderThan(6), 1);
  });

  test('archiveOldRecords never runs automatically — countRecordsOlderThan is read-only', () => {
    resetDb();
    const oldDate = retentionCutoffDate(7);
    db.sheets = { [`${oldDate}_Night`]: { profileMode: 'shift' } };
    countRecordsOlderThan(6);
    assert.equal(Object.keys(db.sheets).length, 1, 'querying the count must never delete anything');
  });
});

import './setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { db } from '../js/state.js';
import {
  clBuildSnapshot, clGroupByDate, clAllLabels,
  mlAllSnapshots, mlLatestSnapshot, mlComputeAging,
  retentionCutoffDate, staleRecordKeys, countRecordsOlderThan,
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

/* YYYY-MM-DD n days ago, in local time — keeps aging assertions valid
   regardless of what "today" is when the suite runs. */
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

describe('mlLatestSnapshot', () => {
  test('returns null when there are no misc records', () => {
    resetDb();
    assert.equal(mlLatestSnapshot(), null);
  });

  test('returns the newest snapshot, matching clGroupByDate ordering', () => {
    resetDb();
    db.sheets = {
      [`${daysAgo(5)}_Night`]:   { draft: false, profileMode: 'shift', miscRows: [{ label: 'Old Charge', val: 100 }] },
      [`${daysAgo(0)}_Evening`]: { draft: false, profileMode: 'shift', miscRows: [{ label: 'Rent', val: 500 }] },
    };
    const latest = mlLatestSnapshot();
    assert.equal(latest.date, daysAgo(0));
    assert.equal(latest.shift, 'Evening');
  });
});

describe('mlComputeAging', () => {
  test('empty when there is no misc history', () => {
    resetDb();
    assert.deepEqual(mlComputeAging(), []);
  });

  test('a charge present in every shift ages from its first appearance', () => {
    resetDb();
    db.sheets = {
      [`${daysAgo(10)}_Night`]:   { draft: false, profileMode: 'shift', miscRows: [{ label: 'Rent', val: 500 }] },
      [`${daysAgo(5)}_Night`]:    { draft: false, profileMode: 'shift', miscRows: [{ label: 'Rent', val: 500 }] },
      [`${daysAgo(0)}_Night`]:    { draft: false, profileMode: 'shift', miscRows: [{ label: 'Rent', val: 500 }] },
    };
    const aging = mlComputeAging();
    assert.equal(aging.length, 1);
    assert.equal(aging[0].lbl, 'Rent');
    assert.equal(aging[0].since, daysAgo(10));
    assert.equal(aging[0].ageDays, 10);
  });

  test('a gap in the history breaks the streak and resets aging', () => {
    resetDb();
    db.sheets = {
      [`${daysAgo(10)}_Night`]: { draft: false, profileMode: 'shift', miscRows: [{ label: 'Rent', val: 500 }] },
      // gap here — Rent absent from the middle shift
      [`${daysAgo(5)}_Night`]:  { draft: false, profileMode: 'shift', miscRows: [{ label: 'Other', val: 50 }] },
      [`${daysAgo(0)}_Night`]:  { draft: false, profileMode: 'shift', miscRows: [{ label: 'Rent', val: 500 }] },
    };
    const aging = mlComputeAging();
    const rent = aging.find(a => a.lbl === 'Rent');
    assert.equal(rent.since, daysAgo(0), 'streak should restart at the most recent reappearance, not the original one');
    assert.equal(rent.ageDays, 0);
  });

  test('label matching is trim/case-insensitive but preserves latest display label', () => {
    resetDb();
    db.sheets = {
      [`${daysAgo(3)}_Night`]: { draft: false, profileMode: 'shift', miscRows: [{ label: '  rent  ', val: 500 }] },
      [`${daysAgo(0)}_Night`]: { draft: false, profileMode: 'shift', miscRows: [{ label: 'Rent', val: 500 }] },
    };
    const aging = mlComputeAging();
    assert.equal(aging.length, 1);
    assert.equal(aging[0].lbl, 'Rent', 'display label comes from the latest snapshot as-typed');
    assert.equal(aging[0].since, daysAgo(3));
    assert.equal(aging[0].ageDays, 3);
  });

  test('only lines from the latest snapshot are reported', () => {
    resetDb();
    db.sheets = {
      [`${daysAgo(5)}_Night`]: { draft: false, profileMode: 'shift', miscRows: [{ label: 'Gone Now', val: 200 }] },
      [`${daysAgo(0)}_Night`]: { draft: false, profileMode: 'shift', miscRows: [{ label: 'Still Here', val: 300 }] },
    };
    const aging = mlComputeAging();
    assert.equal(aging.length, 1);
    assert.equal(aging[0].lbl, 'Still Here');
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

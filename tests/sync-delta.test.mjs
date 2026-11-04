import './setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { _mergeActivityLog, _alId, _maxIso, _pickPullMode, _mergeByKey } from '../js/sync.js';

const e = (ts, key = 'k', action = 'edit', actor = 'a') => ({ ts, actor, key, action, changes: null });
const withCreated = (row, created_at) => ({ ...row, created_at });

describe('_mergeActivityLog — full pull', () => {
  test('replaces the pushed head with the cloud rows (ordered by ts) and keeps the unpushed tail', () => {
    const local = [e(1), e(2), e(9) /* unpushed */];
    const r = _mergeActivityLog(local, 2, [e(3), e(1), e(2)], false);
    assert.deepEqual(r.head.map(x => x.ts), [1, 2, 3]);
    assert.deepEqual(r.merged.map(x => x.ts), [1, 2, 3, 9]);
    assert.deepEqual(r.unpushed.map(x => x.ts), [9]);
  });
  test('strips server-only columns such as created_at', () => {
    const r = _mergeActivityLog([], 0, [withCreated(e(1), '2026-11-04T00:00:00Z')], false);
    assert.deepEqual(Object.keys(r.head[0]).sort(), ['action', 'actor', 'changes', 'key', 'ts']);
  });
});

describe('_mergeActivityLog — delta pull', () => {
  test('appends only entries the pushed head does not already have', () => {
    const local = [e(1), e(2)];
    const r = _mergeActivityLog(local, 2, [withCreated(e(2), 'x'), withCreated(e(3), 'y')], true);
    assert.deepEqual(r.merged.map(x => x.ts), [1, 2, 3]);
    assert.equal(r.head.length, 3);
  });
  test('own entries pushed during the overlap window are not duplicated', () => {
    const own = e(5, 'sheetA', 'save', 'me');
    const r = _mergeActivityLog([e(1), own], 2, [withCreated(own, 'z')], true);
    assert.equal(r.merged.length, 2);
  });
  test('an unpushed local tail survives and stays after the head', () => {
    const r = _mergeActivityLog([e(1), e(50)], 1, [withCreated(e(10), 'a')], true);
    assert.deepEqual(r.merged.map(x => x.ts), [1, 10, 50]);
    assert.deepEqual(r.unpushed.map(x => x.ts), [50]);
    assert.equal(r.head.length, 2);
  });
  test('a late-arriving entry with an older ts is slotted in chronologically', () => {
    const r = _mergeActivityLog([e(1), e(100)], 2, [withCreated(e(50), 'a')], true);
    assert.deepEqual(r.merged.map(x => x.ts), [1, 50, 100]);
  });
  test('empty delta changes nothing', () => {
    const local = [e(1), e(2), e(3)];
    const r = _mergeActivityLog(local, 3, [], true);
    assert.deepEqual(r.merged, local);
  });
});

describe('delta merge of keyed rows must not treat untouched local rows as local-only', () => {
  const tsOf = r => r._updatedAt || 0;
  test('only delta keys are compared, so localWonSomething stays false', () => {
    const local = { a: { _updatedAt: 1 }, b: { _updatedAt: 1 }, c: { _updatedAt: 1 } };
    const delta = { b: { _updatedAt: 5 } };
    const only = (m, keys) => Object.fromEntries(keys.filter(k => k in m).map(k => [k, m[k]]));
    const res = _mergeByKey(only(local, Object.keys(delta)), delta, tsOf, null);
    assert.equal(res.localWonSomething, false);
    assert.deepEqual(res.cloudWonKeys, ['b']);
    assert.deepEqual({ ...local, ...res.merged }.b, { _updatedAt: 5 });
  });
  test('a newer local edit to a delta key is still pushed back', () => {
    const res = _mergeByKey({ b: { _updatedAt: 9 } }, { b: { _updatedAt: 5 } }, tsOf, null);
    assert.equal(res.localWonSomething, true);
  });
});

describe('_maxIso / _pickPullMode', () => {
  test('_maxIso never goes backwards and ignores bad values', () => {
    assert.equal(_maxIso([{ t: '2026-11-04T01:00:00Z' }, { t: null }, { t: 'junk' }], 't', '2026-11-04T02:00:00Z'), '2026-11-04T02:00:00Z');
    assert.equal(_maxIso([{ t: '2026-11-04T03:00:00Z' }], 't', '2026-11-04T02:00:00Z'), '2026-11-04T03:00:00Z');
    assert.equal(_maxIso([], 't', null), null);
  });
  const fresh = { sheets: 'a', cl: 'b', al: 'c', fullAt: 1_000_000 };
  test('no cursor, manual, or a stale cursor → full', () => {
    assert.equal(_pickPullMode(null, false, false, 1_000_100), 'full');
    assert.equal(_pickPullMode(fresh, true, true, 1_000_100), 'full');
    assert.equal(_pickPullMode(fresh, false, true, 1_000_000 + 7 * 3600 * 1000), 'full');
  });
  test('first pull of a page load → session, afterwards → delta', () => {
    assert.equal(_pickPullMode(fresh, false, false, 1_000_100), 'session');
    assert.equal(_pickPullMode(fresh, false, true, 1_000_100), 'delta');
  });
});

test('_alId is the documented identity', () => {
  assert.equal(_alId(e(7, 'K', 'save', 'bob')), '7|bob|K|save');
});

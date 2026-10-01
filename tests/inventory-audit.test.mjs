import './setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIT_CODES, normalizeRows, nonZeroItems, findNotFound, buildSnapshot } from '../js/inventory-audit.js';

test('audit list has the 31 specified codes, without 894319/894327/894329', () => {
  assert.equal(AUDIT_CODES.length, 31);
  for (const c of ['894319', '894327', '894329']) assert.ok(!AUDIT_CODES.includes(c));
});

test('normalizeRows coerces qty, drops junk, sorts by code', () => {
  const out = normalizeRows([
    { code: '894302', name: ' B ', qty: '3' },
    { code: '894301', name: 'A', qty: -2 },
    { code: '', name: 'x', qty: 1 },
    { code: '894303', name: 'C', qty: 'abc' }
  ]);
  assert.deepEqual(out.map(r => r.code), ['894301', '894302']);
  assert.equal(out[1].qty, 3);
});

test('nonZeroItems keeps positive and negative, drops zero', () => {
  const r = nonZeroItems([{ code: 'a', qty: 0 }, { code: 'b', qty: -1 }, { code: 'c', qty: 5 }]);
  assert.deepEqual(r.map(x => x.code), ['b', 'c']);
});

test('findNotFound reports missing codes', () => {
  const rows = AUDIT_CODES.slice(1).map(code => ({ code, name: '', qty: 0 }));
  assert.deepEqual(findNotFound(rows), [AUDIT_CODES[0]]);
});

test('buildSnapshot records code, qty, timestamp, staff id per non-zero item', () => {
  const now = new Date('2026-10-01T10:00:00Z');
  const s = buildSnapshot({
    rows: [{ code: '894301', name: 'A', qty: 4 }, { code: '894302', name: 'B', qty: 0 }],
    notFound: [], staff: { staffId: '7', staffName: 'Ali' }, sheetKey: 'k', now
  });
  assert.equal(s.items.length, 1);
  assert.deepEqual(s.items[0], { code: '894301', name: 'A', verifiedQty: 4, verifiedAt: now.toISOString(), staffId: '7' });
  assert.equal(s.staffId, '7');
});

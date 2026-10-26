import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './setup.mjs';
import { closingGateCheck } from '../js/actions.js';
import { _waitForNotifyAck } from '../js/sync.js';
import { invAuditIsVerified, invAuditReset, invAuditRestore } from '../js/inventory-audit.js';

const noSleep = () => Promise.resolve();

describe('closingGateCheck', () => {
  test('blocks when the inventory audit is not verified (and says where to go)', () => {
    const r = closingGateCheck({ auditVerified: false, cloudReady: true, offline: false });
    assert.equal(r.ok, false);
    assert.equal(r.jump, 'invaudit');
  });
  test('blocks when cloud sync is not connected', () => {
    assert.equal(closingGateCheck({ auditVerified: true, cloudReady: false, offline: false }).ok, false);
  });
  test('blocks when offline', () => {
    assert.equal(closingGateCheck({ auditVerified: true, cloudReady: true, offline: true }).ok, false);
  });
  test('passes when verified, connected and online', () => {
    assert.deepEqual(closingGateCheck({ auditVerified: true, cloudReady: true, offline: false }), { ok: true });
  });
});

describe('invAuditIsVerified', () => {
  test('false until a snapshot exists, true once restored', () => {
    invAuditReset();
    assert.equal(invAuditIsVerified(), false);
    invAuditRestore({ items: [], codesChecked: 31 });
    assert.equal(invAuditIsVerified(), true);
    invAuditReset();
    assert.equal(invAuditIsVerified(), false);
  });
});

describe('_waitForNotifyAck', () => {
  test('succeeds once a NEW log row reports 2xx', async () => {
    const seq = [{ log_id: 5 }, { log_id: 6, status_code: null }, { log_id: 6, status_code: 200, ok: true }];
    let i = 0;
    const r = await _waitForNotifyAck(async () => seq[Math.min(i++, seq.length - 1)], 5, { sleep: noSleep });
    assert.deepEqual(r, { ok: true });
  });
  test('ignores a stale success from an older notification', async () => {
    const r = await _waitForNotifyAck(async () => ({ log_id: 5, status_code: 200, ok: true }), 5,
      { sleep: noSleep, timeoutMs: 3000, intervalMs: 1000 });
    assert.equal(r.ok, false);
    assert.match(r.message, /not confirmed/);
  });
  test('fails with the status when the function replied non-2xx', async () => {
    const r = await _waitForNotifyAck(async () => ({ log_id: 7, status_code: 500, ok: false, error: null }), 6, { sleep: noSleep });
    assert.equal(r.ok, false);
    assert.match(r.message, /500/);
  });
});

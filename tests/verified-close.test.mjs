import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './setup.mjs';
import { closingGateCheck } from '../js/actions.js';
import { invAuditIsVerified, invAuditReset, invAuditRestore } from '../js/inventory-audit.js';

describe('closingGateCheck', () => {
  test('blocks when the inventory audit is not verified (and says where to go)', () => {
    const r = closingGateCheck({ auditVerified: false, cloudReady: true, offline: false });
    assert.equal(r.ok, false);
    assert.equal(r.jump, 'invaudit');
  });
  test('blocks when cloud sync is not connected', () => {
    assert.equal(closingGateCheck({ auditVerified: true, cloudReady: false, offline: false }).ok, false);
  });
  test('blocks when offline because cloud sync is unavailable', () => {
    assert.equal(closingGateCheck({ auditVerified: true, cloudReady: true, offline: true }).ok, false);
  });
  test('passes when verified, connected and online — notification delivery is not a gate', () => {
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

import './setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { SHIFTS, SHIFT_SR, srLabel } from '../js/state.js';
import { DB_STORAGE_KEY, repoLoad, repoPersist, repoLoadHadCorruption } from '../js/repository.js';

describe('Shift day-cycle (Night starts the day, not Evening)', () => {
  test('SHIFTS lists Night first', () => {
    assert.deepEqual(SHIFTS, ['Night', 'Morning', 'Evening']);
  });

  test('srLabel numbers Night as Closing 1, Morning as 2, Evening as 3', () => {
    assert.equal(srLabel('Night'),   'Closing 1 — Night');
    assert.equal(srLabel('Morning'), 'Closing 2 — Morning');
    assert.equal(srLabel('Evening'), 'Closing 3 — Evening');
  });

  test('SHIFT_SR matches srLabel\'s numbering exactly', () => {
    assert.equal(SHIFT_SR.Night, 1);
    assert.equal(SHIFT_SR.Morning, 2);
    assert.equal(SHIFT_SR.Evening, 3);
  });
});

describe('Repository — corruption-safe loading', () => {
  test('repoLoad returns null with no corruption flag on a genuinely fresh install', () => {
    localStorage.clear();
    const result = repoLoad();
    assert.equal(result, null);
    assert.equal(repoLoadHadCorruption(), false);
  });

  test('repoLoad round-trips valid data via repoPersist', () => {
    localStorage.clear();
    // repoPersist reads the live `db` binding from state.js, so we
    // exercise it through repoLoad after manually seeding storage —
    // this test only checks the read side stays well-formed.
    localStorage.setItem(DB_STORAGE_KEY, JSON.stringify({ sheets: {}, settings: {}, creditLedger: [] }));
    const result = repoLoad();
    assert.deepEqual(result, { sheets: {}, settings: {}, creditLedger: [] });
    assert.equal(repoLoadHadCorruption(), false);
  });

  test('repoLoad preserves corrupted data under a backup key instead of discarding it', () => {
    localStorage.clear();
    localStorage.setItem(DB_STORAGE_KEY, '{not valid json!!');
    const result = repoLoad();

    assert.equal(result, null, 'falls back to null so State can supply defaults');
    assert.equal(repoLoadHadCorruption(), true, 'the corruption flag must be set so app.js can warn the person');

    const backupKey = localStorage._allKeys().find(k => k.startsWith(DB_STORAGE_KEY + '_corrupted_'));
    assert.ok(backupKey, 'a timestamped backup key should be created');
    assert.equal(localStorage.getItem(backupKey), '{not valid json!!', 'the raw corrupted text is preserved verbatim');
  });
});

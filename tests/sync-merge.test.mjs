import './setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { _mergeByKey } from '../js/sync.js';

const tsOf = r => r._updatedAt || r.savedAt || 0;
const isDraft = r => !!r.draft;

describe('_mergeByKey — finalized save must beat a later draft', () => {
  test('a newer local DRAFT does not overwrite an older cloud SAVE', () => {
    // Mobile saved (finalized) the closing at t=1000.
    const cloud = { k1: { draft: false, _updatedAt: 1000, note: 'mobile-save' } };
    // Desktop's autosave fired afterwards, at t=2000, but it's still just a draft.
    const local = { k1: { draft: true, _updatedAt: 2000, note: 'desktop-draft' } };

    const { merged, cloudWonKeys, localWonSomething } = _mergeByKey(local, cloud, tsOf, isDraft);

    assert.equal(merged.k1.draft, false, 'finalized cloud save must win despite older timestamp');
    assert.equal(merged.k1.note, 'mobile-save');
    assert.ok(cloudWonKeys.includes('k1'), 'cloud must be reported as the winner so the open ledger view refreshes/locks');
    assert.equal(localWonSomething, false, 'the stale local draft must not be pushed back up and clobber the save');
  });

  test('a newer local SAVE still beats an older cloud draft', () => {
    const cloud = { k1: { draft: true, _updatedAt: 1000 } };
    const local = { k1: { draft: false, _updatedAt: 2000 } };

    const { merged, localWonSomething } = _mergeByKey(local, cloud, tsOf, isDraft);

    assert.equal(merged.k1.draft, false);
    assert.equal(localWonSomething, true);
  });

  test('two finalized saves still resolve by timestamp (latest edit wins)', () => {
    const cloud = { k1: { draft: false, _updatedAt: 1000 } };
    const local = { k1: { draft: false, _updatedAt: 2000 } };

    const { merged, localWonSomething } = _mergeByKey(local, cloud, tsOf, isDraft);

    assert.equal(merged.k1._updatedAt, 2000);
    assert.equal(localWonSomething, true);
  });

  test('two drafts still resolve by timestamp as before', () => {
    const cloud = { k1: { draft: true, _updatedAt: 2000 } };
    const local = { k1: { draft: true, _updatedAt: 1000 } };

    const { merged, cloudWonKeys } = _mergeByKey(local, cloud, tsOf, isDraft);

    assert.equal(merged.k1._updatedAt, 2000);
    assert.ok(cloudWonKeys.includes('k1'));
  });

  test('credit_ledger merges (no isDraft arg) are unaffected — pure timestamp rule', () => {
    const cloud = { k1: { savedAt: 1000 } };
    const local = { k1: { savedAt: 2000 } };

    const { merged, localWonSomething } = _mergeByKey(local, cloud, r => r.savedAt || 0);

    assert.equal(merged.k1.savedAt, 2000);
    assert.equal(localWonSomething, true);
  });
});

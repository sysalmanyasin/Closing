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

/* ───────────── Settings merge: factory defaults must never win ───────────── */
import { _mergeSettings } from '../js/sync.js';
import { isSeedSettings } from '../js/state.js';

const seed = () => ({
  namedCredits: [{label:"Corporate Account"},{label:"Wholesale Ledger"},{label:"Third Party Tab"}],
  subTiers: [
    {type:"Staff Credit",   names:["Dr. Salman","Asif Malik","Kashif Shah"]},
    {type:"Delivery Staff", names:["Raza Hazrat","Noman Ali","Saeed Khan"]},
    {type:"Branch Tabs",    names:["Johar Town","DHA Branch","Bahria Pool"]}
  ],
  strips: [
    {name:"Water 1.5L",price:17,group:"Water"},{name:"Water 500ml",price:28,group:"Water"},
    {name:"Water 330ml",price:0,group:"Water"},{name:"Regular Strips",price:10,group:""},
    {name:"Pura Water 1L",price:16,group:"Water"},{name:"Pura Water 0.5L",price:28,group:"Water"},
    {name:"Juice Pack 60x",price:0,group:"Nestlé Juice"},{name:"Juice Pack 80x",price:60,group:"Nestlé Juice"},
    {name:"Juice Pack 140x",price:5,group:"Nestlé Juice"},{name:"Juice Pack 150x",price:4,group:"Nestlé Juice"},
    {name:"Juice Pack 250x",price:6,group:"Nestlé Juice"}
  ]
});
const real = () => ({ ...seed(), strips: [{name:"Water 1.5L",price:100,group:"Water"},{name:"Sugar Strips",price:60,group:"Strips"}] });

describe('_mergeSettings — wiped device must not reset real settings', () => {
  test('recognises factory-default settings', () => {
    assert.equal(isSeedSettings(seed()), true);
    assert.equal(isSeedSettings(real()), false);
  });

  test('REGRESSION 2026-09-28: default local settings with a NEWER timestamp still lose to real cloud settings', () => {
    const local = { ...seed(), _updatedAt: 9_999_999 };   // stamped by an ordinary save on a wiped device
    const cloud = { ...real(), _updatedAt: 1_000 };
    const { settings, keptLocal } = _mergeSettings(local, cloud);
    assert.equal(settings.strips[0].price, 100, 'real cloud prices must survive');
    assert.equal(keptLocal, false, 'defaults must not be pushed back up');
  });

  test('a genuine newer local edit still beats older cloud settings', () => {
    const local = { ...real(), strips: [{name:"Water 1.5L",price:120,group:"Water"}], _updatedAt: 2_000 };
    const cloud = { ...real(), _updatedAt: 1_000 };
    const { settings, keptLocal } = _mergeSettings(local, cloud);
    assert.equal(settings.strips[0].price, 120);
    assert.equal(keptLocal, true);
  });

  test('older local real settings lose to newer cloud settings', () => {
    const { settings } = _mergeSettings({ ...real(), _updatedAt: 1 }, { ...real(), strips: [{name:"X",price:1,group:""}], _updatedAt: 5 });
    assert.equal(settings.strips[0].name, 'X');
  });

  test('empty cloud: real local settings are kept and pushed; defaults are not pushed', () => {
    assert.equal(_mergeSettings(real(), null).keptLocal, true);
    assert.equal(_mergeSettings(seed(), null).keptLocal, false);
  });
});

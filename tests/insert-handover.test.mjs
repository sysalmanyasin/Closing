import './setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { db, getSeq } from '../js/state.js';
import { computeNextHandoverSlot } from '../js/actions.js';

function resetSheets() { db.sheets = {}; }

describe('computeNextHandoverSlot', () => {
  test('refuses when nothing is saved for the date yet', () => {
    resetSheets();
    const result = computeNextHandoverSlot('2026-07-05');
    assert.ok(result.error);
    assert.match(result.error, /Night/);
  });

  test('refuses even if OTHER records exist for the date, as long as Night specifically is missing', () => {
    resetSheets();
    db.sheets['2026-07-05_Evening'] = { draft: false }; /* unusual, but Night is still what's required */
    const result = computeNextHandoverSlot('2026-07-05');
    assert.ok(result.error);
    assert.match(result.error, /Night/);
  });

  test("first Handover after only Night is saved gets seq 30 (Morning's implicit slot is reserved even though Morning hasn't been saved yet)", () => {
    resetSheets();
    db.sheets['2026-07-05_Night'] = { draft: false };
    const result = computeNextHandoverSlot('2026-07-05');
    assert.equal(result.key, '2026-07-05_Handover1');
    assert.equal(result.shift, 'Handover1');
    assert.equal(result.seq, 30); /* Night=10, Morning's reserved slot=20, +10 */
  });

  test("regression: a Handover inserted before Morning is saved must still sort AFTER Morning once Morning IS saved", () => {
    resetSheets();
    db.sheets['2026-07-05_Night'] = { draft: false };
    /* Handover created early, before Morning exists at all — this is
       the exact real-world sequence that used to collide (seq 20
       tying with Morning's later implicit seq 20). */
    const slot = computeNextHandoverSlot('2026-07-05');
    db.sheets[slot.key] = { draft: false, seq: slot.seq, shiftLabel: 'Handover' };
    /* Morning gets saved afterward, the normal way — no explicit seq,
       same as every ordinary Morning save in this app. */
    db.sheets['2026-07-05_Morning'] = { draft: false };

    assert.equal(getSeq('2026-07-05', 'Morning'), 20);
    assert.ok(slot.seq > getSeq('2026-07-05', 'Morning'), "Handover seq must be greater than (sort after) Morning's seq");
  });

  test('first Handover after Night+Morning are saved gets seq 30', () => {
    resetSheets();
    db.sheets['2026-07-05_Night']   = { draft: false };
    db.sheets['2026-07-05_Morning'] = { draft: false };
    const result = computeNextHandoverSlot('2026-07-05');
    assert.equal(result.key, '2026-07-05_Handover1');
    assert.equal(result.seq, 30); /* Morning=20, +10 */
  });

  test('a second Handover gets the next available number AND correct seq', () => {
    resetSheets();
    db.sheets['2026-07-05_Night']     = { draft: false };
    db.sheets['2026-07-05_Morning']   = { draft: false };
    db.sheets['2026-07-05_Handover1'] = { draft: false, seq: 30, shiftLabel: 'Handover' };
    const result = computeNextHandoverSlot('2026-07-05');
    assert.equal(result.key, '2026-07-05_Handover2');
    assert.equal(result.seq, 40); /* Handover1=30, +10 */
  });

  test('inserting after Evening is already saved still slots BEFORE Evening, not after it', () => {
    resetSheets();
    db.sheets['2026-07-05_Night']   = { draft: false };
    db.sheets['2026-07-05_Morning'] = { draft: false };
    db.sheets['2026-07-05_Evening'] = { draft: false };
    const result = computeNextHandoverSlot('2026-07-05');
    assert.equal(result.key, '2026-07-05_Handover1');
    assert.equal(result.seq, 30); /* Morning=20, +10 — Evening (9999) is excluded from the max on purpose */
    assert.ok(result.seq < 9999, 'a Handover must never sort after Evening');
  });

  test('reuses the lowest available Handover number if one was deleted', () => {
    resetSheets();
    db.sheets['2026-07-05_Night']     = { draft: false };
    db.sheets['2026-07-05_Handover2'] = { draft: false, seq: 20, shiftLabel: 'Handover' }; /* Handover1 deleted, 2 remains */
    const result = computeNextHandoverSlot('2026-07-05');
    assert.equal(result.key, '2026-07-05_Handover1'); /* fills the gap rather than jumping to 3 */
  });

  test('two different dates never interfere with each other\u2019s numbering', () => {
    resetSheets();
    db.sheets['2026-07-05_Night'] = { draft: false };
    db.sheets['2026-07-06_Night'] = { draft: false };
    db.sheets['2026-07-06_Handover1'] = { draft: false, seq: 20, shiftLabel: 'Handover' };
    const resultA = computeNextHandoverSlot('2026-07-05');
    const resultB = computeNextHandoverSlot('2026-07-06');
    assert.equal(resultA.key, '2026-07-05_Handover1');
    assert.equal(resultB.key, '2026-07-06_Handover2');
  });
});

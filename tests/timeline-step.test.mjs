import './setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { db } from '../js/state.js';
import { timelineStep } from '../js/components.js';

/* ── Reference oracle: the EXACT old implementation, copied verbatim,
   before this session's rewrite. Pure calendar math on a fixed
   3-name array, no awareness of db.sheets at all. If the new
   sheets-aware timelineStep produces anything different from this for
   a date with no Handovers, that's a regression in existing behavior
   — the one thing we are not allowed to break. ── */
const OLD_SHIFTS = ["Night","Morning","Evening"];
function oldTimelineStep(ds, shift, n) {
  let d   = new Date(ds);
  let idx = OLD_SHIFTS.indexOf(shift) + n;
  if(idx >= OLD_SHIFTS.length) {
    d.setDate(d.getDate() + Math.floor(idx/OLD_SHIFTS.length)); idx = idx % OLD_SHIFTS.length;
  } else if(idx < 0) {
    const steps = Math.ceil(Math.abs(idx)/OLD_SHIFTS.length);
    d.setDate(d.getDate() - steps);
    idx = (OLD_SHIFTS.length + (idx % OLD_SHIFTS.length)) % OLD_SHIFTS.length;
  }
  const outDs = d.toISOString().split('T')[0];
  return {key:`${outDs}_${OLD_SHIFTS[idx]}`, date:outDs, shift:OLD_SHIFTS[idx]};
}

function resetSheets() { db.sheets = {}; }

describe('timelineStep — regression: identical to the old implementation when no Handovers exist', () => {
  const dates  = ['2026-07-01', '2026-07-05', '2026-07-31', '2026-12-31', '2027-01-01'];
  const shifts = ['Night', 'Morning', 'Evening'];
  const steps  = [-5, -3, -2, -1, 0, 1, 2, 3, 5];

  test('matches the old pure-calendar-math implementation across dates/shifts/step sizes', () => {
    resetSheets(); /* empty db.sheets — the "no data exists yet" case every date starts in */
    dates.forEach(ds => {
      shifts.forEach(shift => {
        steps.forEach(n => {
          const oldResult = oldTimelineStep(ds, shift, n);
          const newResult = timelineStep(ds, shift, n);
          assert.deepEqual(
            newResult, oldResult,
            `mismatch at ds=${ds} shift=${shift} n=${n}: old=${JSON.stringify(oldResult)} new=${JSON.stringify(newResult)}`
          );
        });
      });
    });
  });

  test('matches the old implementation even when Night/Morning/Evening ARE saved (still no Handovers)', () => {
    resetSheets();
    ['2026-07-04', '2026-07-05', '2026-07-06'].forEach(ds => {
      ['Night', 'Morning', 'Evening'].forEach(shift => {
        db.sheets[`${ds}_${shift}`] = { draft: false, profileMode: 'shift' };
      });
    });
    dates.forEach(ds => {
      shifts.forEach(shift => {
        steps.forEach(n => {
          assert.deepEqual(timelineStep(ds, shift, n), oldTimelineStep(ds, shift, n));
        });
      });
    });
  });

  test('large step counts still match (closing-book.js calls with large n)', () => {
    resetSheets();
    for(let n = -20; n <= 20; n++) {
      assert.deepEqual(timelineStep('2026-07-05', 'Morning', n), oldTimelineStep('2026-07-05', 'Morning', n));
    }
  });
});

describe('timelineStep — new behavior: a Handover slot is a real, addressable stop', () => {
  test('stepping forward from Morning lands on a same-day Handover before reaching Evening', () => {
    resetSheets();
    db.sheets['2026-07-05_Morning']   = { draft: false, seq: 20 };
    db.sheets['2026-07-05_Handover1'] = { draft: false, seq: 30, shiftLabel: 'Handover' };
    const next = timelineStep('2026-07-05', 'Morning', 1);
    assert.equal(next.key, '2026-07-05_Handover1');
  });

  test('stepping forward again from that Handover lands on Evening, not the next day', () => {
    resetSheets();
    db.sheets['2026-07-05_Morning']   = { draft: false, seq: 20 };
    db.sheets['2026-07-05_Handover1'] = { draft: false, seq: 30, shiftLabel: 'Handover' };
    const next = timelineStep('2026-07-05', 'Handover1', 1);
    assert.equal(next.key, '2026-07-05_Evening');
  });

  test('stepping backward from Evening lands on the Handover, not Morning', () => {
    resetSheets();
    db.sheets['2026-07-05_Morning']   = { draft: false, seq: 20 };
    db.sheets['2026-07-05_Handover1'] = { draft: false, seq: 30, shiftLabel: 'Handover' };
    const prev = timelineStep('2026-07-05', 'Evening', -1);
    assert.equal(prev.key, '2026-07-05_Handover1');
  });

  test('multiple Handovers in one day are walked in seq order', () => {
    resetSheets();
    db.sheets['2026-07-05_Morning']   = { draft: false, seq: 20 };
    db.sheets['2026-07-05_Handover1'] = { draft: false, seq: 30, shiftLabel: 'Handover' };
    db.sheets['2026-07-05_Handover2'] = { draft: false, seq: 40, shiftLabel: 'Handover' };
    assert.equal(timelineStep('2026-07-05', 'Morning', 1).key,   '2026-07-05_Handover1');
    assert.equal(timelineStep('2026-07-05', 'Morning', 2).key,   '2026-07-05_Handover2');
    assert.equal(timelineStep('2026-07-05', 'Morning', 3).key,   '2026-07-05_Evening');
    assert.equal(timelineStep('2026-07-05', 'Handover2', -2).key, '2026-07-05_Morning');
  });

  test('crossing into a date WITH Handovers from the next day still lands on Evening (the fixed last anchor)', () => {
    resetSheets();
    db.sheets['2026-07-05_Morning']   = { draft: false, seq: 20 };
    db.sheets['2026-07-05_Handover1'] = { draft: false, seq: 30, shiftLabel: 'Handover' };
    /* one step back from tomorrow's Night must land on today's Evening,
       skipping past today's Handover — Evening is always last, by construction */
    const prev = timelineStep('2026-07-06', 'Night', -1);
    assert.equal(prev.key, '2026-07-05_Evening');
  });

  test('Handovers on one date do not affect an adjacent date with none', () => {
    resetSheets();
    db.sheets['2026-07-05_Handover1'] = { draft: false, seq: 30, shiftLabel: 'Handover' };
    /* 2026-07-06 has no handovers — must behave exactly like the plain 3-slot world */
    assert.deepEqual(timelineStep('2026-07-06', 'Morning', 1), oldTimelineStep('2026-07-06', 'Morning', 1));
    assert.deepEqual(timelineStep('2026-07-06', 'Morning', -1), oldTimelineStep('2026-07-06', 'Morning', -1));
  });
});

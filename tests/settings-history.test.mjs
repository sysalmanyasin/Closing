import './setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { describeVersion, renderVersionList, errorMessage } from '../js/settings-history.js';

const v = {
  id: 7, replaced_at: '2026-09-29T05:35:00Z', n_strips: 19,
  strip_prices: [100, 70, 60, 60, 350, 230, 60, 80, 150, 150], named_credits: ['Salman Jazz Cash', 'Guard Incentive', 'Pharmacy Use'],
  n_tiers: 3, n_staff: 5
};

describe('settings-history — display helpers', () => {
  test('describeVersion summarises prices, credits, staff and tiers', () => {
    const d = describeVersion(v, 'en-US');
    assert.equal(d.id, 7);
    assert.match(d.lines[0], /^19 inventory items — 100, 70, 60, 60, 350, 230, 60, 80, …$/);
    assert.match(d.lines[1], /Salman Jazz Cash, Guard Incentive, Pharmacy Use/);
    assert.match(d.lines[2], /5 staff · 3 credit tiers/);
    assert.ok(d.when.length > 0);
  });

  test('handles an empty/odd version without throwing', () => {
    const d = describeVersion({ id: 1, replaced_at: 'nonsense' });
    assert.equal(d.when, '');
    assert.match(d.lines[1], /Credits: —/);
  });

  test('renderVersionList escapes user text (credit labels) and wires the restore button by numeric id', () => {
    const html = renderVersionList([{ ...v, named_credits: ['<img src=x onerror=alert(1)>'] }]);
    assert.ok(!html.includes('<img src=x'), 'label must be HTML-escaped');
    assert.ok(html.includes('restoreSettingsVersion(7)'));
  });

  test('empty list shows a friendly message', () => {
    assert.match(renderVersionList([]), /No archived versions/);
  });

  test('server error codes map to readable messages', () => {
    assert.match(errorMessage('wrong_pin'), /Incorrect Admin PIN/);
    assert.match(errorMessage('too_many_attempts'), /10 minutes/);
    assert.match(errorMessage('something_else'), /something_else/);
  });
});

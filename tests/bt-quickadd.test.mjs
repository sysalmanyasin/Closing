/* ═══════════════════════════════════════════════════════════════
   END-TO-END: BT Quick Add (Credit Ledger page → bt-bridge.js)
   Loads the REAL index.html into jsdom and drives the REAL modules,
   with a mocked window.supabase.createClient standing in for the
   network. Covers:
   1. fetchStaff()/fetchCustomLedgerTypes() parse the real column
      shapes confirmed via direct SQL inspection (id/data.name/
      data.active for bt_staff; type/data.label/data.categories for
      bt_ledger_custom_types).
   2. btQaInit() populates the section dropdown with the 3 built-ins
      PLUS BT's live custom "Other Sections", addressed by their real
      ledger_type strings (e.g. 'custom:less-amounts').
   3. btQaSectionChange() renders the right fields per section —
      only Jazz Cash gets a shift picker; Staff Credit lists only
      ACTIVE staff; a custom type's own categories render correctly.
   4. btQaSubmit() inserts the right row shape into the right table
      for jazzcash / a custom type / staffCredit, and validates
      amount/date/category before ever calling the network.
═══════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });

global.window   = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.localStorage = dom.window.localStorage;
global.alert = () => {};

/* ── Fake Supabase client ──────────────────────────────────────────
   Records every .from(table).insert(row) call; serves canned
   .select() responses per table, taken verbatim from the real rows
   returned by the SQL inspection queries earlier in this project. */
const insertCalls = [];
const FAKE_STAFF_ROWS = [
  { id: 's1', data: { name: 'Ali Raza',  active: true  } },
  { id: 's2', data: { name: 'Sara Khan', active: false } },
];
const FAKE_CUSTOM_TYPE_ROWS = [
  { type: 'custom:pharmacy', data: { label: 'Pharmacy', categories: [
    { id: 'cat0_mresrig9', icon: '⬆', sign: 1, color: 'var(--green)', label: 'Cash' } ] } },
  { type: 'custom:less-amount', data: { label: 'Miscellaneous', categories: [
    { id: 'cat0', icon: '⬆', sign: 1, color: 'var(--green)', label: 'Cuff' },
    { id: 'cat1', icon: '⬆', sign: 1, color: 'var(--green)', label: 'Durex' } ] } },
  { type: 'custom:less-amounts', data: { label: 'Less Amounts', categories: [
    { id: 'cat0', icon: '⬇', sign: -1, color: 'var(--red)', label: 'Salary' },
    { id: 'cat1', icon: '⬇', sign: -1, color: 'var(--red)', label: 'Overtime' },
    { id: 'cat2', icon: '⬇', sign: -1, color: 'var(--red)', label: 'Generic' } ] } },
  { type: 'custom:extra-credits', data: { label: 'Extra Credits', categories: [
    { id: 'cat0_mrstt8j3', icon: '⬆', sign: 1, color: 'var(--green)', label: 'Adnan Guard' } ] } },
  { type: 'custom:adjustments-strips', data: { label: 'Adjustments & Strips', categories: [
    { id: 'cat0_mresv4ep', icon: '⬇', sign: -1, color: 'var(--red)', label: 'Strips' } ] } },
];

function makeQueryBuilder(table) {
  const result = () => Promise.resolve(
    table === 'bt_staff'               ? { data: FAKE_STAFF_ROWS, error: null } :
    table === 'bt_ledger_custom_types' ? { data: FAKE_CUSTOM_TYPE_ROWS, error: null } :
    { data: [], error: null }
  );
  const builder = {
    select() { return builder; },
    eq()     { return builder; },
    order()  { return builder; },
    limit()  { return builder; },
    single()      { return result(); },
    maybeSingle() { return result(); },
    then(resolve, reject) { return result().then(resolve, reject); },
    insert(row) { insertCalls.push({ table, row }); return Promise.resolve({ error: null }); },
    upsert(row) { insertCalls.push({ table, row, upsert: true }); return Promise.resolve({ error: null }); },
  };
  return builder;
}

function makeFakeChannel() {
  const channel = { on() { return channel; }, subscribe() { return channel; } };
  return channel;
}

function makeFakeClient() {
  return {
    from(table) { return makeQueryBuilder(table); },
    channel() { return makeFakeChannel(); },
    auth: {
      getSession() { return Promise.resolve({ data: { session: null } }); },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      signInWithPassword() { return Promise.resolve({ error: null }); },
      signOut() { return Promise.resolve({ error: null }); },
    },
  };
}
window.supabase = { createClient: () => makeFakeClient() };

test('BT Quick Add — driven through the real app with a mocked Supabase client', async (t) => {
  const Pages = await import('../js/pages.js');

  await t.test('btQaInit() populates section dropdown with built-ins + live custom sections', async () => {
    await Pages.btQaInit();
    const sel = document.getElementById('bt-qa-section');
    const labels = Array.from(sel.options).map(o => o.textContent);
    assert.ok(labels.some(l => l.includes('Jazz Cash')));
    assert.ok(labels.some(l => l.includes('Staff Credit')));
    assert.ok(labels.some(l => l.includes('Expenses')));
    assert.ok(labels.some(l => l.includes('Pharmacy')));
    assert.ok(labels.some(l => l.includes('Less Amounts')));
    const values = Array.from(sel.options).map(o => o.value);
    assert.ok(values.includes('custom:less-amounts'), 'custom section must be addressed by its real ledger_type string');
  });

  await t.test('jazzcash section shows a shift picker and the 5 real BT categories', () => {
    document.getElementById('bt-qa-section').value = 'jazzcash';
    Pages.btQaSectionChange();
    assert.ok(document.getElementById('bt-qa-shift'), 'jazzcash should show a shift picker');
    const catLabels = Array.from(document.getElementById('bt-qa-cat').options).map(o => o.textContent);
    assert.ok(catLabels.some(l => l.includes('Received')));
    assert.ok(catLabels.some(l => l.includes('Transfer')));
  });

  await t.test('expense section shows no shift picker', () => {
    document.getElementById('bt-qa-section').value = 'expense';
    Pages.btQaSectionChange();
    assert.equal(document.getElementById('bt-qa-shift'), null, 'only jazzcash should show a shift picker');
    const catLabels = Array.from(document.getElementById('bt-qa-cat').options).map(o => o.textContent);
    assert.ok(catLabels.some(l => l.includes('Fuel')));
  });

  await t.test('staffCredit section lists only ACTIVE staff', () => {
    document.getElementById('bt-qa-section').value = 'staffCredit';
    Pages.btQaSectionChange();
    const opts = Array.from(document.getElementById('bt-qa-staff').options);
    assert.ok(opts.some(o => o.textContent === 'Ali Raza'));
    assert.ok(!opts.some(o => o.textContent === 'Sara Khan'), 'inactive staff must not appear');
  });

  await t.test('a custom section renders its OWN category list', () => {
    document.getElementById('bt-qa-section').value = 'custom:less-amounts';
    Pages.btQaSectionChange();
    const catLabels = Array.from(document.getElementById('bt-qa-cat').options).map(o => o.textContent);
    assert.ok(catLabels.some(l => l.includes('Salary')));
    assert.ok(catLabels.some(l => l.includes('Overtime')));
    assert.ok(catLabels.some(l => l.includes('Generic')));
  });

  await t.test('btQaSubmit() inserts the right row for a custom section', async () => {
    insertCalls.length = 0;
    document.getElementById('bt-qa-section').value = 'custom:less-amounts';
    Pages.btQaSectionChange();
    document.getElementById('bt-qa-cat').value = 'cat1'; // Overtime
    document.getElementById('bt-qa-amount').value = '5000';
    document.getElementById('bt-qa-desc').value = 'July overtime';
    await Pages.btQaSubmit();

    assert.equal(insertCalls.length, 1);
    assert.equal(insertCalls[0].table, 'bt_inbox_ledger');
    assert.equal(insertCalls[0].row.ledger_type, 'custom:less-amounts');
    assert.equal(insertCalls[0].row.category_id, 'cat1');
    assert.equal(insertCalls[0].row.amount, 5000);
    assert.equal(insertCalls[0].row.description, 'July overtime');
    assert.equal(insertCalls[0].row.shift, null, 'only jazzcash carries a shift');
    assert.equal(insertCalls[0].row.source, 'closing_quickadd');
    assert.equal(document.getElementById('bt-qa-status').textContent, '✓ Added to BT Sale');
  });

  await t.test('btQaSubmit() inserts the right row for Jazz Cash, including shift', async () => {
    insertCalls.length = 0;
    document.getElementById('bt-qa-section').value = 'jazzcash';
    Pages.btQaSectionChange();
    document.getElementById('bt-qa-cat').value = 'credit';
    document.getElementById('bt-qa-shift').value = 'Night';
    document.getElementById('bt-qa-amount').value = '2000';
    document.getElementById('bt-qa-desc').value = 'Cash received';
    await Pages.btQaSubmit();

    assert.equal(insertCalls[0].table, 'bt_inbox_ledger');
    assert.equal(insertCalls[0].row.ledger_type, 'jazzcash');
    assert.equal(insertCalls[0].row.category_id, 'credit');
    assert.equal(insertCalls[0].row.shift, 'Night');
  });

  await t.test('btQaSubmit() inserts into bt_inbox_staff_credit for Staff Credit, by staff id', async () => {
    insertCalls.length = 0;
    document.getElementById('bt-qa-section').value = 'staffCredit';
    Pages.btQaSectionChange();
    document.getElementById('bt-qa-staff').value = 's1';
    document.getElementById('bt-qa-amount').value = '1500';
    document.getElementById('bt-qa-desc').value = 'Advance';
    await Pages.btQaSubmit();

    assert.equal(insertCalls.length, 1);
    assert.equal(insertCalls[0].table, 'bt_inbox_staff_credit');
    assert.equal(insertCalls[0].row.staff_id, 's1');
    assert.equal(insertCalls[0].row.amount, 1500);
    assert.equal(insertCalls[0].row.source, 'closing_quickadd');
  });

  await t.test('btQaSubmit() validates amount before touching the network', async () => {
    insertCalls.length = 0;
    document.getElementById('bt-qa-section').value = 'jazzcash';
    Pages.btQaSectionChange();
    document.getElementById('bt-qa-cat').value = 'credit';
    document.getElementById('bt-qa-amount').value = ''; // missing
    await Pages.btQaSubmit();

    assert.equal(insertCalls.length, 0, 'no insert should happen without an amount');
    assert.match(document.getElementById('bt-qa-status').textContent, /Amount is required/);
  });
});

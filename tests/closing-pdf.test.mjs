import './setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { pdfPathForKey, stalePdfNames, publishClosingPdf, PDF_KEEP } from '../js/closing-pdf.js';

test('path is stable per key and sanitized', () => {
  assert.equal(pdfPathForKey('2026-11-10_Evening'), '2026-11-10_Evening.pdf');
  assert.equal(pdfPathForKey('2026-11-10_Handover 1/x'), '2026-11-10_Handover_1_x.pdf');
});

test('stale names keep only the newest 10', () => {
  const files = Array.from({ length: 13 }, (_, i) => ({ name: `f${i}.pdf` }));
  files.push({ name: '.emptyFolderPlaceholder' });
  assert.deepEqual(stalePdfNames(files), ['f10.pdf', 'f11.pdf', 'f12.pdf']);
  assert.equal(PDF_KEEP, 10);
});

function mockClient(list) {
  const calls = { upload: [], remove: [] };
  const store = {
    upload: async (p, b, o) => { calls.upload.push([p, o]); return { error: null }; },
    list: async () => ({ data: list }),
    remove: async n => { calls.remove.push(n); return {}; },
    createSignedUrl: async () => ({ data: { signedUrl: 'https://x/signed' } })
  };
  return { calls, client: { storage: { from: () => store } } };
}

test('publish upserts, prunes and notifies with Attach', async () => {
  const list = Array.from({ length: 11 }, (_, i) => ({ name: `f${i}.pdf` }));
  const { calls, client } = mockClient(list);
  let sent;
  const r = await publishClosingPdf({ size: 100 }, '2026-11-10_Evening', {
    client, topic: 'tp', fetch: async (u, o) => { sent = [u, o]; return { ok: true }; }
  });
  assert.equal(r.ok, true); assert.equal(r.notified, true);
  assert.equal(calls.upload[0][1].upsert, true);
  assert.deepEqual(calls.remove[0], ['f10.pdf']);
  assert.equal(sent[1].headers.Attach, 'https://x/signed');
});

test('oversize blob and failures never throw', async () => {
  assert.equal((await publishClosingPdf({ size: 11 * 1024 * 1024 }, 'k', { client: {} })).reason, 'too-large');
  const bad = { storage: { from: () => ({ upload: async () => ({ error: new Error('x') }) }) } };
  assert.equal((await publishClosingPdf({ size: 5 }, 'k', { client: bad, topic: '' })).ok, false);
});

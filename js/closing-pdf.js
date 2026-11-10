/* ═══════════════════════════════════════════════════════════════
   CLOSING PDF — after a shift is closed, store a compact PDF of the
   closing sheet in the PRIVATE Supabase Storage bucket `closing-pdfs`
   and push a link to the ntfy topic.

   • One file per sheet key → saving the same shift again OVERWRITES it.
   • Only the KEEP most recently saved PDFs are retained.
   • Best-effort: every failure is swallowed (logged) — it must never
     block or undo a closing.
   • The ntfy attachment is a short-lived signed URL, not a public file.

   Setup: run supabase/closing_pdfs.sql once.
═══════════════════════════════════════════════════════════════ */

import { getSupabaseClient } from './supabase-client.js';
import { repoGetLocal } from './repository.js';

export const PDF_BUCKET   = 'closing-pdfs';
export const PDF_KEEP     = 10;
export const PDF_MAX_BYTES = 10 * 1024 * 1024;
export const PDF_LINK_SECS = 24 * 60 * 60;
const NTFY_TOPIC_KEY = 'ntfy_closing_topic'; /* same key as ntfy-link.js */

export function pdfPathForKey(key) {
  return String(key).replace(/[^A-Za-z0-9_.-]/g, '_') + '.pdf';
}

/* Names to delete so only the `keep` newest remain. `files` come from
   storage.list() sorted newest-first; folder placeholders are ignored. */
export function stalePdfNames(files, keep = PDF_KEEP) {
  return (files || [])
    .filter(f => f && f.name && f.name.endsWith('.pdf'))
    .slice(keep)
    .map(f => f.name);
}

/* Lazy import keeps this module free of the UI graph (and unit-testable). */
export async function buildClosingPdf() {
  const { renderPDF } = await import('./components.js');
  const pdf = await renderPDF({ compact: true });
  return pdf.output('blob');
}

export async function publishClosingPdf(blob, key, deps = {}) {
  try {
    if (!blob || !key) return { ok: false, reason: 'no-blob' };
    if (blob.size > PDF_MAX_BYTES) return { ok: false, reason: 'too-large' };
    const sb = deps.client || getSupabaseClient();
    if (!sb) return { ok: false, reason: 'no-client' };
    const fetchFn = deps.fetch || fetch;
    const topic   = deps.topic !== undefined ? deps.topic : repoGetLocal(NTFY_TOPIC_KEY);

    const path = pdfPathForKey(key);
    const store = sb.storage.from(PDF_BUCKET);

    const up = await store.upload(path, blob, { upsert: true, contentType: 'application/pdf' });
    if (up.error) throw up.error;

    const { data: list } = await store.list('', {
      limit: 100, sortBy: { column: 'updated_at', order: 'desc' }
    });
    const stale = stalePdfNames(list);
    if (stale.length) await store.remove(stale);

    if (!topic) return { ok: true, notified: false };
    const { data: signed } = await store.createSignedUrl(path, PDF_LINK_SECS);
    if (!signed?.signedUrl) return { ok: true, notified: false };

    const res = await fetchFn(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: {
        Title: `Closing PDF: ${key}`,
        Tags: 'page_facing_up',
        Attach: signed.signedUrl,
        Filename: path,
        Click: signed.signedUrl
      },
      // Keep the direct URL visible as well as using ntfy's remote-attachment
      // feature. This guarantees a usable link even if the client hides Attach.
      body: `Closing sheet PDF: ${signed.signedUrl}`
    });
    return { ok: true, notified: !!res?.ok };
  } catch (e) {
    console.warn('Closing PDF upload/notify failed:', e);
    return { ok: false, reason: 'error' };
  }
}

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

import { getSupabaseClient, getSupaAnonKey, getSupaUrl } from './supabase-client.js';
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
    let driveBackedUp = false;
    const store = sb.storage.from(PDF_BUCKET);

    const up = await store.upload(path, blob, { upsert: true, contentType: 'application/pdf' });
    if (up.error) throw up.error;

    // Drive copy is best-effort; the private Storage copy remains authoritative.
    try {
      const { data: sessionData } = await sb.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (accessToken) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        const response = await fetch(`${getSupaUrl().replace(/\\/+$/, '')}/functions/v1/google-drive`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'apikey': getSupaAnonKey(),
          },
          body: JSON.stringify({ action: 'backup_pdf', fileKey: key, pdfBase64: btoa(binary) }),
        });
        if (!response.ok) {
          const detail = await response.json().catch(() => ({}));
          console.warn('Closing PDF Google Drive copy failed:', detail.error || response.status);
        } else {
          driveBackedUp = true;
        }
      } else {
        console.warn('Closing PDF Google Drive copy skipped: no active staff session.');
      }
    } catch (driveError) {
      console.warn('Closing PDF Google Drive copy failed:', driveError);
    }

    // Retention is housekeeping: a listing/deletion failure must not stop
    // the signed link and notification for the PDF that was just uploaded.
    const { data: list, error: listError } = await store.list('', {
      limit: 100, sortBy: { column: 'updated_at', order: 'desc' }
    });
    if (listError) console.warn('Closing PDF retention list failed:', listError);
    const stale = stalePdfNames(list);
    if (stale.length) {
      const { error: removeError } = await store.remove(stale);
      if (removeError) console.warn('Closing PDF retention cleanup failed:', removeError);
    }

    if (!topic) return { ok: true, driveBackedUp, notified: false, reason: 'no-topic' };
    const { data: signed, error: signedError } = await store.createSignedUrl(path, PDF_LINK_SECS);
    if (signedError || !signed?.signedUrl) {
      console.warn('Closing PDF signed URL failed:', signedError || 'No signed URL returned');
      return { ok: true, driveBackedUp, notified: false, reason: 'signed-url-failed' };
    }

    const res = await fetchFn(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: {
        Title: `Closing PDF: ${key}`,
        Tags: 'page_facing_up',
        Attach: signed.signedUrl,
        Filename: path,
        Click: signed.signedUrl
      },
      // Keep a plain, tappable URL in the message as a fallback if a client
      // does not render the remote attachment preview.
      body: `Closing sheet PDF: ${signed.signedUrl}`
    });
    if (!res?.ok) {
      console.warn('Closing PDF ntfy publish failed:', res?.status || 'unknown HTTP status');
      return { ok: true, driveBackedUp, notified: false, reason: 'ntfy-http-error', status: res?.status || null };
    }
    return { ok: true, driveBackedUp, notified: true };
  } catch (e) {
    console.warn('Closing PDF upload/notify failed:', e);
    return { ok: false, reason: 'error' };
  }
}

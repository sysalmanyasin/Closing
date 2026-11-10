-- ═══════════════════════════════════════════════════════════════════
-- closing_pdfs.sql — private bucket for the per-closing PDF that the app
-- uploads after "Save & Close" (js/closing-pdf.js). Apply ONCE in the
-- project that hosts public.sheets. Idempotent. Additive: touches nothing
-- else. The app only keeps the 10 most recent files and overwrites a
-- shift's file when it is saved again.
--
-- Access = active staff only (same rule as public.sheets). The bucket is
-- NOT public; ntfy gets a 24h signed URL. Max PDF size: 10 MiB (matches js/closing-pdf.js).
-- ═══════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('closing-pdfs', 'closing-pdfs', false, 10485760, array['application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = 10485760, allowed_mime_types = array['application/pdf'];

drop policy if exists "staff select closing pdfs" on storage.objects;
create policy "staff select closing pdfs" on storage.objects for select to authenticated
  using (bucket_id = 'closing-pdfs' and public.is_active_staff(auth.uid()));

drop policy if exists "staff insert closing pdfs" on storage.objects;
create policy "staff insert closing pdfs" on storage.objects for insert to authenticated
  with check (bucket_id = 'closing-pdfs' and public.is_active_staff(auth.uid()));

drop policy if exists "staff update closing pdfs" on storage.objects;
create policy "staff update closing pdfs" on storage.objects for update to authenticated
  using (bucket_id = 'closing-pdfs' and public.is_active_staff(auth.uid()))
  with check (bucket_id = 'closing-pdfs' and public.is_active_staff(auth.uid()));

drop policy if exists "staff delete closing pdfs" on storage.objects;
create policy "staff delete closing pdfs" on storage.objects for delete to authenticated
  using (bucket_id = 'closing-pdfs' and public.is_active_staff(auth.uid()));

-- ROLLBACK: drop the four policies above; delete the bucket from Dashboard → Storage.

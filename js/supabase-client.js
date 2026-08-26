/* ═══════════════════════════════════════════════════════════════
   SHARED SUPABASE CLIENT — single instance for the whole app.

   WHY THIS FILE EXISTS:
   sync.js and auth.js used to each call `window.supabase.createClient()`
   independently. That created TWO separate GoTrue (auth) instances.
   Signing in via auth.js's client updated ONLY that client's in-memory
   session — sync.js's already-created client (used for every settings/
   sheets/credit_ledger read+write AND the realtime channel) kept using
   its old, unauthenticated ("anon") session until the whole page was
   reloaded.

   That was invisible for a long time because the database's RLS
   policies used to allow the anon role to read/write these tables.
   Once RLS was locked down to require an authenticated + authorized
   session (see supabase/schema.sql's "admin or staff can write"
   policy), sync.js's stale anon client started getting silently
   rejected: Settings/Inventory edits looked like they saved (no
   error shown to the user) but never actually reached the cloud,
   and the realtime channel failed to authorize at all — surfacing
   as "Live sync unavailable — channel error: transport...".

   Fix: exactly one client, shared by both files, so a login in
   auth.js is immediately visible to sync.js's pushes/pulls/realtime
   channel — no reload required. ═══════════════════════════════ */

import { repoGetLocal } from './repository.js';

export const SUPA_URL_KEY  = 'supabase_url';
export const SUPA_ANON_KEY = 'supabase_anon_key';

/* Baked-in default connection — every device/install auto-connects to
   this project without needing to open Settings and paste the Project
   URL + anon key first (that manual step is still there, and still
   wins if the user ever saves a different key). Safe to commit: it's
   the anon/publishable key, not a service-role key — Row Level
   Security is the real boundary. */
const DEFAULT_SUPA_URL      = 'https://wetbugzzchkghpzmowod.supabase.co';
const DEFAULT_SUPA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndldGJ1Z3p6Y2hrZ2hwem1vd29kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMDg4OTIsImV4cCI6MjA5Nzg4NDg5Mn0.LXFrvQTOfI3ph4aA8xWYIUo-z1yxdX0znnN5f-KsOPM';

export function getSupaUrl() {
  return (repoGetLocal(SUPA_URL_KEY) || '').trim() || DEFAULT_SUPA_URL;
}
export function getSupaAnonKey() {
  return (repoGetLocal(SUPA_ANON_KEY) || '').trim() || DEFAULT_SUPA_ANON_KEY;
}

let _client     = null;
let _clientUrl  = null;
let _clientKey  = null;

/* Returns the single shared client, creating it (or re-creating it,
   if the saved URL/key changed since it was last built — e.g. the
   user just pasted a different Project URL + anon key) on demand.
   `options` (e.g. realtime params) only take effect on the call that
   actually constructs the client — whichever of sync.js/auth.js
   happens to ask first at boot (sync.js does, via supaInit()). */
export function getSupabaseClient(options) {
  const url = getSupaUrl();
  const key = getSupaAnonKey();
  if(_client && url === _clientUrl && key === _clientKey) return _client;

  if(typeof window.supabase?.createClient !== 'function') return null;
  if(!url || !key) return null;

  _client    = window.supabase.createClient(url, key, options);
  _clientUrl = url;
  _clientKey = key;
  return _client;
}

/* Forces the next getSupabaseClient() call to build a brand-new
   client (and therefore a brand-new, signed-out GoTrue session)
   instead of reusing the cached one. Call this whenever the stored
   URL/key are cleared or replaced. */
export function resetSupabaseClient() {
  _client    = null;
  _clientUrl = null;
  _clientKey = null;
}

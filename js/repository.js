/* ═══════════════════════════════════════════════════════════════
   FLOOR 1 — REPOSITORY
   The ONLY layer that touches localStorage — for the main `db`
   blob AND for every auxiliary key any other file needs to persist
   (Dropbox tokens, reader "last page seen", etc). Nothing outside
   this file should call localStorage.* directly.
   Export/Import backup also lives here since it's raw data movement.
═══════════════════════════════════════════════════════════════ */

import { db, setDB } from './state.js';
import { persist } from './actions.js';
import { goToDashboard } from './pages.js';

export const DB_STORAGE_KEY = 'pharmpos_v2';

/* Set by repoLoad() if a saved db blob existed but failed to parse —
   distinct from "no data yet" (a genuinely first-time install).
   app.js checks this once at boot to warn the person instead of
   silently handing them an empty dashboard. */
let _repoLoadHadCorruption = false;
export function repoLoadHadCorruption() { return _repoLoadHadCorruption; }

/* ── Main `db` blob ──────────────────────────────────────── */

/* Read the persisted db blob, or null if there isn't one yet
   (State/Floor 2 supplies the default shape in that case). */
export function repoLoad() {
  let raw;
  try {
    raw = localStorage.getItem(DB_STORAGE_KEY);
  } catch(e) {
    return null; /* localStorage itself inaccessible — nothing more we can do */
  }
  if(!raw) return null; /* genuinely first use, not corruption */
  try {
    return JSON.parse(raw);
  } catch(e) {
    /* Data existed but is corrupted (partial write, browser crash
       mid-save, etc). Preserve the raw text under a timestamped
       backup key rather than silently destroying it — someone can
       still recover it manually from devtools/localStorage even if
       the app itself can't parse it. */
    try { localStorage.setItem(DB_STORAGE_KEY + '_corrupted_' + Date.now(), raw); } catch(e2) { /* best-effort */ }
    _repoLoadHadCorruption = true;
    return null;
  }
}

/* Write the CURRENT `db` (from State/Floor 2) to storage. */
export function repoPersist() {
  try {
    localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(db));
    return true;
  } catch(e) { return false; }
}

/* Wholesale-replace the db (import, restore, cloud adopt) and
   persist it immediately. Goes through State's own setDB() rather
   than reassigning `db` here directly, since State owns that
   variable. No cloud push here — that's a business decision for
   whoever calls this (see importDataJSON below, and sync.js). */
export function repoReplaceDB(newDb) {
  setDB(newDb);
  repoPersist();
}

/* ── Generic auxiliary key/value storage (non-db) ───────────
   For small standalone localStorage keys that aren't part of the
   main db blob — OAuth tokens, "last page read" caches, etc. ── */
export function repoGetLocal(key) {
  try { return localStorage.getItem(key); } catch(e) { return null; }
}
export function repoSetLocal(key, value) {
  try { localStorage.setItem(key, value); return true; } catch(e) { return false; }
}
export function repoRemoveLocal(key) {
  try { localStorage.removeItem(key); return true; } catch(e) { return false; }
}

/* ── Backup export / import ──────────────────────────────── */

export function exportDataJSON() {
  const blob = new Blob([JSON.stringify(db, null, 2)], {type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pharmapos_backup_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function importDataJSON(evt) {
  const file = evt.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const incoming = JSON.parse(e.target.result);
      if(!incoming.sheets || !incoming.settings) { alert('Invalid backup file.'); return; }
      if(!confirm('This will REPLACE all current data on this device with the backup file. Continue?')) return;
      setDB(incoming);
      persist(); /* Floor 3's door — also triggers the usual cloud push */
      alert('Backup restored.');
      goToDashboard();
    } catch(err) {
      alert('Could not read backup file: ' + err.message);
    }
  };
  reader.readAsText(file);
  evt.target.value = '';
}

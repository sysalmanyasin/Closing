/* ═══════════════════════════════════════════════════════════════
   FLOOR 1 — REPOSITORY
   The ONLY layer that touches localStorage — for the main `db`
   blob AND for every auxiliary key any other file needs to persist
   (Dropbox tokens, reader "last page seen", etc). Nothing outside
   this file should call localStorage.* directly.
   Export/Import backup also lives here since it's raw data movement.
═══════════════════════════════════════════════════════════════ */

const DB_STORAGE_KEY = 'pharmpos_v2';

/* ── Main `db` blob ──────────────────────────────────────── */

/* Read the persisted db blob, or null if there isn't one yet
   (State/Floor 2 supplies the default shape in that case). */
function repoLoad() {
  try {
    const raw = localStorage.getItem(DB_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch(e) { return null; }
}

/* Write the CURRENT `db` (from State/Floor 2) to storage. */
function repoPersist() {
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
function repoReplaceDB(newDb) {
  setDB(newDb);
  repoPersist();
}

/* ── Generic auxiliary key/value storage (non-db) ───────────
   For small standalone localStorage keys that aren't part of the
   main db blob — OAuth tokens, "last page read" caches, etc. ── */
function repoGetLocal(key) {
  try { return localStorage.getItem(key); } catch(e) { return null; }
}
function repoSetLocal(key, value) {
  try { localStorage.setItem(key, value); return true; } catch(e) { return false; }
}
function repoRemoveLocal(key) {
  try { localStorage.removeItem(key); return true; } catch(e) { return false; }
}

/* ── Backup export / import ──────────────────────────────── */

function exportDataJSON() {
  const blob = new Blob([JSON.stringify(db, null, 2)], {type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pharmapos_backup_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importDataJSON(evt) {
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

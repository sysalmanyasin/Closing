/* ═══════════════════════════════════════════════════════════════
   FLOOR 1 — REPOSITORY
   The only layer that touches localStorage. Export/Import backup
   also lives here since it's raw data movement.
═══════════════════════════════════════════════════════════════ */

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
      db = incoming;
      persist();
      alert('Backup restored.');
      goToDashboard();
    } catch(err) {
      alert('Could not read backup file: ' + err.message);
    }
  };
  reader.readAsText(file);
  evt.target.value = '';
}


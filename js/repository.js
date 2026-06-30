/* ═══════════════════════════════════════════════════════════════
   FLOOR 1 — REPOSITORY
   The only layer that touches localStorage.
   All other layers call these functions — never localStorage directly.
═══════════════════════════════════════════════════════════════ */

const STORAGE_KEY = 'pharmpos_v2';

const DEFAULT_DB = {
  settings: {
    namedCredits: [
      { label: 'Corporate Account' },
      { label: 'Wholesale Ledger' },
      { label: 'Third Party Tab' }
    ],
    subTiers: [
      { type: 'Staff Credit',   names: ['Dr. Salman', 'Asif Malik', 'Kashif Shah'] },
      { type: 'Delivery Staff', names: ['Raza Hazrat', 'Noman Ali', 'Saeed Khan'] },
      { type: 'Branch Tabs',    names: ['Johar Town', 'DHA Branch', 'Bahria Pool'] }
    ],
    strips: [
      { name: 'Water 1.5L',      price: 17 },
      { name: 'Water 500ml',     price: 28 },
      { name: 'Water 330ml',     price: 0  },
      { name: 'Regular Strips',  price: 10 },
      { name: 'Pura Water 1L',   price: 16 },
      { name: 'Pura Water 0.5L', price: 28 },
      { name: 'Juice Pack 60x',  price: 0  },
      { name: 'Juice Pack 80x',  price: 60 },
      { name: 'Juice Pack 140x', price: 5  },
      { name: 'Juice Pack 150x', price: 4  },
      { name: 'Juice Pack 250x', price: 6  }
    ],
    finalEveryN: 3
  },
  sheets: {}
};

/* ── Load ───────────────────────────────────────────────────── */
function repoLoad() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed) return JSON.parse(JSON.stringify(DEFAULT_DB));

    // Migrate legacy creditLabels
    if (!parsed.settings.namedCredits && parsed.settings.creditLabels) {
      parsed.settings.namedCredits = parsed.settings.creditLabels.map(l => ({ label: l }));
    }
    return parsed;
  } catch (e) {
    console.error('[Repo] Load failed, using defaults', e);
    return JSON.parse(JSON.stringify(DEFAULT_DB));
  }
}

/* ── Save ───────────────────────────────────────────────────── */
function repoPersist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(AppState.db));
  } catch (e) {
    console.error('[Repo] Persist failed', e);
  }
}

/* ── Sheet Operations ───────────────────────────────────────── */
function repoGetSheet(key) {
  return AppState.db.sheets[key] || null;
}

function repoSaveSheet(key, record) {
  AppState.db.sheets[key] = record;
  repoPersist();
}

function repoDeleteSheet(key) {
  delete AppState.db.sheets[key];
  repoPersist();
}

function repoGetAllSheets() {
  return AppState.db.sheets || {};
}

/* ── Settings Operations ────────────────────────────────────── */
function repoGetSettings() {
  return AppState.db.settings;
}

function repoSaveSettings(settings) {
  AppState.db.settings = settings;
  repoPersist();
}

/* ── Credit Snapshots ───────────────────────────────────────── */
function repoGetSnapshots() {
  if (!Array.isArray(AppState.db.creditSnapshots)) {
    AppState.db.creditSnapshots = [];
  }
  return AppState.db.creditSnapshots;
}

function repoSaveSnapshot(key, snapshotData) {
  if (!Array.isArray(AppState.db.creditSnapshots)) {
    AppState.db.creditSnapshots = [];
  }
  const idx = AppState.db.creditSnapshots.findIndex(s => s.key === key);
  if (idx >= 0) {
    AppState.db.creditSnapshots[idx] = { key, ...snapshotData };
  } else {
    AppState.db.creditSnapshots.push({ key, ...snapshotData });
  }
  repoPersist();
}

/* ── Export / Import (Backup) ───────────────────────────────── */
function repoExportJSON() {
  const blob = new Blob([JSON.stringify(AppState.db, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const ts   = new Date().toISOString().slice(0, 10);
  a.href     = url;
  a.download = `pharmpos-backup-${ts}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function repoImportJSON(file, onSuccess) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const imported = JSON.parse(e.target.result);
      if (!imported.sheets) throw new Error('Invalid backup file');
      AppState.db = imported;
      repoPersist();
      onSuccess();
    } catch (err) {
      showToast('Import failed: ' + err.message);
    }
  };
  reader.readAsText(file);
}

/* ── Replace entire DB (used by Dropbox sync pull) ─────────── */
function repoReplaceDB(newDb) {
  AppState.db = newDb;
  repoPersist();
}

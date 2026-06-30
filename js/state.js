/* ═══════════════════════════════════════════════════════════════
   FLOOR 2 — STATE STORE
   One protected object. Never mutate directly from Pages/Components.
   Use Actions (Floor 3) or Repo (Floor 1) to change state.
═══════════════════════════════════════════════════════════════ */

const AppState = {

  /* ── Persistent Data (loaded from Repo on boot) ───────────── */
  db: null,         // Full DB: { settings, sheets, creditSnapshots }

  /* ── Active Ledger Session ────────────────────────────────── */
  activeKey:      null,     // e.g. "2026-06-30|Night"
  activeMode:     'shift',  // 'shift' | 'final'
  isSheetLocked:  false,    // true = view-only snapshot
  isSavedSheet:   false,    // true = this key already exists in db.sheets
  overrides:      {},       // { fieldId: true } — user-overridden computed fields

  /* ── Dynamic Row Counters ─────────────────────────────────── */
  auxCreditCount: 0,
  depositCount:   0,
  miscCount:      0,
  hsRowCount:     0,
  auxStripCount:  0,

  /* ── UI Navigation ───────────────────────────────────────── */
  currentPage:    'page-dashboard',

  /* ── Calendar ────────────────────────────────────────────── */
  calViewDate:    new Date(),

  /* ── Summary Page ────────────────────────────────────────── */
  summaryDateStr: '',

  /* ── Credit Ledger ───────────────────────────────────────── */
  clVisibleCount: 3,

  /* ── Helpers ─────────────────────────────────────────────── */
  resetLedgerSession() {
    this.activeKey      = null;
    this.activeMode     = 'shift';
    this.isSheetLocked  = false;
    this.isSavedSheet   = false;
    this.overrides      = {};
    this.auxCreditCount = 0;
    this.depositCount   = 0;
    this.miscCount      = 0;
    this.hsRowCount     = 0;
    this.auxStripCount  = 0;
  }
};

/* ── Constants (app-wide, never change) ─────────────────────── */
const PIN       = '1218';
const SHIFTS    = ['Night', 'Morning', 'Evening'];
const SHIFT_SR  = { Morning: 1, Evening: 2, Night: 3 };
const SHIFT_CHRONO = { Night: 0, Morning: 1, Evening: 2 };
const MONTHS    = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WDAYS     = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DENOMS    = [5000, 1000, 500, 100, 50, 20, 10, 5, 2, 1];

function srLabel(shift) {
  return `Closing ${SHIFT_SR[shift] || '?'} — ${shift}`;
}

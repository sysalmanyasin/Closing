/* ═══════════════════════════════════════════════════════════════
   APP ENTRY POINT
   The only thing index.html loads (as <script type="module">).
   Importing every module here is what actually builds and resolves
   the whole dependency graph — no more manually-ordered <script>
   tags, and no more "which file has to load before which" bugs.

   Everything inside each module stays properly encapsulated:
   internal state objects (compState, cbState, navState, clPageState,
   dbxState) are NOT re-exported here, so they're now genuinely
   private to their own file — not just private by convention.

   The one necessary compromise: index.html's onclick/onchange
   attributes (and the ones generated dynamically inside template
   strings) call bare global function names, since they're plain
   HTML attributes, not module code. ES modules don't put anything
   on `window` automatically, so this file is the one explicit,
   documented bridge — every function listed below is one that some
   onclick/onchange somewhere actually calls. If you add a new
   inline handler, add its function here too.
═══════════════════════════════════════════════════════════════ */

import * as Repository  from './repository.js';
import * as Actions     from './actions.js';
import * as Components  from './components.js';
import * as Pages       from './pages.js';
import * as LedgerNav   from './ledger-nav.js';
import * as ClosingBook from './closing-book.js';
import * as Sync        from './sync.js';
import * as Auth        from './auth.js';
import * as BtBridge     from './bt-bridge.js';
/* state.js and ledger-engine.js aren't imported directly here — they
   still load correctly since actions.js (and others) already import
   from them, which is enough to bring them into the module graph. */

Object.assign(window, {
  // repository.js — backup/restore
  exportDataJSON:  Repository.exportDataJSON,
  importDataJSON:  Repository.importDataJSON,

  // actions.js
  archiveOldRecords: Actions.archiveOldRecords,
  calc:              Actions.calc,
  deleteCurrentSheet: Actions.deleteCurrentSheet,
  deleteSheet:       Actions.deleteSheet,
  insertHandoverClosing: Actions.insertHandoverClosing,
  saveDraft:         Actions.saveDraft,
  setOverride:       Actions.setOverride,
  settingsSetNamedCreditLabel: Actions.settingsSetNamedCreditLabel,
  settingsSetStripField:       Actions.settingsSetStripField,
  toggleSign:        Actions.toggleSign,

  // components.js
  addAuxCreditRow:      Components.addAuxCreditRow,
  addAuxStripRow:       Components.addAuxStripRow,
  addDepositRow:        Components.addDepositRow,
  addHsRow:             Components.addHsRow,
  addMiscRow:           Components.addMiscRow,
  addNamedCreditEntryRow: Components.addNamedCreditEntryRow,
  clearAllFields:       Components.clearAllFields,
  closeEditModal:       Components.closeEditModal,
  closeModalPicker:     Components.closeModalPicker,
  closePdfModal:        Components.closePdfModal,
  confirmEditModal:     Components.confirmEditModal,
  delRow:               Components.delRow,
  editModalOutsideClick: Components.editModalOutsideClick,
  editModalSelectMode:  Components.editModalSelectMode,
  openEditModal:        Components.openEditModal,
  openPdfModal:         Components.openPdfModal,
  openTierPicker:       Components.openTierPicker,
  pdfModalAction:       Components.pdfModalAction,
  toggleCard:           Components.toggleCard,
  toggleMoreMenu:       Components.toggleMoreMenu,

  // components.js — closing image viewer (View as Image / Send Image to WhatsApp)
  pdfModalViewImage:       Components.pdfModalViewImage,
  pdfModalShareImage:      Components.pdfModalShareImage,
  closeImageViewer:        Components.closeImageViewer,
  imageViewerNext:         Components.imageViewerNext,
  imageViewerPrev:         Components.imageViewerPrev,
  imageViewerShareCurrent: Components.imageViewerShareCurrent,

  // pages.js
  addNamedCreditSetting: Pages.addNamedCreditSetting,
  addStaffSetting:      Pages.addStaffSetting,
  addStripGroup:        Pages.addStripGroup,
  addStripRow:          Pages.addStripRow,
  alShowMore:           Pages.alShowMore,
  clExportTxt:          Pages.clExportTxt,
  clOpenShift:          Pages.clOpenShift,
  clShowMore:           Pages.clShowMore,
  clSwitchMode:         Pages.clSwitchMode,
  clToggleAll:          Pages.clToggleAll,
  clToggleDateCard:     Pages.clToggleDateCard,
  clToggleExport:       Pages.clToggleExport,
  clearManifestFilter:  Pages.clearManifestFilter,
  goToActivityLog:      Pages.goToActivityLog,
  goToClosingBook:      Pages.goToClosingBook,
  goToCreditLedger:     Pages.goToCreditLedger,
  goToDashboard:        Pages.goToDashboard,
  goToSettings:         Pages.goToSettings,
  loadKey:              Pages.loadKey,
  openFinalSummaryRecord: Pages.openFinalSummaryRecord,
  openSheetFromPicker:  Pages.openSheetFromPicker,
  printThermalSnapshot: Pages.printThermalSnapshot,
  removeNamedCredit:    Pages.removeNamedCredit,
  removeStaff:          Pages.removeStaff,
  removeStrip:          Pages.removeStrip,
  removeStripGroup:     Pages.removeStripGroup,
  renameStripGroup:     Pages.renameStripGroup,
  renderActivityLog:    Pages.renderActivityLog,
  renderCreditLedger:   Pages.renderCreditLedger,
  renderManifest:       Pages.renderManifest,
  saveSettings:         Pages.saveSettings,
  setPickerMode:        Pages.setPickerMode,
  settingsShowTab:      Pages.settingsShowTab,
  shiftMonth:           Pages.shiftMonth,
  updateAdminPin:       Pages.updateAdminPin,
  updateStaffName:      Pages.updateStaffName,
  updateStaffPin:       Pages.updateStaffPin,
  toggleManifestFilter: Pages.toggleManifestFilter,
  updateBookBrandCode:  Pages.updateBookBrandCode,
  updateRetentionMonths: Pages.updateRetentionMonths,

  // ledger-nav.js
  closeSummaryModal:    LedgerNav.closeSummaryModal,
  closeViewAll:         LedgerNav.closeViewAll,
  confirmSummaryAndSave: LedgerNav.confirmSummaryAndSave,
  focusStep:            LedgerNav.focusStep,
  jumpToSection:        LedgerNav.jumpToSection,
  openSummaryModal:     LedgerNav.openSummaryModal,
  openViewAll:          LedgerNav.openViewAll,
  viewAllOutsideClick:  LedgerNav.viewAllOutsideClick,

  // closing-book.js
  closeClosingBookReader: ClosingBook.closeClosingBookReader,
  closingBookJump:      ClosingBook.closingBookJump,
  closingBookNext:      ClosingBook.closingBookNext,
  closingBookPrev:      ClosingBook.closingBookPrev,
  closingBookZoom:      ClosingBook.closingBookZoom,
  exportClosingBookPdf: ClosingBook.exportClosingBookPdf,
  generateClosingBook:  ClosingBook.generateClosingBook,
  setClosingBookShortcut: ClosingBook.setClosingBookShortcut,
  setClosingBookShortcutClosings: ClosingBook.setClosingBookShortcutClosings,

  // sync.js
  dbxAuthStart:         Sync.dbxAuthStart,
  dbxClearAppKey:       Sync.dbxClearAppKey,
  dbxDisconnect:        Sync.dbxDisconnect,
  dbxExportConnection:  Sync.dbxExportConnection,
  dbxImportConnection:  Sync.dbxImportConnection,
  dbxImportConnectionUnlinked: Sync.dbxImportConnectionUnlinked,
  dbxSaveAppKey:        Sync.dbxSaveAppKey,
  dbxShowConnectStep:   Sync.dbxShowConnectStep,
  dbxShowImport:        Sync.dbxShowImport,
  dbxShowKeyError:      Sync.dbxShowKeyError,
  syncPullFromCloud:    Sync.syncPullFromCloud,
  syncPushToCloud:      Sync.syncPushToCloud,

  // auth.js
  authLogin:            Auth.authLogin,
  authLogout:           Auth.authLogout,
  confirmLogout:        Auth.confirmLogout,

  // bt-bridge.js
  loadTierNamesFromBtStaff: BtBridge.loadTierNamesFromBtStaff,
});

/* One-time boot check: if a saved db blob existed but failed to
   parse, State (Floor 2) already fell back to a fresh empty db so
   the app can still run — but the person needs to know their data
   didn't just vanish on its own. The raw corrupted text is preserved
   under a backup key (see repository.js) in case it's recoverable. */
if(Repository.repoLoadHadCorruption()) {
  alert('⚠️ Your saved closing data could not be read (it appears corrupted) and this device is starting fresh. The original data was NOT deleted — it\'s preserved in this browser\'s storage under a backup key. If you have Supabase sync connected, reconnect it to restore your records from the cloud.');
}

/* ── Escape-to-close for modals ──────────────────────────────
   Keyboard parity for the modals that already support dismissing
   via a backdrop click — a keyboard-only user has no mouse to
   click that backdrop with, so Escape needs to do the same job.
   save-action-overlay is deliberately excluded: it requires an
   explicit button choice and was never backdrop-dismissible either,
   so leaving it out preserves that existing design intent. ── */
const ESCAPE_CLOSABLE_MODALS = [
  { id: 'modal-picker-overlay', close: Components.closeModalPicker },
  { id: 'pdf-modal-overlay',    close: Components.closePdfModal },
  { id: 'image-reader',         close: Components.closeImageViewer },
  { id: 'edit-modal-overlay',   close: Components.closeEditModal },
  { id: 'summary-modal-overlay', close: LedgerNav.closeSummaryModal },
  { id: 'viewall-overlay',      close: LedgerNav.closeViewAll },
];

document.addEventListener('keydown', (e) => {
  if(e.key !== 'Escape') return;
  for(const modal of ESCAPE_CLOSABLE_MODALS) {
    const el = document.getElementById(modal.id);
    if(el && !el.classList.contains('hidden')) {
      modal.close();
      return; /* close only the top-most open one per press */
    }
  }
});

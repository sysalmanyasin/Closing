/* ═══════════════════════════════════════════════════════════════
   FLOOR 2 — STATE STORE
   One protected source of truth. Never mutate from Pages/Components
   directly — go through Actions (Floor 3).

   Two kinds of exports here:
   - `db` (business data) and `session` (current "what am I looking
     at right now" pointers) are objects — every other module can
     mutate their PROPERTIES freely (that's how a shared session
     pointer is supposed to work), but only setDB() may reassign
     the `db` binding itself.
   - SHIFTS / SHIFT_SR / DENOMS / srLabel are plain constants,
     imported read-only wherever needed. Admin/staff PINs now live in
     db.settings (adminPin, staff[]) instead of a hardcoded constant —
     see checkPin()/isPinTaken() below.
═══════════════════════════════════════════════════════════════ */

import { repoLoad } from './repository.js';

/* ═══════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════ */
export const SHIFTS = ["Night","Morning","Evening"];
export const SHIFT_SR = {Night:1, Morning:2, Evening:3};
export function srLabel(shift) { return `Closing ${SHIFT_SR[shift]||'?'} — ${shift}`; }

/* ═══════════════════════════════════════════
   VARIABLE CLOSINGS — Night is always seq 10 (first), Evening is
   always seq 9999 (last, a sentinel comfortably bigger than any
   realistic number of closings in between). Everything between them
   is just an ordered list — the first middle closing keeps the key
   `date_Morning` (so every existing saved record is 100% unaffected,
   zero migration), any additional ones are `date_Handover1`,
   `date_Handover2`... each carrying its own explicit `seq` on the
   record, assigned once at creation.

   These three functions are purely ADDITIVE — nothing existing calls
   them yet, so nothing existing changes behavior. srLabel() above is
   untouched on purpose: all 24 of its current call sites keep working
   exactly as today. slotLabel() below is the new Handover-aware
   replacement, to be adopted call-site by call-site as the Handover
   UI gets built, rather than in one large simultaneous sweep.
═══════════════════════════════════════════ */

/* The conventional seq for a NAMED anchor shift, used as a fallback
   when a record doesn't have an explicit `seq` stored — which is
   every piece of data that exists today. Deliberately matches
   SHIFT_SR's old ×10 ordering (10/20/30) for Night/Morning, so this
   fallback reproduces today's ordering exactly; only Evening's
   sentinel is bigger than its old implicit "30", which is safe
   because seq is only ever compared *relatively* to other slots on
   the same date, never against a stored/hardcoded literal elsewhere. */
function baseSeq(shift) {
  if(shift === 'Night')   return 10;
  if(shift === 'Evening') return 9999;
  return 20; /* Morning, or any legacy/unrecognized name defaults to "the one middle slot" */
}

export function getSeq(ds, shift) {
  const rec = db.sheets[`${ds}_${shift}`];
  if(rec && typeof rec.seq === 'number') return rec.seq;
  return baseSeq(shift);
}

/* Every addressable slot for a date, in seq order. Night, Morning,
   and Evening are ALWAYS included — the same 3 guaranteed anchors
   the app has always assumed exist for any date, whether saved yet
   or not. Any real Handover* keys found in db.sheets for the date
   are added on top of those 3, never in place of them — a Handover
   is purely an addition, it never removes the assumption that
   Morning exists for that day. */
export function daySlots(ds) {
  const prefix = ds + '_';
  const found = new Set(
    Object.keys(db.sheets)
      .filter(k => k.startsWith(prefix))
      .map(k => k.slice(prefix.length))
  );
  found.add('Night');
  found.add('Morning');
  found.add('Evening');
  return Array.from(found)
    .map(shift => ({ shift, seq: getSeq(ds, shift) }))
    .sort((a, b) => a.seq - b.seq);
}

/* Handover-aware label — "Closing N — <name>" where N is the slot's
   actual rank among that date's real slots (so a Handover correctly
   reads as "Closing 3", not "Closing ?"), and <name> is the record's
   own shiftLabel if it has one (Handovers store shiftLabel:"Handover"),
   falling back to the shift string itself for Night/Morning/Evening. */
export function slotLabel(ds, shift) {
  if(!ds) return srLabel(shift); /* no date context — best-effort legacy behavior */
  const slots = daySlots(ds);
  const idx = slots.findIndex(s => s.shift === shift);
  const n = idx === -1 ? '?' : idx + 1;
  const rec = db.sheets[`${ds}_${shift}`];
  const name = (rec && rec.shiftLabel) || shift;
  return `Closing ${n} — ${name}`;
}
export const DENOMS = [
  {label:"Rs. 5,000 notes", mult:5000},
  {label:"Rs. 1,000 notes", mult:1000},
  {label:"Rs. 500 notes",   mult:500},
  {label:"Rs. 100 notes",   mult:100},
  {label:"Rs. 50 notes",    mult:50},
  {label:"Rs. 20 notes",    mult:20},
  {label:"Rs. 10 notes",    mult:10},
  {label:"Coins / loose change", mult:1}
];

/* ═══════════════════════════════════════════
   THE DATA — db
═══════════════════════════════════════════ */
/* Ensures a db object has every settings field the app expects,
   filling in safe defaults for anything missing. Run once below at
   load time, AND every time setDB() wholesale-replaces `db` (cloud
   pull adopt, backup import) — a replacement can bring in an
   older-shaped settings object (e.g. from before the PIN/staff
   feature existed), and unlike the very first app load, nothing else
   would ever re-apply these defaults to it otherwise. */
function applySettingsDefaults(dbObj) {
  if(!dbObj.settings) dbObj.settings = {};
  if(!dbObj.sheets) dbObj.sheets = {};
  if(!dbObj.settings.namedCredits && dbObj.settings.creditLabels) {
    dbObj.settings.namedCredits = dbObj.settings.creditLabels.map(l=>({label:l}));
  }
  if(!Array.isArray(dbObj.settings.namedCredits)) dbObj.settings.namedCredits = [
    {label:"Corporate Account"}, {label:"Wholesale Ledger"}, {label:"Third Party Tab"}
  ];
  /* BT Sale Data bridge: each named account can optionally forward its
     entries into BT's shared JazzCash or Expense ledger. Defaults keep
     every existing account exactly as before (syncTarget:'none') until
     someone deliberately turns one on in Settings. */
  dbObj.settings.namedCredits.forEach(nc => {
    if(!nc.syncTarget) nc.syncTarget = 'none'; /* 'none' | 'jazzcash' | 'expense' */
    if(!nc.expenseCategory) nc.expenseCategory = 'bill';
    if(!nc.jazzcashCategory) nc.jazzcashCategory = 'credit'; /* 'credit'|'debit'|'withdrawal'|'commission'|'transfer' */
  });
  if(!Array.isArray(dbObj.settings.subTiers)) dbObj.settings.subTiers = [
    {type:"Staff Credit",   names:["Dr. Salman","Asif Malik","Kashif Shah"]},
    {type:"Delivery Staff", names:["Raza Hazrat","Noman Ali","Saeed Khan"]},
    {type:"Branch Tabs",    names:["Johar Town","DHA Branch","Bahria Pool"]}
  ];
  if(!Array.isArray(dbObj.settings.strips)) dbObj.settings.strips = [];
  if(!dbObj.settings.stripGroups) dbObj.settings.stripGroups = ["Water","Nestlé Juice","Nescafé","1L Juice","Milo","Mask","Bags"];
  dbObj.settings.strips.forEach(item => { if(item.group === undefined) item.group = ""; });
  if(!dbObj.settings.bookBrandCode) dbObj.settings.bookBrandCode = "FDPP BT";
  if(!dbObj.settings.retentionMonths) dbObj.settings.retentionMonths = 6;
  /* migrate: individual staff PINs — every install used to share one
     hardcoded PIN ("1218"). That value now lives here as the editable
     Admin PIN (same default, no behavior change for anyone who hasn't
     touched Settings yet), plus an empty staff list ready to grow. */
  if(!dbObj.settings.adminPin) dbObj.settings.adminPin = "1218";
  if(!Array.isArray(dbObj.settings.staff)) dbObj.settings.staff = [];
  /* Per-staff feature permissions — keyed by bt_staff's staffId (not
     name), so a rename on BT's side doesn't orphan someone's access.
     See hasPermission() below for how this gets read. */
  if(!dbObj.settings.permissions || typeof dbObj.settings.permissions !== 'object') dbObj.settings.permissions = {};
  /* Tombstones for deleted sheets/credit-ledger entries — {key, deletedAt}.
     Needed so a delete survives a cloud round-trip: sync.js pushes these
     as upserts to a `deleted_records` table and filters them out of every
     pull, instead of a deleted record silently reappearing because the
     cloud copy was never told it was gone. See sync.js for the other half. */
  if(!Array.isArray(dbObj.deletedKeys)) dbObj.deletedKeys = [];
  return dbObj;
}

export let db = applySettingsDefaults(repoLoad() || {
  settings: {
    bookBrandCode: "FDPP BT",
    namedCredits: [
      {label:"Corporate Account"},
      {label:"Wholesale Ledger"},
      {label:"Third Party Tab"}
    ],
    subTiers: [
      {type:"Staff Credit",   names:["Dr. Salman","Asif Malik","Kashif Shah"]},
      {type:"Delivery Staff", names:["Raza Hazrat","Noman Ali","Saeed Khan"]},
      {type:"Branch Tabs",    names:["Johar Town","DHA Branch","Bahria Pool"]}
    ],
    strips: [
      {name:"Water 1.5L",        price:17,  group:"Water"},
      {name:"Water 500ml",       price:28,  group:"Water"},
      {name:"Water 330ml",       price:0,   group:"Water"},
      {name:"Regular Strips",    price:10,  group:""},
      {name:"Pura Water 1L",     price:16,  group:"Water"},
      {name:"Pura Water 0.5L",   price:28,  group:"Water"},
      {name:"Juice Pack 60x",    price:0,   group:"Nestlé Juice"},
      {name:"Juice Pack 80x",    price:60,  group:"Nestlé Juice"},
      {name:"Juice Pack 140x",   price:5,   group:"Nestlé Juice"},
      {name:"Juice Pack 150x",   price:4,   group:"Nestlé Juice"},
      {name:"Juice Pack 250x",   price:6,   group:"Nestlé Juice"}
    ],
    stripGroups: ["Water","Nestlé Juice","Nescafé","1L Juice","Milo","Mask","Bags"]
  },
  sheets: {}
});

/* The ONLY sanctioned way to wholesale-replace the db reference.
   Repository (import/restore) and Sync (cloud-adopt) call this
   instead of reassigning `db` themselves. Always re-applies settings
   defaults, so a replacement can never leave adminPin/staff/etc
   missing the way a raw reassignment could. */
export function setDB(newDb) { db = applySettingsDefaults(newDb); }

/* ═══════════════════════════════════════════
   HTML ESCAPING — the one sanctioned way to put user-entered text
   (row labels, descriptions, staff/account names, etc) into an
   innerHTML template string anywhere in the app. Every free-text
   field a person can type into eventually gets re-rendered this way
   (row builders, print sheet, Credit/Misc Ledger, Activity Log,
   Settings forms) — without escaping, a value like
   `x" onfocus="..." autofocus="` or `"><img src=x onerror=...>`
   breaks out of the attribute/tag it was placed in and runs as
   real HTML/script in whoever's browser next renders that row,
   including across Dropbox sync to every other linked device.
   Pure, no DOM dependency, safe to import from every floor. */
export function escHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

/* Stable identity for rows in free-form arrays (hsRows, auxStrips,
   auxCredits, deposits, miscRows, namedCredits entries) — assigned
   ONCE when a row is first created and carried through every
   hydrate → edit → re-save cycle via the record's own `id` field.
   Without this, the Activity Log's field-diffing would have nothing
   but array position to go on, and a deleted row in the middle of
   the list would look like every row after it "changed". */
let _rowIdSeq = 0;
export function genRowId() {
  _rowIdSeq++;
  return `r${Date.now().toString(36)}${_rowIdSeq}`;
}

/* ═══════════════════════════════════════════
   PIN CHECK — the app's whole identity system.
   Checks a typed PIN against the Admin PIN first, then every staff
   member's PIN. Whichever one matches sets session.currentActor,
   which is what the Activity Log (once built) will tag every
   logged action with — the PIN you type IS your signature, there's
   no separate login step. Returns false (and leaves currentActor
   untouched) if nothing matches.
═══════════════════════════════════════════ */
/* Permanent master override — always works no matter what the
   configurable Admin PIN or any staff PIN is set to. Lives only in
   source (never in db/settings), so it can't be edited, cleared, or
   overwritten by Settings UI or a cloud sync pull. Keep this value
   private; anyone who knows it can unlock/delete anything. */
const MASTER_PIN = "SALMAN";

export function checkPin(pin) {
  if(!pin) return false;
  if(pin === MASTER_PIN) { session.currentActor = "Admin"; return true; }
  if(pin === db.settings.adminPin) { session.currentActor = "Admin"; return true; }
  const staff = (db.settings.staff || []).find(s => s.pin === pin);
  if(staff) { session.currentActor = staff.name; return true; }
  return false;
}

/* Stricter gate for Admin-only areas (currently: the Settings tab).
   Unlike checkPin(), this does NOT accept a staff member's PIN — only
   the Master override or the configurable Admin PIN unlock it. Used
   wherever staff should be able to identify themselves elsewhere in
   the app but must not be able to reach Settings. */
export function checkAdminPin(pin) {
  if(!pin) return false;
  if(pin === MASTER_PIN) { session.currentActor = "Admin"; return true; }
  if(pin === db.settings.adminPin) { session.currentActor = "Admin"; return true; }
  return false;
}

/* Used by Settings when adding/editing a PIN, so two people (or a
   staff member and the Admin PIN) never end up sharing one identity.
   excludeStaffIdx lets a staff member's own current PIN pass the
   check while they're editing it (comparing against itself isn't
   a collision). */
export function isPinTaken(pin, excludeStaffIdx = -1) {
  if(pin === MASTER_PIN) return true; /* reserved — can't be reassigned to a staff/admin PIN */
  if(pin === db.settings.adminPin) return true;
  return (db.settings.staff || []).some((s, i) => i !== excludeStaffIdx && s.pin === pin);
}

/* ═══════════════════════════════════════════
   PERMISSIONS — per-staff feature access, layered on top of the
   real BT staff login (session.loggedInStaff — see auth.js's
   phone+PIN sign-in). Keyed by staffId (bt_staff's row id) rather
   than name, so a rename in BT's own staff records doesn't orphan
   someone's permissions. Admin (Master PIN or the configurable
   Admin PIN, via checkPin()/checkAdminPin() setting
   session.currentActor='Admin') always passes every check — same
   "works everywhere as a fallback" rule the PIN system above
   already documents.

   hasPermission() returns:
     true  — Admin, or this logged-in staff member has the flag set
     false — logged in, but the flag is off (or no row exists yet)
     null  — nobody is logged in via BT phone+PIN auth at all;
             callers should fall back to the legacy checkPin()
             prompt so an install that never set up phone+PIN login
             doesn't lose access to something it already had. */
export const PERMISSION_KEYS = [
  { key: 'closing',      label: 'Save / close shifts' },
  { key: 'edit',         label: 'Edit a saved (locked) closing' },
  { key: 'delete',       label: 'Delete a closing' },
  { key: 'settings',     label: 'Open Settings' },
  { key: 'staffLedger',  label: 'Open Staff Ledger' },
  { key: 'creditLedger', label: 'Open Credit / Misc Ledger' },
  { key: 'activityLog',  label: 'Open Activity Log' }
];

export function hasPermission(key) {
  if(session.currentActor === 'Admin') return true;
  if(!session.loggedInStaff) return null;
  const perms = (db.settings.permissions || {})[session.loggedInStaff.staffId];
  if(!perms) return false;
  return !!perms[key];
}

/* Shared gate for every permission-checked action in the app. Tries
   the new permission system first; only falls back to the legacy
   "type a PIN" prompt when nobody is logged in via BT phone+PIN
   auth yet (hasPermission() returning null), so an install that
   hasn't set up phone+PIN login keeps working exactly as before.
   `viaAdminOnly` swaps the fallback to checkAdminPin() (used for
   Settings, which used to be Admin-only) instead of checkPin(). */
export function gatePermission(key, promptText, viaAdminOnly = false) {
  const has = hasPermission(key);
  if(has === true) return true;
  if(has === false) {
    alert("You don't have permission for that. Ask an Admin to grant it in Settings → Permissions.");
    return false;
  }
  const pin = prompt(promptText);
  const ok = viaAdminOnly ? checkAdminPin(pin) : checkPin(pin);
  if(!ok) alert('Incorrect PIN.');
  return ok;
}

/* ═══════════════════════════════════════════
   SESSION — "what am I looking at right now"
   A single object so every module can set its fields directly
   (session.activeKey = x) without needing a setter function per
   field — ES modules don't allow reassigning an imported `let`
   from outside its own module, but mutating properties of an
   imported object works everywhere, same as `db` above.
═══════════════════════════════════════════ */
export const session = {
  activeKey:      null,
  activeMode:     "shift",
  overrides:      {},
  isSavedSheet:   false,
  calViewDate:    new Date(),
  isSheetLocked:  false, /* true = view-only snapshot, false = editable */
  currentActor:   null,  /* "Admin" or a staff name — set by checkPin() on the most recent successful PIN entry; read by the Activity Log */
  loggedInStaff:  null,  /* {staffId, name} — set by auth.js on successful phone+PIN login; separate from currentActor's per-action confirmation */

  /* dynamic row counters */
  auxCreditCount: 0,
  depositCount:   0,
  miscCount:      0,
  hsRowCount:     0,
  auxStripCount:  0
};

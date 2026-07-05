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
   - PIN / SHIFTS / SHIFT_SR / DENOMS / srLabel are plain constants,
     imported read-only wherever needed.
═══════════════════════════════════════════════════════════════ */

import { repoLoad } from './repository.js';

/* ═══════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════ */
export const PIN    = "1218";
export const SHIFTS = ["Night","Morning","Evening"];
export const SHIFT_SR = {Night:1, Morning:2, Evening:3};
export function srLabel(shift) { return `Closing ${SHIFT_SR[shift]||'?'} — ${shift}`; }
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
export let db = repoLoad() || {
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
};

/* migrate legacy data */
if(!db.settings.namedCredits && db.settings.creditLabels) {
  db.settings.namedCredits = db.settings.creditLabels.map(l=>({label:l}));
}
/* migrate: item groups feature — older saved settings won't have these yet */
if(!db.settings.stripGroups) db.settings.stripGroups = ["Water","Nestlé Juice","Nescafé","1L Juice","Milo","Mask","Bags"];
if(db.settings.strips) db.settings.strips.forEach(item => { if(item.group === undefined) item.group = ""; });
if(!db.settings.bookBrandCode) db.settings.bookBrandCode = "FDPP BT";
if(!db.settings.retentionMonths) db.settings.retentionMonths = 6;

/* The ONLY sanctioned way to wholesale-replace the db reference.
   Repository (import/restore) and Sync (cloud-adopt) call this
   instead of reassigning `db` themselves. */
export function setDB(newDb) { db = newDb; }

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

  /* dynamic row counters */
  auxCreditCount: 0,
  depositCount:   0,
  miscCount:      0,
  hsRowCount:     0,
  auxStripCount:  0
};

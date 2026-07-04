/* ═══════════════════════════════════════════════════════════════
   FLOOR 2 — STATE STORE
   One protected source of truth. Never mutate from Pages/Components
   directly — go through Actions (Floor 3).
═══════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════
   CONSTANTS & STATE
═══════════════════════════════════════════ */
const PIN    = "1218";
const SHIFTS = ["Night","Morning","Evening"];
const SHIFT_SR = {Night:1, Morning:2, Evening:3};
function srLabel(shift) { return `Closing ${SHIFT_SR[shift]||'?'} — ${shift}`; }
const DENOMS = [
  {label:"Rs. 5,000 notes", mult:5000},
  {label:"Rs. 1,000 notes", mult:1000},
  {label:"Rs. 500 notes",   mult:500},
  {label:"Rs. 100 notes",   mult:100},
  {label:"Rs. 50 notes",    mult:50},
  {label:"Rs. 20 notes",    mult:20},
  {label:"Rs. 10 notes",    mult:10},
  {label:"Coins / loose change", mult:1}
];

let db = repoLoad() || {
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

/* The ONLY sanctioned way to wholesale-replace the db reference.
   Repository (import/restore) and Sync (cloud-adopt) call this
   instead of reassigning `db` themselves. */
function setDB(newDb) { db = newDb; }

let activeKey      = null;
let activeMode     = "shift";
let overrides      = {};
let isSavedSheet   = false;
let calViewDate    = new Date();
let isSheetLocked  = false; /* true = view-only snapshot, false = editable */

/* dynamic row counters */
let auxCreditCount = 0;
let depositCount   = 0;
let miscCount      = 0;
let hsRowCount     = 0;
let auxStripCount  = 0;

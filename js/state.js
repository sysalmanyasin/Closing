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
const SHIFT_SR = {Morning:1, Evening:2, Night:3};
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

let db = JSON.parse(localStorage.getItem("pharmpos_v2")) || {
  settings: {
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
      {name:"Water 1.5L",        price:17},
      {name:"Water 500ml",       price:28},
      {name:"Water 330ml",       price:0},
      {name:"Regular Strips",    price:10},
      {name:"Pura Water 1L",     price:16},
      {name:"Pura Water 0.5L",   price:28},
      {name:"Juice Pack 60x",    price:0},
      {name:"Juice Pack 80x",    price:60},
      {name:"Juice Pack 140x",   price:5},
      {name:"Juice Pack 150x",   price:4},
      {name:"Juice Pack 250x",   price:6}
    ]
  },
  sheets: {}
};

/* migrate legacy data */
if(!db.settings.namedCredits && db.settings.creditLabels) {
  db.settings.namedCredits = db.settings.creditLabels.map(l=>({label:l}));
}

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

/* ═══════════════════════════════════════════
   NUMPAD ENGINE
═══════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════
   TEST SETUP — stubs just enough of the browser environment for
   the module graph to load and evaluate under Node. This does NOT
   make DOM-manipulating code testable (that still needs a real
   browser) — it only lets pure logic (ledger-engine.js, state.js
   constants, retention math, etc.) be imported and tested directly,
   since those modules sit in the same import graph as everything
   else and pull in the whole chain.

   Import this file FIRST, before importing anything from js/, in
   every test file:  import './setup.mjs';
═══════════════════════════════════════════════════════════════ */

const localStorageStub = (() => {
  let store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear:      ()  => { store = {}; },
    _allKeys:   ()  => Object.keys(store), /* test-only helper, not part of the real localStorage API */
  };
})();

globalThis.window = globalThis;
globalThis.localStorage = localStorageStub;
globalThis.document = {
  getElementById: () => null,
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener: () => {},
  createElement: () => ({
    style: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    addEventListener(){}, appendChild(){}, setAttribute(){},
  }),
  body: { appendChild(){}, removeChild(){}, classList: { add(){}, remove(){} } },
};

/* Exported so tests can reset storage between cases if needed. */
export function resetLocalStorage() { localStorageStub.clear(); }

# Fazal Din's Pharma Plus — Closing App
## Restructured: 5-Floor Architecture

---

### File Structure

```
closing-app/
│
├── index.html          ← Shell only: loads files in order, pure HTML pages
│
├── css/
│   └── main.css        ← All styles (extracted from original, unchanged)
│
└── js/
    ├── state.js        ← FLOOR 2: AppState, constants, DENOMS, SHIFTS
    ├── repository.js   ← FLOOR 1: localStorage read/write only
    ├── actions.js      ← FLOOR 3: Business logic + EventBus
    ├── components.js   ← FLOOR 4: UI builders, numpad, PDF, row builders
    ├── pages.js        ← FLOOR 5: Page renderers, navigation
    └── sync.js         ← FLOOR 1 (ext): Dropbox cloud sync module
```

---

### The 5 Floors

```
┌─────────────────────────────────────────────┐
│  FLOOR 5 — PAGES          (js/pages.js)     │
│  Reads State → Renders UI → Calls Actions   │
├─────────────────────────────────────────────┤
│  FLOOR 4 — COMPONENTS     (js/components.js)│
│  Pure UI, reusable, no business logic       │
├─────────────────────────────────────────────┤
│  FLOOR 3 — ACTIONS        (js/actions.js)   │
│  The only door to change data + EventBus    │
├─────────────────────────────────────────────┤
│  FLOOR 2 — STATE STORE    (js/state.js)     │
│  AppState object — one source of truth      │
├─────────────────────────────────────────────┤
│  FLOOR 1 — REPOSITORY     (js/repository.js)│
│  Reads/Writes localStorage only             │
│  + Dropbox module          (js/sync.js)     │
└─────────────────────────────────────────────┘
```

---

### Golden Rules

- Pages never touch localStorage
- Components never contain business logic
- State is never modified directly — only through Actions
- Every storage operation goes through the Repository
- Every UI update is triggered by the EventBus
- Dropbox sync reads/writes only through `repoReplaceDB()` and `repoPersist()`

---

### Data Flow

```
User taps → Action → Repository → AppState → EventBus → Page re-renders
```

---

### Adding a New Feature

1. Add data fields to `DEFAULT_DB` in `repository.js`
2. Add state variables to `AppState` in `state.js`
3. Add business logic as a function in `actions.js`
4. Add UI builders in `components.js` if needed
5. Add/update the page render in `pages.js`
6. Add HTML structure in `index.html`

Never skip a floor. Never mix floors.

---

### EventBus Usage

```javascript
// Listen for an event (in pages.js)
EventBus.on('sheet:saved', (data) => {
  buildCalendar();
  renderManifest();
});

// Emit an event (in actions.js)
EventBus.emit('sheet:saved', { key: activeKey });
```

---

### Storage Key
`localStorage key: "pharmpos_v2"`
Dropbox path: `/pharmpos_sync_data.json`

---

### Future: Connect to BT Sales App
When ready, the integration point is:
- **Repository layer only** — BT reads from Dropbox `/pharmpos_sync_data.json`
- No changes needed to any other floor
- One door in, one door out

import js from '@eslint/js';
import globals from 'globals';

/* Everything runs in the browser as ES modules loaded via
   <script type="module">. Two library globals come from plain
   CDN <script> tags (not modules) and never get imported:
   html2canvas and Dropbox. jsPDF is always accessed as
   `window.jspdf`, so it needs no separate global entry. */
export default [
  { ignores: ['node_modules/**'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        html2canvas: 'readonly',
        Dropbox: 'readonly',
      },
    },
    rules: {
      /* Catches the exact bug class that slipped through by hand
         during the ES module migration: a rename that accidentally
         touches an unrelated identifier, or a reference to something
         that was never actually imported. */
      'no-undef': 'error',
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none', /* catch(e) with an intentionally-unused e is a common, correct pattern throughout this codebase */
      }],
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-fallthrough': 'warn',
      /* Off: every instance this rule found in this codebase was
         `let x = <default>` followed by an if/else that always
         overwrites it — intentional defensive initialization, not
         a bug. Revisit if that stops being true. */
      'no-useless-assignment': 'off',
    },
  },
  {
    /* Tests run under Node, not the browser */
    files: ['tests/**/*.mjs', 'tests/**/*.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];

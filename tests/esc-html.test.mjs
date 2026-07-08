import './setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { escHtml } from '../js/state.js';

/* Regression coverage for the stored-XSS fix: every free-text field
   (row labels, descriptions, staff/account names, ...) gets rendered
   through innerHTML template strings all over the app. escHtml() is
   the one sanctioned way to make that safe — these tests pin down
   the escaping contract so a future edit can't quietly drop it. */
describe('escHtml — HTML-escapes user text before it hits innerHTML', () => {
  test('escapes the five characters that matter for HTML/attribute injection', () => {
    assert.equal(escHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  });

  test('neutralizes an attribute-breakout payload typed into a label field', () => {
    const payload = `x" onfocus="alert(1)" autofocus="`;
    const escaped = escHtml(payload);
    assert.ok(!escaped.includes('"'), 'no raw double-quote should survive');
    // simulate the exact template-literal usage in components.js row builders
    const rendered = `<input type="text" value="${escaped}">`;
    assert.equal(
      rendered,
      '<input type="text" value="x&quot; onfocus=&quot;alert(1)&quot; autofocus=&quot;">'
    );
  });

  test('neutralizes a tag-injection payload (img onerror)', () => {
    const payload = `"><img src=x onerror=alert(1)>`;
    const escaped = escHtml(payload);
    assert.ok(!escaped.includes('<img'), 'no live <img> tag should survive escaping');
    assert.equal(escaped, '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
  });

  test('passes ordinary label text through unchanged', () => {
    assert.equal(escHtml('Home Service 1'), 'Home Service 1');
    assert.equal(escHtml('Ali & Sons'), 'Ali &amp; Sons');
  });

  test('treats null/undefined as empty string rather than throwing or printing "undefined"', () => {
    assert.equal(escHtml(null), '');
    assert.equal(escHtml(undefined), '');
    assert.equal(escHtml(''), '');
  });

  test('coerces non-string input (e.g. a number) to its string form', () => {
    assert.equal(escHtml(45000), '45000');
  });
});

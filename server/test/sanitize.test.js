// server/test/sanitize.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitize } from '../src/llm/sanitize.js';

test('sanitize detects and removes invisible characters', () => {
  const result = sanitize('hello\u200B world');
  assert.equal(result.flags.zero_width, true);
  assert.equal(result.clean_text, 'hello world');
});

test('sanitize detects and removes HTML comments', () => {
  const result = sanitize('visible <!-- hidden --> text');
  assert.equal(result.flags.html_comment, true);
  assert.equal(result.clean_text, 'visible text');
});

test('sanitize detects inline hidden styles and removes tags', () => {
  const result = sanitize('shown <span style="display:none">secret</span> text');
  assert.equal(result.flags.hidden_style, true);
  assert.equal(result.clean_text, 'shown secret text');
});

test('sanitize normalizes clean text without raising flags', () => {
  const result = sanitize('  Ｃlean\n listing  ');
  assert.deepEqual(result.flags, { zero_width: false, html_comment: false, hidden_style: false });
  assert.equal(result.clean_text, 'Clean listing');
});

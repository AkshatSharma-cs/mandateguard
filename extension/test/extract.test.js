// extension/test/extract.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { JSDOM } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = await readFile(path.join(here, '../content/extract.js'), 'utf8');
async function extractFixture(name) {
  const html = await readFile(path.join(here, 'fixtures', name), 'utf8');
  const dom = new JSDOM(html, { url: `https://store.example/${name}`, runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    const left = this.style.left?.includes('-') ? -10000 : 10;
    return { x: left, y: 10, left, top: 10, right: left + 100, bottom: 30, width: 100, height: 20, toJSON() {} };
  };
  const module = { exports: null };
  const context = createContext({ window: dom.window, document: dom.window.document, location: dom.window.location,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), module, Date });
  runInContext(source, context);
  assert.equal(module.exports, dom.window.__mgExtract);
  const result = module.exports(); dom.window.close(); return result;
}

test('extracts JSON-LD price, currency, and active domain', async () => {
  const result = await extractFixture('json-ld.html');
  assert.equal(result.price_cents, 2499); assert.equal(result.currency, 'USD'); assert.equal(result.domain, 'store.example');
});
test('extracts Open Graph title and exact cents for a decimal price', async () => {
  const result = await extractFixture('opengraph.html');
  assert.equal(result.title, 'OG Keyboard'); assert.equal(result.price_cents, 5850); assert.equal(result.currency, 'EUR');
});
test('uses null when no price is present', async () => {
  assert.equal((await extractFixture('no-price.html')).price_cents, null);
});
test('flags hidden text in common hidden forms and excludes it from extracted text', async () => {
  const result = await extractFixture('hidden-text.html');
  assert.equal(result.hidden_text_found, true); assert.match(result.text, /Visible detail/);
  for (const marker of ['secret display', 'secret visibility', 'secret zero', 'secret aria', 'secret offscreen']) assert.doesNotMatch(result.text, new RegExp(marker));
});
test('supports the Amazon-style generic selectors used by the extractor', async () => {
  const result = await extractFixture('amazon-style.html');
  assert.equal(result.title, 'Wireless Mouse'); assert.equal(result.price_cents, 1995); assert.match(result.text, /Optical sensor/);
});

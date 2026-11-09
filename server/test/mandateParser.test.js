// server/test/mandateParser.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMandate, ParseError } from '../src/llm/mandateParser.js';
import { getMerchants } from '../src/catalogue/index.js';

const merchants = getMerchants();
const base = { item_category: 'mouse', max_total: '30.00', merchant_names: [], allow_bundles: undefined, allow_addons: undefined };
const fixedNow = new Date('2026-01-01T00:00:00.000Z');

test('buildMandate creates a pending, one-day proposal with approved defaults', () => {
  const { mandate, notes } = buildMandate(base, { merchants, now: fixedNow, owner_id: 'buyer-1' });
  assert.equal(mandate.status, 'pending_confirmation');
  assert.equal(mandate.max_total_cents, 3000);
  assert.equal(mandate.max_unit_price_cents, 3000);
  assert.equal(mandate.quantity_max, 1);
  assert.equal(mandate.expires_at, '2026-01-02T00:00:00.000Z');
  assert.equal(mandate.confirmed_at, null);
  assert.deepEqual(mandate.allowed_merchant_ids, ['m_acme', 'm_byte', 'm_zen']);
  assert.deepEqual(notes, []);
});

test('buildMandate maps named merchants and notes unknown names', () => {
  const { mandate, notes } = buildMandate({ ...base, merchant_names: ['ByteForge Electronics', 'No Such Shop'] },
    { merchants, now: fixedNow, owner_id: 'buyer-1' });
  assert.deepEqual(mandate.allowed_merchant_ids, ['m_byte']);
  assert.deepEqual(notes, ['Unknown merchant ignored: No Such Shop']);
});

test('buildMandate uses approved defaults when instruction says approved merchants', () => {
  const { mandate } = buildMandate({ ...base, merchant_names: ['Shady Deals Outlet'] },
    { merchants, now: fixedNow, owner_id: 'buyer-1', instruction: 'Use approved merchants only' });
  assert.deepEqual(mandate.allowed_merchant_ids, ['m_acme', 'm_byte', 'm_zen']);
});

test('buildMandate rejects invalid category, money, and totals over the limit', () => {
  assert.throws(() => buildMandate({ ...base, item_category: 'laptop' }, { merchants, now: fixedNow }), ParseError);
  assert.throws(() => buildMandate({ ...base, max_total: '30' }, { merchants, now: fixedNow }), ParseError);
  assert.throws(() => buildMandate({ ...base, max_total: '1000.01' }, { merchants, now: fixedNow }), ParseError);
});

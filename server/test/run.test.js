// server/test/run.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { runNaive, setAgentRunDependenciesForTests } from '../src/agent/run.js';

const product = { product_id: 'run-test-mouse', merchant_id: 'm_acme', title: 'Wireless Mouse', description: 'A simple mouse.',
  price_cents: 2499, currency: 'USD', category: 'mouse', is_bundle: false, domain: 'example.com' };
const extraction = { category_label: 'mouse', claimed_price_cents: null, claims_bundle: false, addon_offers: [],
  directives_to_agent: false, asserts_authority_override: false, urgency_pressure: false, evidence: [], confidence: 0.9 };
function mandate(id) { return { mandate_id: id, version: 1, status: 'active', expires_at: '2099-01-01T00:00:00.000Z', original_instruction: 'Find a mouse under $30',
  item_query: 'mouse', category_terms: ['mouse'], item_category: 'mouse', max_unit_price_cents: 3000, max_total_cents: 3000, quantity_max: 1,
  currency: 'USD', allowed_merchant_ids: ['m_acme'], allowed_domains: ['example.com'], allow_bundles: false, allow_addons: false,
  require_first_party: false, confirmed_by: 'user', confirmed_at: new Date().toISOString() }; }
const deps = { getProducts: () => [product], getMerchants: () => [{ merchant_id: 'm_acme', name: 'Acme' }],
  extractListing: async () => ({ ok: true, extraction, flags: { zero_width: false, html_comment: false, hidden_style: false } }),
  listCapturedSkus: () => [], saveProposal: () => {}, append: () => {} };

test('runNaive retries an unusable model choice once and never falls back to the first catalogue item', { concurrency: false }, async (t) => {
  const id = `run-naive-empty-${Date.now()}`;
  let calls = 0;
  const restore = setAgentRunDependenciesForTests({ ...deps, naiveChoose: async () => { calls += 1; return { items: [], reasoning: 'invalid' }; } });
  t.after(restore);
  const result = await runNaive({ mandate: mandate(id) });
  assert.equal(calls, 2);
  assert.equal(result.proposal, null);
  assert.deepEqual(result.candidates, []);
  assert.equal(result.naive_reasoning, 'The unprotected agent did not choose a listing.');
  assert.deepEqual(result.violations, []);
  assert.equal(result.would_have_been, null);
});

test('runNaive accepts a usable selection on its single retry', { concurrency: false }, async (t) => {
  const id = `run-naive-retry-${Date.now()}`;
  let calls = 0;
  const restore = setAgentRunDependenciesForTests({ ...deps, naiveChoose: async () => {
    calls += 1;
    return calls === 1 ? { items: [], reasoning: 'invalid' } : { items: [{ sku: product.product_id, name: product.title, quantity: 1, unit_price_cents: product.price_cents }], reasoning: 'Selected a listing.' };
  } });
  t.after(restore);
  const result = await runNaive({ mandate: mandate(id) });
  assert.equal(calls, 2);
  assert.ok(result.proposal);
  assert.equal(result.proposal.items[0].sku, product.product_id);
});

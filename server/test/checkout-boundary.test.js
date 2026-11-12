import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDatabase, getMandate, getProposal, listCapturedSkus, saveMandate, saveEvaluation, saveProposal } from '../src/db.js';
import { checkoutBoundary, getDemoStoreDomains } from '../src/payments/checkoutBoundary.js';
import { createV1Router } from '../src/routes/v1.js';
import { createPaymentsRouter } from '../src/routes/payments.js';

async function serve(t, app) {
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
const json = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('checkout mode is server-derived and demo-domain configuration overrides the default', () => {
  const observation = { source: 'curated', domain: 'shop.demo.test', url: 'https://shop.demo.test/item' };
  assert.deepEqual(checkoutBoundary({ ...observation, checkout_mode: 'handoff' }, { demoDomains: new Set(['demo.test']) }), { checkout_mode: 'gateway', handoff_url: null });
  assert.deepEqual(checkoutBoundary({ ...observation, source: 'channel3', checkout_mode: 'gateway' }, { demoDomains: new Set(['demo.test']) }), { checkout_mode: 'handoff', handoff_url: observation.url });
  assert.deepEqual([...getDemoStoreDomains('store.test, demo.test')], ['store.test', 'demo.test']);
});

test('an allowed handoff evaluation creates a simulation proposal and retains the Open at store handoff', async (t) => {
  const database = createDatabase(':memory:');
  t.after(() => database.close());
  const mandate = { mandate_id: 'profile-1', kind: 'profile', version: 1, status: 'active', expires_at: '2099-01-01T00:00:00Z' };
  saveMandate(mandate, database);
  const evaluation = { evaluation_id: 'evaluation-1', mandate_id: mandate.mandate_id, mandate_version: 1, decision: 'ALLOW',
    expires_at: '2099-01-01T00:00:00Z', created_at: new Date().toISOString(),
    observation: { observation_id: 'live-item', source: 'channel3', checkout_mode: 'handoff', handoff_url: 'https://www.amazon.com/dp/demo', url: 'https://www.amazon.com/dp/demo', domain: 'www.amazon.com', title: 'Live mouse', seller: 'Amazon', currency: 'USD', captured_at: new Date().toISOString(), content_hash: 'a'.repeat(64), price_cents: 1500 },
    proposal: { proposal_id: 'evaluation-1', mandate_id: mandate.mandate_id, mandate_version: 1, source: 'protected', status: 'ALLOWED', items: [], total_cents: 1500 } };
  saveEvaluation(evaluation, database);
  const audit = [];
  const app = express(); app.use(express.json());
  const router = createV1Router({ database, append: (event) => audit.push(event) });
  app.use('/v1', router);
  app.use('/api', router);
  const base = await serve(t, app);

  const proposalResponse = await fetch(`${base}/v1/proposals`, json({ evaluation_id: evaluation.evaluation_id }));
  assert.equal(proposalResponse.status, 201);
  assert.equal((await proposalResponse.json()).proposal.payment_mode, 'sandbox_simulation');
  const apiProposalResponse = await fetch(`${base}/api/proposals`, json({ evaluation_id: evaluation.evaluation_id }));
  assert.equal(apiProposalResponse.status, 200);
  assert.equal(await fetch(`${base}/v1/evaluations/${evaluation.evaluation_id}/proposal`, json({})).then((response) => response.status), 200);

  const handoffResponse = await fetch(`${base}/v1/evaluations/${evaluation.evaluation_id}/handoff`, json({}));
  assert.equal(handoffResponse.status, 200);
  assert.deepEqual(await handoffResponse.json(), { handoff_url: evaluation.observation.url });
  assert.equal(audit.at(-1).event_type, 'HANDOFF_OPENED');
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM proposals').get().count, 1);
});

test('evaluation ignores a client-supplied gateway checkout mode', async (t) => {
  const database = createDatabase(':memory:');
  t.after(() => database.close());
  saveMandate({ mandate_id: 'default-profile', kind: 'profile', is_default: true, version: 1, status: 'active',
    expires_at: '2099-01-01T00:00:00Z', item_query: null, item_category: null, category_terms: [], currency: 'USD',
    max_total_cents: 5000, max_unit_price_cents: 5000, quantity_max: 1, allowed_domains: ['amazon.com'], allowed_merchant_ids: [],
    allow_bundles: false, allow_addons: false, require_first_party: false }, database);
  const app = express(); app.use(express.json());
  app.use('/v1', createV1Router({ database, append: () => {}, evaluate: () => ({ decision: 'ALLOW', reasons: [], checks: [] }),
    extractListing: async () => ({ ok: true, extraction: { category_label: 'mouse', claimed_price_cents: null, claims_bundle: false,
      addon_offers: [], directives_to_agent: false, asserts_authority_override: false, urgency_pressure: false, evidence: [], confidence: 0.99 },
      flags: { zero_width: false, html_comment: false, hidden_style: false } }) }));
  const base = await serve(t, app);
  const response = await fetch(`${base}/v1/evaluate`, json({ observation: { observation_id: 'page-1', checkout_mode: 'gateway', payment_mode: 'store_checkout', simulated: false,
    handoff_url: 'https://attacker.invalid/', url: 'https://www.amazon.com/item/1', domain: 'www.amazon.com', source: 'curated',
    title: 'Wireless mouse', price_cents: 2000, currency: 'USD', seller: 'Amazon', sold_by_merchant: true,
    availability: 'in stock', image_url: null, category_hint: 'mouse', bundle_signal: false, hidden_text_found: false,
    text: 'Wireless mouse', captured_at: new Date().toISOString(), content_hash: 'a'.repeat(64) } }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.checkout_mode, 'handoff');
  assert.equal(body.observation.checkout_mode, 'handoff');
  assert.equal(body.payment_mode, 'sandbox_simulation');
  assert.equal(body.simulated, true);
  assert.equal(body.handoff_url, 'https://www.amazon.com/item/1');
});

test('trusted demo-store catalogue item remains eligible for a proposal', async (t) => {
  const database = createDatabase(':memory:');
  t.after(() => database.close());
  saveMandate({ mandate_id: 'demo-profile', kind: 'profile', is_default: true, version: 1, status: 'active',
    expires_at: '2099-01-01T00:00:00Z', item_query: null, item_category: null, category_terms: [], currency: 'USD',
    max_total_cents: 5000, max_unit_price_cents: 5000, quantity_max: 1, allowed_domains: ['acme.localhost'], allowed_merchant_ids: [],
    allow_bundles: false, allow_addons: false, require_first_party: false }, database);
  const app = express(); app.use(express.json());
  app.use('/v1', createV1Router({ database, append: () => {}, evaluate: () => ({ decision: 'ALLOW', reasons: [], checks: [] }),
    extractListing: async () => ({ ok: true, extraction: { category_label: 'mouse', claimed_price_cents: null, claims_bundle: false,
      addon_offers: [], directives_to_agent: false, asserts_authority_override: false, urgency_pressure: false, evidence: [], confidence: 0.99 },
      flags: { zero_width: false, html_comment: false, hidden_style: false } }) }));
  const storage = {
    getProposal: (id) => getProposal(id, database), getMandate: (id) => getMandate(id, database),
    saveProposal: (proposal) => saveProposal(proposal, database), listCapturedSkus: (id) => listCapturedSkus(id, database),
    reserveCapture: (id) => database.prepare("UPDATE proposals SET status = 'CAPTURE_PENDING' WHERE proposal_id = ? AND status = 'ORDER_CREATED'").run(id).changes === 1,
  };
  let createOrderInput;
  const approvedOrder = { id: 'demo-paypal-order', status: 'APPROVED', purchase_units: [{
    invoice_id: 'pending', custom_id: 'pending', amount: { currency_code: 'USD', value: '24.99' },
    items: [{ sku: 'p_ok_1', quantity: '1', unit_amount: { currency_code: 'USD', value: '24.99' } }],
  }] };
  let getOrderCalls = 0;
  const paypal = {
    createOrder: async (input) => { createOrderInput = input; return { id: 'demo-paypal-order' }; },
    getOrder: async () => {
      getOrderCalls += 1;
      const completed = { ...approvedOrder, status: 'COMPLETED', purchase_units: [{ ...approvedOrder.purchase_units[0],
        payments: { captures: [{ id: 'demo-capture' }] } }] };
      return structuredClone(getOrderCalls === 1 ? approvedOrder : completed);
    }, captureOrder: async () => {},
  };
  app.use('/api', createPaymentsRouter({ storage, paypal, append: () => {}, policy: () => ({ decision: 'ALLOW', reasons: [], checks: [] }) }));
  const base = await serve(t, app);
  const body = { observation: { observation_id: 'p_ok_1', checkout_mode: 'handoff', handoff_url: 'https://evil.invalid/',
    url: 'http://acme.localhost:3000/demo-store/p_ok_1.html', domain: 'acme.localhost', source: 'curated', title: 'Forged item',
    price_cents: 1, currency: 'USD', seller: 'Forged seller', sold_by_merchant: false, availability: 'unknown', image_url: null,
    category_hint: 'unknown', bundle_signal: true, hidden_text_found: false, text: 'forged', captured_at: new Date().toISOString(), content_hash: 'b'.repeat(64) } };
  const evaluated = await fetch(`${base}/v1/evaluate`, json(body));
  assert.equal(evaluated.status, 200);
  const result = await evaluated.json();
  assert.equal(result.decision, 'ALLOW');
  assert.equal(result.checkout_mode, 'gateway');
  assert.equal(result.observation.title, 'Acme Precision Wired Optical Mouse');
  assert.equal(result.observation.price_cents, 2499);
  const proposed = await fetch(`${base}/v1/proposals`, json({ evaluation_id: result.evaluation_id }));
  assert.equal(proposed.status, 200);
  const proposalResult = await proposed.json();
  assert.ok(proposalResult.console_url);
  approvedOrder.purchase_units[0].invoice_id = proposalResult.proposal.proposal_id;
  approvedOrder.purchase_units[0].custom_id = proposalResult.proposal.proposal_id;
  const orderResponse = await fetch(`${base}/api/proposals/${proposalResult.proposal.proposal_id}/checkout`, json({}));
  assert.equal(orderResponse.status, 201);
  assert.deepEqual(await orderResponse.json(), { paypal_order_id: 'demo-paypal-order' });
  assert.equal(createOrderInput.demo_store_order, true);
  assert.equal(createOrderInput.merchant_name, 'Acme Peripherals Co.');
  const captureResponse = await fetch(`${base}/api/proposals/${proposalResult.proposal.proposal_id}/capture`, json({ order_id: 'demo-paypal-order' }));
  assert.equal(captureResponse.status, 200);
  assert.equal((await captureResponse.json()).status, 'CAPTURED');
});

test('the checkout endpoint rejects invalid proposals before contacting PayPal', async (t) => {
  let created = 0;
  const proposal = { proposal_id: 'p-handoff', checkout_mode: 'handoff', handoff_url: 'https://www.amazon.com/item', status: 'DRAFT', source: 'naive' };
  const app = express(); app.use(express.json());
  app.use('/api', createPaymentsRouter({ storage: { getProposal: () => proposal }, paypal: { createOrder: async () => { created += 1; } } }));
  const base = await serve(t, app);
  const response = await fetch(`${base}/api/proposals/${proposal.proposal_id}/checkout`, json({}));
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.error.code, 'PROPOSAL_NOT_CHECKOUTABLE');
  assert.equal(created, 0);
});

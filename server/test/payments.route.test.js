// server/test/payments.route.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createHash } from 'node:crypto';
import { createPaymentsRouter } from '../src/routes/payments.js';

const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
    : JSON.stringify(value);

test('simultaneous capture requests reserve once and call PayPal capture once', async (t) => {
  const product = { product_id: 'p1', merchant_id: 'm_acme', title: 'Mouse', description: 'fictional', price_cents: 2499, currency: 'USD', category: 'mouse', is_bundle: false };
  const proposal = {
    proposal_id: 'pr1', mandate_id: 'm1', mandate_version: 1, merchant_id: 'm_acme', currency: 'USD',
    items: [{ sku: 'p1', name: 'Mouse', quantity: 1, unit_price_cents: 2499 }], total_cents: 2499,
    source: 'protected', status: 'ORDER_CREATED', paypal_order_id: 'order1', created_at: new Date().toISOString(),
    evidence: { extractions: {}, sanitize_flags: {}, catalogue_hash: createHash('sha256').update(canonical([product])).digest('hex') },
  };
  const mandate = { mandate_id: 'm1', version: 1, status: 'active', expires_at: '2099-01-01T00:00:00Z', currency: 'USD', item_category: 'mouse',
    max_unit_price_cents: 3000, max_total_cents: 3000, quantity_max: 1, allowed_merchant_ids: ['m_acme'], allow_bundles: false, allow_addons: false };
  let stored = structuredClone(proposal);
  let reserveCalls = 0;
  const storage = {
    getProposal: () => structuredClone(stored), getMandate: () => mandate,
    saveProposal: (value) => { stored = structuredClone(value); },
    listCapturedSkus: () => [],
    reserveCapture: () => { reserveCalls += 1; if (stored.status !== 'ORDER_CREATED') return false; stored.status = 'CAPTURE_PENDING'; return true; },
  };
  let paypalCaptures = 0;
  let getCount = 0;
  const approvedOrder = { id: 'order1', status: 'APPROVED', purchase_units: [{ invoice_id: 'pr1', custom_id: 'pr1',
    amount: { currency_code: 'USD', value: '24.99' }, items: [{ sku: 'p1', quantity: '1', unit_amount: { currency_code: 'USD', value: '24.99' } }] }] };
  const completedOrder = { ...structuredClone(approvedOrder), status: 'COMPLETED', purchase_units: [{ ...approvedOrder.purchase_units[0], payments: { captures: [{ id: 'capture1' }] } }] };
  const paypal = {
    getOrder: async () => { getCount += 1; return structuredClone(getCount <= 2 ? approvedOrder : completedOrder); },
    captureOrder: async () => { paypalCaptures += 1; },
  };
  const app = express(); app.use(express.json());
  app.use('/api', createPaymentsRouter({ paypal, storage, append: () => {}, policy: () => ({ decision: 'ALLOW', reasons: [], checks: [] }),
    catalogueProducts: () => new Map([['p1', product]]), clock: () => new Date('2026-11-09T12:00:00Z') }));
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/proposals/pr1/capture`;
  const request = () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ order_id: 'order1' }) });
  const responses = await Promise.all([request(), request()]);
  assert.equal(paypalCaptures, 1);
  assert.ok(reserveCalls >= 1 && reserveCalls <= 2);
  assert.ok(responses.some((response) => response.status === 200));
});

test('naive proposals are rejected before PayPal checkout', async (t) => {
  let created = 0;
  const storage = { getProposal: () => ({ proposal_id: 'naive-1', mandate_id: 'm1', source: 'naive', status: 'DRAFT' }) };
  const app = express(); app.use(express.json());
  app.use('/api', createPaymentsRouter({ storage, paypal: { createOrder: async () => { created += 1; } }, append: () => {} }));
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/proposals/naive-1/checkout`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(response.status, 409);
  assert.equal(created, 0);
});

// server/test/paypal-simulation.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrder } from '../src/paypal/client.js';

test('simulation orders disclose the retailer and contain only the approved title and amount', async () => {
  const oldFetch = globalThis.fetch;
  const oldEnv = { base: process.env.PAYPAL_BASE_URL, id: process.env.PAYPAL_CLIENT_ID, secret: process.env.PAYPAL_CLIENT_SECRET };
  process.env.PAYPAL_BASE_URL = 'https://api-m.sandbox.paypal.com';
  process.env.PAYPAL_CLIENT_ID = 'test-client'; process.env.PAYPAL_CLIENT_SECRET = 'test-secret';
  const bodies = [];
  globalThis.fetch = async (_url, options) => {
    if (String(_url).endsWith('/v1/oauth2/token')) return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ access_token: 'test-token', expires_in: 3600 }) };
    bodies.push(JSON.parse(options.body));
    return { ok: true, status: 201, headers: { get: () => null }, text: async () => JSON.stringify({ id: 'order-test', status: 'CREATED', links: [] }) };
  };
  try {
    await createOrder({ proposal_id: 'proposal-123', mode: 'sdk', payment_mode: 'sandbox_simulation',
      domain: 'shop.example', title: 'Wireless Mouse', currency: 'USD',
      items: [{ sku: 'observation-abcdef', name: 'untrusted irrelevant text', quantity: 1, unit_price_cents: 2499 }] });
    const unit = bodies[0].purchase_units[0];
    assert.match(unit.description, /^SANDBOX SIMULATION \(no purchase at shop\.example\): Wireless Mouse/);
    assert.equal(unit.items[0].name, 'Wireless Mouse'); assert.equal(unit.items[0].sku, 'observation-');
    assert.equal(unit.items[0].quantity, '1'); assert.equal(unit.items[0].unit_amount.value, '24.99');
    assert.equal(unit.invoice_id, 'proposal-123'); assert.equal(unit.custom_id, 'proposal-123');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldEnv.base === undefined) delete process.env.PAYPAL_BASE_URL; else process.env.PAYPAL_BASE_URL = oldEnv.base;
    if (oldEnv.id === undefined) delete process.env.PAYPAL_CLIENT_ID; else process.env.PAYPAL_CLIENT_ID = oldEnv.id;
    if (oldEnv.secret === undefined) delete process.env.PAYPAL_CLIENT_SECRET; else process.env.PAYPAL_CLIENT_SECRET = oldEnv.secret;
  }
});

// server/test/verify.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyBeforeCapture } from '../src/capture/verify.js';

const now = new Date('2026-11-09T12:00:00Z');
const proposal = {
  proposal_id: 'pr1', proposal_id_ref: 'pr1', proposal_id: 'pr1', source: 'protected', status: 'ORDER_CREATED',
  paypal_order_id: 'order1', mandate_version: 1, currency: 'USD', total_cents: 2499,
  items: [{ sku: 'p1', name: 'Mouse', quantity: 1, unit_price_cents: 2499 }],
};
const mandate = { status: 'active', version: 1, expires_at: '2026-11-10T12:00:00Z' };
const order = {
  id: 'order1', status: 'APPROVED',
  purchase_units: [{ invoice_id: 'pr1', custom_id: 'pr1', amount: { currency_code: 'USD', value: '24.99' },
    items: [{ sku: 'p1', quantity: '1', unit_amount: { currency_code: 'USD', value: '24.99' } }] }],
};
const verify = (overrides = {}) => verifyBeforeCapture({ proposal: structuredClone(proposal), mandate: structuredClone(mandate),
  order: structuredClone(order), businessEmail: 'merchant@example.test', alreadyCaptured: false, policyDecision: 'ALLOW', now, ...overrides });

test('all verification checks pass when the exact approved order is presented', () => {
  const result = verify();
  assert.equal(result.ok, true);
  assert.equal(result.checks.length, 11);
});

test('each V check fails closed on its tampering case', () => {
  const cases = [
    ['V1 protected state/source', (p) => { p.source = 'naive'; }],
    ['V2 order id', (_p, _m, o) => { o.id = 'other'; }],
    ['V3 mandate version', (_p, m) => { m.version = 2; }],
    ['V3 revoked mandate', (_p, m) => { m.status = 'revoked'; }],
    ['V3 expired at now', (_p, m) => { m.expires_at = now.toISOString(); }],
    ['V4 order status', (_p, _m, o) => { o.status = 'CREATED'; }],
    ['V5 currency', (_p, _m, o) => { o.purchase_units[0].amount.currency_code = 'EUR'; }],
    ['V6 amount', (_p, _m, o) => { o.purchase_units[0].amount.value = '25.00'; }],
    ['V7 SKU', (_p, _m, o) => { o.purchase_units[0].items[0].sku = 'other'; }],
    ['V7 extra line', (_p, _m, o) => { o.purchase_units[0].items.push(structuredClone(o.purchase_units[0].items[0])); }],
    ['V7 quantity', (_p, _m, o) => { o.purchase_units[0].items[0].quantity = '2'; }],
    ['V7 unit price', (_p, _m, o) => { o.purchase_units[0].items[0].unit_amount.value = '24.98'; }],
    ['V8 invoice id', (_p, _m, o) => { o.purchase_units[0].invoice_id = 'other'; }],
    ['V8 custom id', (_p, _m, o) => { o.purchase_units[0].custom_id = 'other'; }],
    ['V9 payee', (_p, _m, o) => { o.purchase_units[0].payee = { email_address: 'attacker@example.test' }; }],
  ];
  for (const [label, mutate] of cases) {
    const p = structuredClone(proposal), m = structuredClone(mandate), o = structuredClone(order);
    mutate(p, m, o);
    assert.equal(verify({ proposal: p, mandate: m, order: o }).ok, false, label);
  }
  assert.equal(verify({ alreadyCaptured: true }).checks.find((item) => item.id === 'V10').passed, false);
  assert.equal(verify({ policyDecision: 'REVIEW' }).checks.find((item) => item.id === 'V11').passed, false);
});

test('missing payee is allowed when PayPal omits the field', () => {
  assert.equal(verify().checks.find((item) => item.id === 'V9').detail, 'payee not returned');
});

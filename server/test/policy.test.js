// server/test/policy.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/policy/engine.js';

const now = new Date('2026-11-09T12:00:00.000Z');
const mandate = {
  mandate_id: 'm1', version: 1, status: 'active', expires_at: '2026-11-10T12:00:00.000Z',
  currency: 'USD', item_category: 'mouse', max_unit_price_cents: 3000,
  max_total_cents: 3000, quantity_max: 1, allowed_merchant_ids: ['m_acme'],
  allow_bundles: false, allow_addons: false,
};
const product = { product_id: 'p1', merchant_id: 'm_acme', price_cents: 2499, currency: 'USD', category: 'mouse', is_bundle: false };
const extraction = {
  category_label: 'mouse', claimed_price_cents: null, claims_bundle: false, addon_offers: [],
  directives_to_agent: false, asserts_authority_override: false, urgency_pressure: false,
  evidence: [], confidence: 0.9,
};
const flags = { zero_width: false, html_comment: false, hidden_style: false };
function input(overrides = {}) {
  return {
    mandate: { ...mandate },
    proposal: { proposal_id: 'pr1', mandate_id: 'm1', mandate_version: 1, currency: 'USD', total_cents: 2499,
      items: [{ sku: 'p1', name: 'Mouse', quantity: 1, unit_price_cents: 2499 }] },
    catalogue: new Map([['p1', { ...product }]]),
    extractions: new Map([['p1', { ...extraction }]]),
    sanitizeFlags: new Map([['p1', { ...flags }]]), captured: [], now,
    ...overrides,
  };
}
const codes = (result) => result.reasons.map((reason) => reason.code);

test('happy path allows a valid proposal and exact unit-price boundary', () => {
  assert.equal(evaluate(input()).decision, 'ALLOW');
  const atLimit = input();
  atLimit.proposal.items[0].unit_price_cents = 3000;
  atLimit.proposal.total_cents = 3000;
  atLimit.catalogue.get('p1').price_cents = 3000;
  assert.equal(evaluate(atLimit).decision, 'ALLOW');
  atLimit.proposal.items[0].unit_price_cents = 3001;
  atLimit.proposal.total_cents = 3001;
  atLimit.catalogue.get('p1').price_cents = 3001;
  assert.equal(evaluate(atLimit).decision, 'BLOCK');
  assert.ok(codes(evaluate(atLimit)).includes('OVER_BUDGET'));
});

test('each contract rule fails closed with its exact reason code', () => {
  const cases = [
    ['MANDATE_INACTIVE', (x) => { x.mandate.status = 'pending_confirmation'; }],
    ['MANDATE_EXPIRED', (x) => { x.mandate.expires_at = now.toISOString(); }],
    ['MANDATE_STALE', (x) => { x.proposal.mandate_version = 2; }],
    ['CURRENCY_MISMATCH', (x) => { x.proposal.currency = 'EUR'; }],
    ['MERCHANT_NOT_ALLOWED', (x) => { x.mandate.allowed_merchant_ids = []; }],
    ['PRODUCT_UNKNOWN', (x) => { x.proposal.items[0].sku = 'missing'; }],
    ['PRICE_TAMPERED', (x) => { x.proposal.total_cents = 2498; }],
    ['OVER_BUDGET', (x) => { x.mandate.max_total_cents = 2498; }],
    ['QUANTITY_EXCEEDED', (x) => { x.proposal.items[0].quantity = 2; x.proposal.total_cents = 4998; x.mandate.quantity_max = 1; }],
    ['ADDON_NOT_ALLOWED', (x) => { x.proposal.items.push({ sku: 'p2', name: 'Other', quantity: 1, unit_price_cents: 1 }); x.catalogue.set('p2', { ...product, product_id: 'p2', price_cents: 1 }); x.extractions.set('p2', { ...extraction }); x.sanitizeFlags.set('p2', { ...flags }); x.proposal.total_cents = 2500; }],
    ['BUNDLE_NOT_ALLOWED', (x) => { x.catalogue.get('p1').is_bundle = true; }],
    ['DUPLICATE', (x) => { x.captured = [{ mandate_id: 'm1', sku: 'p1' }]; }],
    ['BUNDLE_UNKNOWN', (x) => { x.catalogue.get('p1').is_bundle = null; }],
    ['HIDDEN_CONTENT', (x) => { x.sanitizeFlags.get('p1').zero_width = true; }],
    ['INJECTION_DETECTED', (x) => { x.extractions.get('p1').directives_to_agent = true; }],
    ['BUNDLE_TEXT_CONFLICT', (x) => { x.extractions.get('p1').claims_bundle = true; }],
    ['TEXT_PRICE_CONFLICT', (x) => { x.extractions.get('p1').claimed_price_cents = 300; }],
    ['CATEGORY_MISMATCH', (x) => { x.extractions.get('p1').category_label = 'keyboard'; }],
    ['URGENCY_PRESSURE', (x) => { x.extractions.get('p1').urgency_pressure = true; }],
    ['LOW_CONFIDENCE', (x) => { x.extractions.get('p1').confidence = 0.49; }],
    ['EXTRACTOR_FAILED', (x) => { x.extractions.set('p1', null); }],
    ['OVER_BUDGET', (x) => { x.mandate.max_unit_price_cents = 2498; }],
    ['PRICE_TAMPERED', (x) => { x.proposal.items[0].unit_price_cents = 2400; }],
    ['CURRENCY_MISMATCH', (x) => { x.catalogue.get('p1').currency = 'EUR'; }],
    ['ADDON_NOT_ALLOWED', (x) => { x.catalogue.get('p1').category = 'keyboard'; }],
    ['INVALID_PROPOSAL', (x) => { x.proposal.items[0].quantity = -1; }],
    ['INVALID_PROPOSAL', (x) => { x.proposal.items[0].unit_price_cents = '2499'; }],
    ['INVALID_PROPOSAL', (x) => { delete x.proposal.items[0].name; }],
    ['OVER_BUDGET', (x) => { x.proposal.items[0].quantity = 2; x.proposal.total_cents = 4998; x.mandate.quantity_max = 2; }],
    ['EXTRACTOR_FAILED', (x) => { x.extractions.set('p1', { ...extraction, extra: true }); }],
    ['MANDATE_EXPIRED', (x) => { x.mandate.expires_at = 'invalid'; }],
    ['MANDATE_EXPIRED', (x) => { x.mandate.expires_at = '2026-11-09T11:59:59.999Z'; }],
    ['BUNDLE_NOT_ALLOWED', (x) => { x.catalogue.get('p1').is_bundle = true; x.mandate.allow_bundles = false; }],
    ['DUPLICATE', (x) => { x.captured = [{ mandate_id: 'm1', sku: 'p1' }]; }],
    ['LOW_CONFIDENCE', (x) => { x.extractions.get('p1').confidence = 0; }],
    ['HIDDEN_CONTENT', (x) => { x.sanitizeFlags.set('p1', { html_comment: true }); }],
  ];
  assert.ok(cases.length >= 35, 'policy cases should provide at least 35 focused examples');
  for (const [code, mutate] of cases) {
    const value = input(); mutate(value);
    assert.ok(codes(evaluate(value)).includes(code), `${code} should be reported`);
    assert.notEqual(evaluate(value).decision, 'ALLOW', `${code} must never allow`);
  }
});

test('confidence 0.5 is the injection boundary and multiple failures aggregate', () => {
  const boundary = input();
  boundary.extractions.get('p1').directives_to_agent = true;
  boundary.extractions.get('p1').confidence = 0.5;
  assert.equal(evaluate(boundary).decision, 'BLOCK');
  const low = input();
  low.extractions.get('p1').directives_to_agent = true;
  low.extractions.get('p1').confidence = 0.49;
  assert.equal(evaluate(low).decision, 'REVIEW');
  assert.ok(codes(evaluate(low)).includes('LOW_CONFIDENCE'));
  const multiple = input(); multiple.mandate.status = 'revoked'; multiple.proposal.currency = 'EUR';
  assert.equal(evaluate(multiple).decision, 'BLOCK');
  assert.ok(codes(evaluate(multiple)).includes('MANDATE_INACTIVE'));
  assert.ok(codes(evaluate(multiple)).includes('CURRENCY_MISMATCH'));
});

test('profile evaluations with a null item_query skip CATEGORY_MISMATCH', () => {
  const value = input();
  value.mandate.item_query = null;
  value.extractions.get('p1').category_label = 'keyboard';
  const result = evaluate(value);
  assert.equal(result.decision, 'ALLOW');
  assert.equal(codes(result).includes('CATEGORY_MISMATCH'), false);
});

test('invalid data is blocked without throwing', () => {
  for (const bad of [null, {}, { ...input(), now: 'not a date' }, { ...input(), proposal: { ...input().proposal, items: [{ sku: 'p1', quantity: -1, unit_price_cents: 1 }] } }]) {
    assert.doesNotThrow(() => evaluate(bad));
    assert.equal(evaluate(bad).decision, 'BLOCK');
  }
});

test('seeded property checks preserve fail-closed decisions for 500 generated cases', () => {
  let seed = 0x51f15e;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
  for (let i = 0; i < 500; i += 1) {
    const reviewCase = input();
    reviewCase.extractions.get('p1').confidence = 0.49;
    if (random() > 0.5) reviewCase.extractions.get('p1').urgency_pressure = true;
    assert.notEqual(evaluate(reviewCase).decision, 'ALLOW');

    const deterministicFailure = input();
    deterministicFailure.mandate.max_total_cents = Math.floor(random() * 2499);
    assert.notEqual(evaluate(deterministicFailure).decision, 'ALLOW');
  }
});

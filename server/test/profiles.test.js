// server/test/profiles.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDatabase, getMandate, listMandates, saveMandate } from '../src/db.js';
import { createAudit } from '../src/audit.js';
import { createProfileService, ProfileError } from '../src/mandate/profiles.js';
import { createV1Router } from '../src/routes/v1.js';

const profileLimits = (overrides = {}) => ({ max_total: '30.00', allow_bundles: false, allow_addons: false,
  require_first_party: false, allowed_domains: ['amazon.com', 'amazon.com'], ...overrides });
const taskParsed = (overrides = {}) => ({ item_query: 'wireless mouse', category_terms: ['mouse'], max_total: null,
  allow_bundles: null, allow_addons: null, require_first_party: null, allowed_domains: null, ...overrides });
const now = new Date('2026-11-11T12:00:00.000Z');

function fixture() {
  const database = createDatabase(':memory:');
  const audit = createAudit(database);
  const service = createProfileService({ database, append: audit.append,
    getMandate: (id) => {
      const row = database.prepare('SELECT json FROM mandates WHERE mandate_id = ?').get(id);
      return row ? JSON.parse(row.json) : null;
    },
    listMandates: (options) => listMandates(options, database),
    saveMandate: (mandate) => saveMandate(mandate, database),
  });
  return { database, audit, service };
}

function launch(t, router) {
  const app = express(); app.use(express.json()); app.use('/v1', router); app.use('/api/v1', router);
  app.use((error, _req, res, _next) => res.status(error.status ?? 500).json({ error: { code: error.code ?? 'ERROR', message: error.message } }));
  const server = app.listen(0);
  t.after(() => new Promise(resolve => { server.close(resolve); }));
  return new Promise(resolve => server.once('listening', () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

test('profile creation validates limits, drops duplicate domains, and requires explicit confirmation', async (t) => {
  const { database, service } = fixture(); t.after(() => database.close());
  const profile = await service.createProfile({ limits: profileLimits() }, { now, owner_id: 'buyer-1' });
  assert.equal(profile.kind, 'profile');
  assert.equal(profile.status, 'pending_confirmation');
  assert.equal(profile.is_default, false);
  assert.equal(profile.item_query, null);
  assert.equal(profile.expires_at, '2027-11-11T12:00:00.000Z');
  assert.deepEqual(profile.allowed_domains, ['amazon.com']);
  await assert.rejects(service.createProfile({ limits: profileLimits({ allowed_domains: ['shop.amazon.com'] }) }), ProfileError);
  await assert.rejects(service.createProfile({ limits: profileLimits({ max_total: '1000.01' }) }, { now }), ProfileError);
  await assert.rejects(service.createProfile({ limits: profileLimits({ allowed_domains: ['Amazon.com'] }) }, { now }), ProfileError);
  assert.equal(service.listProfiles({ owner_id: 'buyer-1' }).length, 1);
});

test('profiles become active only by confirmation and exactly one profile is default per owner', async (t) => {
  const { database, service, audit } = fixture(); t.after(() => database.close());
  const first = await service.createProfile({ limits: profileLimits() }, { now, owner_id: 'buyer-1' });
  assert.throws(() => service.setDefault(first.mandate_id, { owner_id: 'buyer-1', now }), (error) => error.code === 'PROFILE_INACTIVE');
  const confirmedFirst = service.confirmProfile(first.mandate_id, { owner_id: 'buyer-1', now });
  assert.equal(confirmedFirst.status, 'active');
  assert.equal(confirmedFirst.confirmed_by, 'user');
  service.setDefault(first.mandate_id, { owner_id: 'buyer-1', now });
  const second = await service.createProfile({ limits: profileLimits({ max_total: '80.00' }) }, { now, owner_id: 'buyer-1' });
  service.confirmProfile(second.mandate_id, { owner_id: 'buyer-1', now });
  service.setDefault(second.mandate_id, { owner_id: 'buyer-1', now });
  const defaults = service.listProfiles({ owner_id: 'buyer-1' }).filter(profile => profile.is_default);
  assert.equal(defaults.length, 1);
  assert.equal(defaults[0].mandate_id, second.mandate_id);
  assert.ok(audit.list().some(event => event.event_type === 'PROFILE_CONFIRMED'));
});

test('derivation inside the profile auto-activates and records its parent and limits', async (t) => {
  const { database, service, audit } = fixture(); t.after(() => database.close());
  const pending = await service.createProfile({ limits: profileLimits() }, { now, owner_id: 'buyer-1' });
  const profile = service.confirmProfile(pending.mandate_id, { owner_id: 'buyer-1', now });
  const derived = service.createDerivedTaskMandate(profile, taskParsed(), { now, owner_id: 'buyer-1' });
  assert.equal(derived.within_profile, true);
  assert.deepEqual(derived.exceeded, []);
  assert.equal(derived.mandate.status, 'active');
  assert.equal(derived.mandate.confirmed_by, `profile:${profile.mandate_id}`);
  const event = audit.list({ mandate_id: derived.mandate.mandate_id }).find(value => value.event_type === 'MANDATE_AUTO_ACTIVATED');
  assert.equal(event.payload.parent_profile_id, profile.mandate_id);
  assert.equal(event.payload.limits.max_total_cents, profile.max_total_cents);
});

test('each profile expansion stays pending with the requested limit in notes and is never clamped', async (t) => {
  const { database, service } = fixture(); t.after(() => database.close());
  const pending = await service.createProfile({ limits: profileLimits({ require_first_party: true }) }, { now });
  const profile = service.confirmProfile(pending.mandate_id, { now });
  const cases = [
    ['max_total', { max_total: '55.00' }],
    ['allow_bundles', { allow_bundles: true }],
    ['allow_addons', { allow_addons: true }],
    ['require_first_party', { require_first_party: false }],
    ['allowed_domains', { allowed_domains: ['walmart.com'] }],
  ];
  for (const [limit, override] of cases) {
    const result = service.createDerivedTaskMandate(profile, taskParsed(override), { now });
    assert.equal(result.mandate.status, 'pending_confirmation', limit);
    assert.ok(result.exceeded.includes(limit), limit);
    assert.ok(result.notes.some(note => note.includes(limit)), limit);
    if (limit === 'max_total') assert.equal(result.mandate.max_total_cents, 5500, 'expanded ceiling remains visible for explicit confirmation');
  }
  assert.throws(() => service.createDerivedTaskMandate(profile, taskParsed({ max_total: '1000.01' }), { now }), /Maximum total/);
});

test('generated auto-activated mandates never exceed their confirmed profile ceiling', async (t) => {
  const { database, service } = fixture(); t.after(() => database.close());
  const pending = await service.createProfile({ limits: profileLimits({ require_first_party: true }) }, { now });
  const profile = service.confirmProfile(pending.mandate_id, { now });
  let seed = 0x9e3779b9;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
  for (let index = 0; index < 300; index += 1) {
    const cents = 1 + Math.floor(random() * 100000);
    const parsed = taskParsed({ max_total: `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`,
      allow_bundles: random() > 0.7, allow_addons: random() > 0.7, require_first_party: random() > 0.35,
      allowed_domains: random() > 0.8 ? ['walmart.com'] : ['amazon.com'] });
    const result = service.createDerivedTaskMandate(profile, parsed, { now });
    if (result.mandate.status === 'active') {
      assert.ok(result.mandate.max_total_cents <= profile.max_total_cents);
      assert.equal(result.mandate.allow_bundles && !profile.allow_bundles, false);
      assert.equal(result.mandate.allow_addons && !profile.allow_addons, false);
      assert.equal(!result.mandate.require_first_party && profile.require_first_party, false);
      assert.ok(result.mandate.allowed_domains.every(domain => profile.allowed_domains.includes(domain)));
    }
  }
});

test('API derives from the default profile and returns NO_PREFERENCES without one', async (t) => {
  const database = createDatabase(':memory:'); t.after(() => database.close());
  const audit = createAudit(database);
  const extraction = { ok: true, extraction: { category_label: 'mouse', claimed_price_cents: null, claims_bundle: false, addon_offers: [], directives_to_agent: false, asserts_authority_override: false, urgency_pressure: false, evidence: [], confidence: 0.99 }, flags: { zero_width: false, html_comment: false, hidden_style: false } };
  const router = createV1Router({ database, append: audit.append, extractListing: async () => extraction });
  const base = await launch(t, router);
  const validObservation = { observation_id: 'no-profile', url: 'https://amazon.com/item/1', domain: 'amazon.com', source: 'page', title: 'Mouse', price_cents: 2500, currency: 'USD', seller: 'Amazon', sold_by_merchant: true, availability: 'in stock', image_url: null, category_hint: 'mouse', bundle_signal: false, hidden_text_found: false, text: 'Mouse', captured_at: now.toISOString(), content_hash: 'c'.repeat(64) };
  const malformed = await fetch(`${base}/v1/evaluate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ observation: {} }) });
  assert.equal(malformed.status, 400);
  const missing = await fetch(`${base}/v1/evaluate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ observation: validObservation }) });
  assert.equal(missing.status, 409);
  assert.equal((await missing.json()).error.code, 'NO_PREFERENCES');
  const pending = await fetch(`${base}/v1/profiles`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ limits: profileLimits() }) });
  const profile = (await pending.json()).profile;
  assert.equal(pending.status, 201);
  await fetch(`${base}/v1/profiles/${profile.mandate_id}/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  await fetch(`${base}/v1/profiles/${profile.mandate_id}/default`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const observation = { ...validObservation, observation_id: 'page-1', title: 'Wireless mouse', text: 'Optical wireless mouse', content_hash: 'a'.repeat(64) };
  const response = await fetch(`${base}/v1/evaluate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ observation, alternatives: false }) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.observation.domain, 'amazon.com');
  assert.equal(result.decision, 'ALLOW', JSON.stringify(result.reasons));
});

test('API alternatives persist ALLOW evaluations as proposal-ready and fail closed to an empty list', async (t) => {
  const database = createDatabase(':memory:'); t.after(() => database.close());
  const audit = createAudit(database);
  const extraction = { ok: true, extraction: { category_label: 'mouse', claimed_price_cents: null, claims_bundle: false, addon_offers: [], directives_to_agent: false, asserts_authority_override: false, urgency_pressure: false, evidence: [], confidence: 0.99 }, flags: { zero_width: false, html_comment: false, hidden_style: false } };
  const candidateProduct = { product_id: 'curated-1', merchant_id: 'm1', title: 'Wireless mouse alternative', description: 'An optical mouse', price_cents: 2000, currency: 'USD', category: 'mouse', is_bundle: false, domain: 'bestbuy.com', url: 'https://bestbuy.com/item/1', first_party: true };
  const router = createV1Router({ database, append: audit.append, extractListing: async () => extraction,
    searchProducts: async () => [candidateProduct],
    evaluate: ({ catalogue }) => {
      const product = [...catalogue.values()][0];
      const allowed = product.product_id === 'curated-1';
      return { decision: allowed ? 'ALLOW' : 'BLOCK', reasons: allowed ? [] : [{ code: 'DOMAIN_NOT_ALLOWED', severity: 'BLOCK', source: 'deterministic', message: 'Domain not allowed' }], checks: [] };
    },
  });
  const base = await launch(t, router);
  const limits = { ...profileLimits(), allowed_domains: ['amazon.com', 'bestbuy.com'] };
  const created = await fetch(`${base}/v1/profiles`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ limits }) });
  const profile = (await created.json()).profile;
  await fetch(`${base}/v1/profiles/${profile.mandate_id}/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const observation = { observation_id: 'blocked-page', url: 'https://amazon.com/item/1', domain: 'amazon.com', source: 'page', title: 'Wireless mouse', price_cents: 2500, currency: 'USD', seller: 'Marketplace seller', sold_by_merchant: false, availability: 'in stock', image_url: null, category_hint: 'mouse', bundle_signal: false, hidden_text_found: false, text: 'Optical mouse', captured_at: now.toISOString(), content_hash: 'b'.repeat(64) };
  const response = await fetch(`${base}/v1/evaluate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profile_id: profile.mandate_id, observation }) });
  const result = await response.json();
  assert.equal(result.decision, 'BLOCK');
  assert.equal(result.alternatives.length, 1);
  assert.equal(result.alternatives[0].decision, 'ALLOW');
  const proposalResponse = await fetch(`${base}/v1/proposals`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ evaluation_id: result.alternatives[0].evaluation_id }) });
  assert.equal(proposalResponse.status, 201);
  assert.equal((await proposalResponse.json()).proposal.status, 'ALLOWED');

  const failingRouter = createV1Router({ database, append: audit.append, extractListing: async () => extraction,
    searchProducts: async () => { throw new Error('catalogue unavailable'); },
    evaluate: () => ({ decision: 'BLOCK', reasons: [], checks: [] }),
  });
  const failingBase = await launch(t, failingRouter);
  const failedAlternatives = await fetch(`${failingBase}/v1/evaluate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profile_id: profile.mandate_id, observation }) });
  const preserved = await failedAlternatives.json();
  assert.equal(failedAlternatives.status, 200);
  assert.equal(preserved.decision, 'BLOCK');
  assert.deepEqual(preserved.alternatives, []);
});

// server/test/live-pipeline.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { app } from '../src/index.js';
import { extractMentionedAmounts, crossCheckInstructionAmount } from '../src/llm/mandateParser.js';
import { buildUnprofiledTask } from '../src/mandates/v3.js';
import { getStatus } from '../src/status.js';
import { createDiscovery } from '../src/catalogue/discovery.js';
import { saveMandate } from '../src/db.js';
import { runInternals, setRunDependenciesForTests, startAgentRun, subscribeAgentRun } from '../src/agent/streaming.js';

const flags = { zero_width: false, html_comment: false, hidden_style: false };
const extraction = { category_label: 'mouse', claimed_price_cents: null, claims_bundle: false, addon_offers: [],
  directives_to_agent: false, asserts_authority_override: false, urgency_pressure: false, evidence: [], confidence: 0.99 };
const product = { product_id: 'stream-test-mouse', merchant_id: 'merchant-test', title: 'Wireless mouse', description: 'Optical mouse for daily use.',
  price_cents: 2500, currency: 'USD', category: 'mouse', is_bundle: false, domain: 'amazon.com', url: 'https://amazon.com/products/stream-test-mouse', first_party: true, source: 'channel3' };
function mandate(id) {
  return { mandate_id: id, kind: 'task', parent_profile_id: null, is_default: false, version: 1, status: 'active', owner_id: 'test',
    original_instruction: 'Wireless mouse under $30', item_query: 'wireless mouse', category_terms: ['mouse'], item_category: 'mouse',
    max_unit_price_cents: 3000, max_total_cents: 3000, quantity_max: 1, currency: 'USD', allowed_merchant_ids: [],
    allowed_domains: [], allow_bundles: false, allow_addons: false, require_first_party: false,
    expires_at: new Date(Date.now() + 60_000).toISOString(), confirmed_at: new Date().toISOString(), confirmed_by: 'user' };
}
async function listeningServer(t) {
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
async function collectEvents(url) {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  const reader = response.body.getReader(); let buffer = ''; const events = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += new TextDecoder().decode(value);
    const frames = buffer.split('\n\n'); buffer = frames.pop();
    for (const frame of frames) {
      const type = frame.match(/^event: (.+)$/m)?.[1];
      const data = frame.match(/^data: (.+)$/m)?.[1];
      if (type && data) events.push({ type, data: JSON.parse(data) });
    }
  }
  return events;
}

test('numeric cross-check retains a mismatched limit as pending confirmation and recognizes amount phrases', () => {
  const phrases = ['$50', '50 dollars', 'under 150', 'below 75.50', 'max 200', 'up to 1,200'];
  const expected = [5000, 5000, 15000, 7550, 20000, 120000];
  for (let index = 0; index < phrases.length; index += 1) {
    const values = extractMentionedAmounts(`Find a mouse ${phrases[index]}.`);
    assert.equal(values[0]?.cents, expected[index], phrases[index]);
    assert.equal(values[0]?.parsed_from, phrases[index]);
  }
  const checked = crossCheckInstructionAmount('Find a mouse under $25.', { max_total: '30.00' });
  assert.equal(checked.mismatch, true);
  assert.match(checked.notes[0], /We read \$30\.00 but your text mentions \$25\.00/);
  assert.equal(checked.parsed_from, null);
  const pending = buildUnprofiledTask({ item_query: 'mouse', category_terms: ['mouse'], max_total: checked.parsed.max_total,
    allow_bundles: false, allow_addons: false, require_first_party: null, allowed_domains: null }, { instruction: 'Find a mouse under $25.' });
  assert.equal(pending.status, 'pending_confirmation');
  const fromProfile = crossCheckInstructionAmount('Find a mouse from approved merchants.', { max_total: '30.00' }, { profile_max_total_cents: 4500 });
  assert.equal(fromProfile.parsed.max_total, '45.00');
  assert.equal(fromProfile.parsed_from, null);
  assert.match(fromProfile.notes[0], /confirmed profile ceiling/);
});

test('status contains only public configuration and has no secret values', async (t) => {
  const value = await getStatus({ settings: { LLM_PROVIDER: 'gemini', LLM_MODEL: 'test-model', LLM_MODE: 'replay',
    PAYPAL_CLIENT_ID: 'private-id', PAYPAL_CLIENT_SECRET: 'private-secret' }, ping: async () => { throw new Error('must not ping replay'); },
  discovery: () => ({ provider: 'curated', demo_listings: false, region: 'US' }) });
  assert.deepEqual(value.llm.reachable, null);
  assert.equal(value.paypal.configured, true);
  assert.equal(JSON.stringify(value).includes('private-secret'), false);
  const base = await listeningServer(t);
  const response = await fetch(`${base}/api/status`);
  assert.equal(response.status, 200);
  const publicValue = await response.json();
  assert.equal(publicValue.backend, 'ok');
  assert.equal(JSON.stringify(publicValue).includes('LLM_API_KEY'), false);
});

test('discovery includes demo listings only when requested and never silently substitutes them for live search', async () => {
  const demoProduct = { ...product, product_id: 'demo-result', domain: 'acme.localhost', url: 'http://acme.localhost:3000/demo-store/demo-result.html', title: 'Wireless mouse demo' };
  const liveRow = { id: 'live-1', title: 'Wireless mouse live', description: 'Wireless optical mouse', category: 'mouse',
    offers: [{ url: 'https://amazon.com/live-1', price: { amount: 20, currency: 'USD' }, first_party: true }] };
  const settings = { CHANNEL3_API_KEY: 'test-key', CHANNEL3_API_URL: 'https://channel3.test', CHANNEL3_REGION: 'US', INCLUDE_DEMO_LISTINGS: false };
  const live = createDiscovery({ settings, catalogueProducts: () => [demoProduct], merchants: () => [],
    fetchImpl: async () => ({ ok: true, json: async () => ({ data: [liveRow] }) }) });
  const withoutDemo = await live.searchProducts('wireless mouse', { limit: 12 });
  assert.equal(withoutDemo.length, 1);
  assert.equal(withoutDemo[0].source, 'channel3');
  settings.INCLUDE_DEMO_LISTINGS = true;
  const withDemo = await live.searchProducts('wireless mouse', { limit: 12 });
  assert.equal(withDemo.some((entry) => entry.source === 'curated' && entry.product_id === 'demo-result'), true);
  const failed = createDiscovery({ settings: { ...settings, INCLUDE_DEMO_LISTINGS: false }, catalogueProducts: () => [demoProduct], merchants: () => [],
    fetchImpl: async () => { throw new Error('Channel3 unavailable'); } });
  const fallback = await failed.searchProducts('wireless mouse');
  assert.deepEqual(fallback, []);
  assert.equal(failed.getDiscoveryStatus().provider, 'curated');
  const noKey = createDiscovery({ settings: { ...settings, CHANNEL3_API_KEY: '' }, catalogueProducts: () => [demoProduct] });
  assert.equal(noKey.getDiscoveryStatus().provider, 'curated');
});

test('SSE run events are ordered, late subscribers replay full history, timeout reviews candidates and call cap holds', async (t) => {
  const id = `test-run-${Date.now()}-${Math.random()}`;
  saveMandate(mandate(id));
  const restore = setRunDependenciesForTests({ searchProducts: async () => [{ ...product, discovery_provider: 'channel3' }],
    extractListing: async (_product, { beforeCall }) => beforeCall() ? { ok: true, extraction, flags } : { ok: false, error: 'budget', flags },
    naiveChooseWithStatus: async ({ beforeCall }) => { beforeCall(); return { choice: { items: [], reasoning: 'test' } }; },
    budgetMs: 1000, maxLlmCalls: 1 });
  t.after(restore);
  const base = await listeningServer(t);
  const response = await fetch(`${base}/api/agent/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mandate_id: id }) });
  assert.equal(response.status, 202);
  const { run_id } = await response.json();
  const eventsUrl = `${base}/api/agent/runs/${run_id}/events`;
  const events = await collectEvents(eventsUrl);
  assert.equal(events.at(-1).type, 'done');
  assert.deepEqual(events.map((entry) => entry.type).slice(0, 4), ['phase', 'candidates_found', 'phase', 'candidate']);
  assert.ok(['ALLOW', 'REVIEW'].includes(events.find((entry) => entry.type === 'candidate').data.decision));
  assert.ok(events.at(-1).data.llm_calls <= 1);
  const late = await collectEvents(eventsUrl);
  assert.deepEqual(late, events);
});

test('run budget emits REVIEW and SSE disconnect aborts pending work', async (t) => {
  const id = `budget-run-${Date.now()}-${Math.random()}`;
  saveMandate(mandate(id));
  const restore = setRunDependenciesForTests({ searchProducts: async () => [{ ...product, discovery_provider: 'curated' }],
    extractListing: async (_product, { signal, beforeCall }) => {
      beforeCall();
      return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ ok: false, error: 'timeout', flags }), { once: true }));
    }, naiveChooseWithStatus: async () => ({ choice: { items: [], reasoning: 'test' } }), budgetMs: 20, maxLlmCalls: 20 });
  t.after(restore);
  const base = await listeningServer(t);
  const response = await fetch(`${base}/api/agent/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mandate_id: id }) });
  const { run_id } = await response.json();
  const events = await collectEvents(`${base}/api/agent/runs/${run_id}/events`);
  assert.equal(events.find((entry) => entry.type === 'candidate').data.decision, 'REVIEW');

  const disconnectId = `disconnect-run-${Date.now()}-${Math.random()}`;
  saveMandate(mandate(disconnectId));
  const disconnectRestore = setRunDependenciesForTests({ searchProducts: async () => new Promise(() => {}), budgetMs: 1000 });
  t.after(disconnectRestore);
  const disconnectRun = startAgentRun(disconnectId);
  const responseStub = { writes: [], write(value) { this.writes.push(value); }, end() {} };
  const unsubscribe = subscribeAgentRun(disconnectRun, responseStub);
  unsubscribe();
  assert.equal(runInternals.runs.get(disconnectRun).cancel.signal.aborted, true);
});

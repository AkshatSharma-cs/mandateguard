// extension/test/api.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createApi } from '../lib/api.js';

test('profile setup uses V3 profile shapes and explicitly confirms the new profile', async () => {
  const calls = [];
  const api = createApi({ baseUrl: 'http://localhost:3000/', apiKey: 'test-key', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    const payload = url.endsWith('/profiles') && options.method === 'GET' ? { profiles: [] }
      : url.endsWith('/profiles') ? { profile: { mandate_id: 'profile-1', status: 'pending_confirmation' } }
        : url.endsWith('/confirm') ? { profile: { mandate_id: 'profile-1', status: 'active' } }
          : { profile: { mandate_id: 'profile-1', is_default: true } };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  assert.deepEqual(await api.getProfiles(), { profiles: [] });
  const limits = { max_total: '75.00', allow_bundles: false, allow_addons: false, require_first_party: false, allowed_domains: [] };
  const created = await api.createProfile(limits);
  assert.equal(created.profile.status, 'pending_confirmation');
  await api.confirmProfile(created.profile.mandate_id);
  await api.setDefaultProfile(created.profile.mandate_id);
  assert.deepEqual(calls.map(call => call.url), [
    'http://localhost:3000/v1/profiles', 'http://localhost:3000/v1/profiles',
    'http://localhost:3000/v1/profiles/profile-1/confirm', 'http://localhost:3000/v1/profiles/profile-1/default',
  ]);
  assert.equal(calls[1].options.headers['x-api-key'], 'test-key');
  assert.deepEqual(JSON.parse(calls[1].options.body), { limits });
});

test('normal page evaluation omits mandate_id and proposal creation uses evaluation_id', async () => {
  const calls = [];
  const api = createApi({ baseUrl: 'http://localhost:3000', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(url.endsWith('/evaluate')
      ? { evaluation_id: 'eval-1', decision: 'ALLOW' }
      : { proposal: { proposal_id: 'proposal-1' } }), { status: 200 });
  } });
  await api.evaluate({ title: 'Mouse' });
  await api.createProposal('eval-1');
  assert.deepEqual(JSON.parse(calls[0].options.body), { observation: { title: 'Mouse' } });
  assert.equal(calls[0].url, 'http://localhost:3000/v1/evaluate');
  assert.deepEqual(JSON.parse(calls[1].options.body), { evaluation_id: 'eval-1' });
  assert.equal(calls[1].url, 'http://localhost:3000/v1/proposals');
});

test('popup keeps the existing form selector IDs', async () => {
  const html = await readFile(new URL('../popup.html', import.meta.url), 'utf8');
  for (const selector of ['listing-form', 'mandate', 'url', 'title', 'price', 'description', 'submit', 'result', 'error']) {
    assert.match(html, new RegExp(`id=["']${selector}["']`), `missing #${selector}`);
  }
});

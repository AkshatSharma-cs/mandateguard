// server/test/extractor.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateExtraction } from '../src/llm/extractor.js';

const valid = {
  category_label: 'mouse', claimed_price_cents: 2499, claims_bundle: false,
  addon_offers: [], directives_to_agent: false, asserts_authority_override: false,
  urgency_pressure: false, evidence: ['2499 cents'], confidence: 0.9,
};

test('extractor schema rejects malformed and extra fields without network access', () => {
  assert.equal(validateExtraction(valid).success, true);
  assert.equal(validateExtraction({ ...valid, category_label: 'computer' }).success, false);
  assert.equal(validateExtraction({ ...valid, confidence: 1.1 }).success, false);
  assert.equal(validateExtraction({ ...valid, evidence: ['x'.repeat(161)] }).success, false);
  assert.equal(validateExtraction({ ...valid, unexpected: true }).success, false);
  assert.equal(validateExtraction({ ...valid, addon_offers: Array(6).fill({ name: 'x', price_cents: null }) }).success, false);
});

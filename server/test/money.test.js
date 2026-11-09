// server/test/money.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCents, fromCents } from '../src/money.js';

test('toCents accepts valid strings', () => {
  assert.equal(toCents('0.00'), 0);
  assert.equal(toCents('24.99'), 2499);
  assert.equal(toCents('100.10'), 10010);
});

test('toCents rejects invalid input', () => {
  for (const bad of ['24.9', '24,99', '-1.00', '', 24.99, null, undefined, '24.999', ' 24.99']) {
    assert.throws(() => toCents(bad), `should throw for ${JSON.stringify(bad)}`);
  }
});

test('fromCents formats integer cents', () => {
  assert.equal(fromCents(0), '0.00');
  assert.equal(fromCents(5), '0.05');
  assert.equal(fromCents(2499), '24.99');
  assert.equal(fromCents(10010), '100.10');
});

test('fromCents rejects non-integers and negatives', () => {
  for (const bad of [24.99, -1, '2499', NaN, null]) {
    assert.throws(() => fromCents(bad));
  }
});

test('round trip', () => {
  for (const s of ['0.00', '0.01', '24.99', '100.10', '99999.99']) {
    assert.equal(fromCents(toCents(s)), s);
  }
});
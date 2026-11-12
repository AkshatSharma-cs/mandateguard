import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

test('OpenAPI contract parses and documents sandbox simulations and receipts', () => {
  const filename = fileURLToPath(new URL('../../docs/openapi.yaml', import.meta.url));
  const document = parse(readFileSync(filename, 'utf8'));
  assert.equal(document.openapi, '3.1.0');
  assert.ok(document.paths['/evaluations/{id}/handoff']);
  assert.ok(document.paths['/proposals']);
  assert.ok(document.paths['/proposals/{id}/checkout']);
  assert.ok(document.paths['/proposals/{id}/capture']);
  assert.ok(document.paths['/proposals/{id}/receipt']);
  assert.ok(document.components.schemas.Receipt);
});

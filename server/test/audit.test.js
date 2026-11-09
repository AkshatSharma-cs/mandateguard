// server/test/audit.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createAudit } from '../src/audit.js';
import { initializeDatabase } from '../src/db.js';

test('audit events form a verifiable hash chain and tampering is detected', () => {
  const database = initializeDatabase(new Database(':memory:'));
  try {
    const audit = createAudit(database);
    const first = audit.append({ actor: 'buyer', event_type: 'MANDATE_CONFIRMED', mandate_id: 'm1', payload: { version: 1 } });
    const second = audit.append({ actor: 'agent', event_type: 'PROPOSAL_CREATED', mandate_id: 'm1', proposal_id: 'p1', payload: { total: 1234 } });
    assert.equal(first.prev_hash, '');
    assert.equal(second.prev_hash, first.hash);
    assert.deepEqual(audit.verifyChain(), { ok: true, broken_at: null });
    database.prepare("UPDATE audit_events SET payload = '{\"tampered\":true}' WHERE id = ?").run(first.id);
    assert.deepEqual(audit.verifyChain(), { ok: false, broken_at: first.id });
  } finally {
    database.close();
  }
});

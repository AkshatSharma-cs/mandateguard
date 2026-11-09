// server/src/db.js
import Database from 'better-sqlite3';
import config from './config.js';

export function initializeDatabase(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS mandates (
      mandate_id TEXT PRIMARY KEY, version INTEGER NOT NULL, status TEXT NOT NULL,
      json TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS proposals (
      proposal_id TEXT PRIMARY KEY, mandate_id TEXT NOT NULL, mandate_version INTEGER NOT NULL,
      status TEXT NOT NULL, source TEXT NOT NULL, paypal_order_id TEXT,
      json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, actor TEXT NOT NULL,
      event_type TEXT NOT NULL, mandate_id TEXT, proposal_id TEXT, payload TEXT NOT NULL,
      prev_hash TEXT NOT NULL, hash TEXT NOT NULL
    );
  `);
  return database;
}

export function createDatabase(path = config.DB_PATH) {
  return initializeDatabase(new Database(path));
}

export const db = createDatabase();

export function saveMandate(mandate) {
  const id = mandate.mandate_id;
  db.prepare(`INSERT INTO mandates(mandate_id, version, status, json, updated_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(mandate_id) DO UPDATE SET
    version=excluded.version, status=excluded.status, json=excluded.json, updated_at=excluded.updated_at`)
    .run(id, mandate.version, mandate.status, JSON.stringify(mandate), mandate.updated_at ?? new Date().toISOString());
  return mandate;
}

export function getMandate(mandateId) {
  const row = db.prepare('SELECT json FROM mandates WHERE mandate_id = ?').get(mandateId);
  return row ? JSON.parse(row.json) : null;
}

export function saveProposal(proposal) {
  db.prepare(`INSERT INTO proposals(proposal_id, mandate_id, mandate_version, status, source, paypal_order_id, json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(proposal_id) DO UPDATE SET
    mandate_id=excluded.mandate_id, mandate_version=excluded.mandate_version, status=excluded.status,
    source=excluded.source, paypal_order_id=excluded.paypal_order_id, json=excluded.json`)
    .run(proposal.proposal_id, proposal.mandate_id, proposal.mandate_version, proposal.status,
      proposal.source, proposal.paypal_order_id ?? null, JSON.stringify(proposal), proposal.created_at ?? new Date().toISOString());
  return proposal;
}

export function getProposal(proposalId) {
  const row = db.prepare('SELECT json FROM proposals WHERE proposal_id = ?').get(proposalId);
  return row ? JSON.parse(row.json) : null;
}

export function listCapturedSkus(mandateId) {
  const rows = db.prepare("SELECT json FROM proposals WHERE mandate_id = ? AND status = 'CAPTURED'").all(mandateId);
  return rows.flatMap(({ json }) => JSON.parse(json).items ?? []).map((item) => item.sku);
}

export function reserveCapture(proposalId) {
  return db.prepare("UPDATE proposals SET status = 'CAPTURE_PENDING' WHERE proposal_id = ? AND status = 'ORDER_CREATED'")
    .run(proposalId).changes === 1;
}

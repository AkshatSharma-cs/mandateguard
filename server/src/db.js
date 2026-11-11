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
    CREATE TABLE IF NOT EXISTS evaluations (
      evaluation_id TEXT PRIMARY KEY, mandate_id TEXT NOT NULL, decision TEXT NOT NULL,
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

export function normalizeMandate(mandate) {
  if (!mandate || typeof mandate !== 'object') return mandate;
  return {
    ...mandate,
    kind: mandate.kind ?? 'task',
    parent_profile_id: mandate.parent_profile_id ?? null,
    is_default: mandate.is_default ?? false,
    confirmed_by: mandate.confirmed_by ?? null,
    item_query: Object.hasOwn(mandate, 'item_query') ? mandate.item_query : (mandate.original_instruction || null),
    category_terms: Array.isArray(mandate.category_terms) ? mandate.category_terms : (mandate.item_category ? [mandate.item_category] : []),
  };
}

export function saveMandate(mandate, database = db) {
  const normalized = normalizeMandate(mandate);
  const id = normalized.mandate_id;
  database.prepare(`INSERT INTO mandates(mandate_id, version, status, json, updated_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(mandate_id) DO UPDATE SET
    version=excluded.version, status=excluded.status, json=excluded.json, updated_at=excluded.updated_at`)
    .run(id, normalized.version, normalized.status, JSON.stringify(normalized), normalized.updated_at ?? new Date().toISOString());
  return normalized;
}

export function getMandate(mandateId, database = db) {
  const row = database.prepare('SELECT json FROM mandates WHERE mandate_id = ?').get(mandateId);
  return row ? normalizeMandate(JSON.parse(row.json)) : null;
}

export function listMandates({ status } = {}, database = db) {
  const rows = status
    ? database.prepare('SELECT json FROM mandates WHERE status = ? ORDER BY updated_at DESC').all(status)
    : database.prepare('SELECT json FROM mandates ORDER BY updated_at DESC').all();
  return rows.map(({ json }) => normalizeMandate(JSON.parse(json)));
}

export function saveProposal(proposal, database = db) {
  database.prepare(`INSERT INTO proposals(proposal_id, mandate_id, mandate_version, status, source, paypal_order_id, json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(proposal_id) DO UPDATE SET
    mandate_id=excluded.mandate_id, mandate_version=excluded.mandate_version, status=excluded.status,
    source=excluded.source, paypal_order_id=excluded.paypal_order_id, json=excluded.json`)
    .run(proposal.proposal_id, proposal.mandate_id, proposal.mandate_version, proposal.status,
      proposal.source, proposal.paypal_order_id ?? null, JSON.stringify(proposal), proposal.created_at ?? new Date().toISOString());
  return proposal;
}

export function getProposal(proposalId, database = db) {
  const row = database.prepare('SELECT json FROM proposals WHERE proposal_id = ?').get(proposalId);
  return row ? JSON.parse(row.json) : null;
}

export function saveEvaluation(evaluation, database = db) {
  database.prepare(`INSERT INTO evaluations(evaluation_id, mandate_id, decision, json, created_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(evaluation_id) DO UPDATE SET
    mandate_id=excluded.mandate_id, decision=excluded.decision, json=excluded.json`)
    .run(evaluation.evaluation_id, evaluation.mandate_id, evaluation.decision,
      JSON.stringify(evaluation), evaluation.created_at ?? new Date().toISOString());
  return evaluation;
}

export function getEvaluation(evaluationId, database = db) {
  const row = database.prepare('SELECT json FROM evaluations WHERE evaluation_id = ?').get(evaluationId);
  return row ? JSON.parse(row.json) : null;
}

export function listCapturedSkus(mandateId, database = db) {
  const rows = database.prepare("SELECT json FROM proposals WHERE mandate_id = ? AND status = 'CAPTURED'").all(mandateId);
  return rows.flatMap(({ json }) => JSON.parse(json).items ?? []).map((item) => item.sku);
}

export function reserveCapture(proposalId) {
  return db.prepare("UPDATE proposals SET status = 'CAPTURE_PENDING' WHERE proposal_id = ? AND status = 'ORDER_CREATED'")
    .run(proposalId).changes === 1;
}

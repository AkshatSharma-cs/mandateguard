// server/src/audit.js
import { createHash } from 'node:crypto';
import { db as defaultDb } from './db.js';

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(prevHash, fields) {
  return createHash('sha256').update(prevHash + canonical(fields)).digest('hex');
}

export function createAudit(database = defaultDb) {
  const append = (event) => {
    const ts = event.ts ?? new Date().toISOString();
    const payload = JSON.stringify(event.payload ?? null);
    const row = database.prepare('SELECT id, hash FROM audit_events ORDER BY id DESC LIMIT 1').get();
    const id = (row?.id ?? 0) + 1;
    const prev_hash = row?.hash ?? '';
    const fields = { id, ts, actor: event.actor, event_type: event.event_type,
      mandate_id: event.mandate_id ?? null, proposal_id: event.proposal_id ?? null, payload, prev_hash };
    const hash = digest(prev_hash, fields);
    database.prepare(`INSERT INTO audit_events(id, ts, actor, event_type, mandate_id, proposal_id, payload, prev_hash, hash)
      VALUES (@id, @ts, @actor, @event_type, @mandate_id, @proposal_id, @payload, @prev_hash, @hash)`)
      .run({ ...fields, hash });
    return { ...fields, hash };
  };
  const list = ({ proposal_id, mandate_id } = {}) => {
    let sql = 'SELECT * FROM audit_events';
    const filters = [];
    const params = {};
    if (proposal_id !== undefined) { filters.push('proposal_id = @proposal_id'); params.proposal_id = proposal_id; }
    if (mandate_id !== undefined) { filters.push('mandate_id = @mandate_id'); params.mandate_id = mandate_id; }
    if (filters.length) sql += ` WHERE ${filters.join(' AND ')}`;
    return database.prepare(`${sql} ORDER BY id`).all(params).map((row) => ({ ...row, payload: JSON.parse(row.payload) }));
  };
  const verifyChain = () => {
    let previous = '';
    for (const row of database.prepare('SELECT * FROM audit_events ORDER BY id').iterate()) {
      const { hash, ...fields } = row;
      if (row.prev_hash !== previous || digest(previous, fields) !== hash) return { ok: false, broken_at: row.id };
      previous = hash;
    }
    return { ok: true, broken_at: null };
  };
  return Object.freeze({ append, list, verifyChain });
}

const audit = createAudit();
export const append = audit.append;
export const list = audit.list;
export const verifyChain = audit.verifyChain;

// server/src/routes/mandates.js
import { Router } from 'express';
import { z } from 'zod';
import { getMandate, saveMandate } from '../db.js';
import { append } from '../audit.js';
import { parseInstruction, buildMandate } from '../llm/mandateParser.js';
import { getMerchants } from '../catalogue/index.js';

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function validate(schema, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const error = new Error('Invalid request input');
    error.status = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  return parsed.data;
}
const idParams = z.object({ id: z.string().min(1).max(128) }).strict();

const router = Router();
router.post('/parse', asyncHandler(async (req, res) => {
  const body = validate(z.object({ instruction: z.string().trim().min(1).max(10000) }).strict(), req.body);
  let built;
  let parserNotes;
  try {
    const parsedResult = await parseInstruction(body.instruction);
    parserNotes = parsedResult.notes;
    built = buildMandate(parsedResult.parsed, {
      merchants: getMerchants(), now: new Date(), owner_id: 'local-user', instruction: body.instruction,
    });
  } catch (cause) {
    const error = new Error(cause?.code === 'PARSE_ERROR' ? cause.message : 'Mandate parsing failed');
    error.status = cause?.code === 'PARSE_ERROR' ? 422 : 503;
    error.code = cause?.code === 'PARSE_ERROR' ? 'INVALID_INSTRUCTION' : 'LLM_UNAVAILABLE';
    throw error;
  }
  const { mandate, notes } = built;
  saveMandate(mandate);
  append({ actor: 'user', event_type: 'MANDATE_PROPOSED', mandate_id: mandate.mandate_id, payload: { version: mandate.version } });
  return res.status(201).json({ mandate, notes: [...parserNotes, ...notes] });
}));
router.post('/:id/confirm', asyncHandler(async (req, res) => {
  const { id } = validate(idParams, req.params);
  validate(z.object({}).strict(), req.body ?? {});
  const mandate = getMandate(id);
  if (!mandate) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Mandate not found' } });
  if (mandate.status !== 'pending_confirmation') return res.status(409).json({ error: { code: 'INVALID_MANDATE_STATE', message: 'Only a pending mandate can be confirmed' } });
  const active = { ...mandate, status: 'active', confirmed_at: new Date().toISOString() };
  saveMandate(active);
  append({ actor: 'user', event_type: 'MANDATE_CONFIRMED', mandate_id: id, payload: { version: active.version } });
  return res.json(active);
}));
router.post('/:id/revoke', asyncHandler(async (req, res) => {
  const { id } = validate(idParams, req.params);
  validate(z.object({}).strict(), req.body ?? {});
  const mandate = getMandate(id);
  if (!mandate) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Mandate not found' } });
  if (mandate.status === 'revoked') return res.status(409).json({ error: { code: 'INVALID_MANDATE_STATE', message: 'Mandate is already revoked' } });
  const revoked = { ...mandate, status: 'revoked', version: mandate.status === 'active' ? mandate.version + 1 : mandate.version };
  saveMandate(revoked);
  append({ actor: 'user', event_type: 'MANDATE_REVOKED', mandate_id: id, payload: { version: revoked.version } });
  return res.json(revoked);
}));
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = validate(idParams, req.params);
  const mandate = getMandate(id);
  if (!mandate) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Mandate not found' } });
  return res.json(mandate);
}));
export default router;

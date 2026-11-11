// server/src/routes/agent.js
import { Router } from 'express';
import { asyncHandler } from './mandates.js';
import { z } from 'zod';
import { getMandate } from '../db.js';
import { getMerchants, getProducts } from '../catalogue/index.js';
import { startAgentRun, getAgentRun, subscribeAgentRun } from '../agent/streaming.js';

const router = Router();
export const catalogueRouter = Router();
function validate(schema, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const error = new Error('Invalid request input'); error.status = 400; error.code = 'VALIDATION_ERROR'; throw error;
  }
  return parsed.data;
}
const idParams = z.object({}).strict();

router.post('/run', asyncHandler(async (req, res) => {
  const body = validate(z.object({ mandate_id: z.string().min(1).max(128) }).strict(), req.body);
  const mandate = getMandate(body.mandate_id);
  if (!mandate) return res.status(409).json({ error: { code: 'MANDATE_NOT_FOUND', message: 'Mandate does not exist' } });
  if (mandate.status !== 'active') return res.status(409).json({ error: { code: 'MANDATE_INACTIVE', message: 'Mandate must be active' } });
  return res.status(202).json({ run_id: startAgentRun(mandate.mandate_id) });
}));
router.get('/runs/:id/events', asyncHandler(async (req, res) => {
  const parsed = z.object({ id: z.string().uuid() }).strict().safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid run id.' } });
  if (!getAgentRun(parsed.data.id)) return res.status(404).json({ error: { code: 'RUN_NOT_FOUND', message: 'Agent run was not found.' } });
  res.status(200); res.set({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.flushHeaders?.();
  const unsubscribe = subscribeAgentRun(parsed.data.id, res);
  if (!unsubscribe) return res.end();
  res.on('close', unsubscribe);
}));
router.get('/runs/:id', asyncHandler(async (req, res) => {
  const parsed = z.object({ id: z.string().uuid() }).strict().safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid run id.' } });
  const snapshot = getAgentRun(parsed.data.id);
  if (!snapshot) return res.status(404).json({ error: { code: 'RUN_NOT_FOUND', message: 'Agent run was not found.' } });
  return res.json(snapshot);
}));
catalogueRouter.get('/', asyncHandler(async (req, res) => {
  validate(idParams, req.params);
  validate(z.object({}).strict(), req.query);
  return res.json({ merchants: getMerchants(), products: getProducts() });
}));
export default router;

// server/src/routes/agent.js
import { Router } from 'express';
import { asyncHandler } from './mandates.js';
import { z } from 'zod';
import { getMandate } from '../db.js';
import { getMerchants, getProducts } from '../catalogue/index.js';
import { runNaive, runProtected } from '../agent/run.js';

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
  const body = validate(z.object({ mandate_id: z.string().min(1).max(128), mode: z.enum(['naive', 'protected']) }).strict(), req.body);
  const mandate = getMandate(body.mandate_id);
  if (!mandate) return res.status(409).json({ error: { code: 'MANDATE_NOT_FOUND', message: 'Mandate does not exist' } });
  if (mandate.status !== 'active') return res.status(409).json({ error: { code: 'MANDATE_INACTIVE', message: 'Mandate must be active' } });
  const result = body.mode === 'protected'
    ? await runProtected({ mandate })
    : await runNaive({ mandate });
  return res.json(result);
}));
catalogueRouter.get('/', asyncHandler(async (req, res) => {
  validate(idParams, req.params);
  validate(z.object({}).strict(), req.query);
  return res.json({ merchants: getMerchants(), products: getProducts() });
}));
export default router;

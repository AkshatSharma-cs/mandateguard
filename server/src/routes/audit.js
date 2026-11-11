// server/src/routes/audit.js
import { Router } from 'express';
import { asyncHandler } from './mandates.js';
import { z } from 'zod';
import { list, verifyChain } from '../audit.js';

const router = Router();
router.get('/', asyncHandler(async (req, res) => {
  const querySchema = z.object({ proposal_id: z.string().min(1).max(128).optional(), mandate_id: z.string().min(1).max(128).optional() }).strict();
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    const error = new Error('Invalid request input'); error.status = 400; error.code = 'VALIDATION_ERROR'; throw error;
  }
  return res.json({ events: list(parsed.data), chain_ok: verifyChain().ok });
}));
export default router;

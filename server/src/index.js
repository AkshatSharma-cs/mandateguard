// server/src/index.js
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from './config.js';
import mandatesRouter, { asyncHandler } from './routes/mandates.js';
import agentRouter, { catalogueRouter } from './routes/agent.js';
import paymentsRouter from './routes/payments.js';
import auditRouter from './routes/audit.js';
import companionRouter from './routes/companion.js';
import v1Router from './routes/v1.js';
import { getStatus } from './status.js';
import testsRouter from './routes/tests.js';

export { asyncHandler };

const app = express();
const publicDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');

app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  const origin = req.get('origin') ?? '';
  if (/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  return next();
});
app.get('/', (_req, res) => res.redirect('/app/'));
app.use(express.static(publicDirectory));
app.get('/api/health', asyncHandler(async (_req, res) => res.json({ status: 'ok' })));
app.get('/api/status', asyncHandler(async (_req, res) => res.json(await getStatus())));
app.use('/api/tests', testsRouter);
app.use('/api/v1', v1Router);
app.use('/api/mandates', mandatesRouter);
app.use('/api/agent', agentRouter);
app.use('/api/catalogue', catalogueRouter);
app.use('/api', paymentsRouter);
app.use('/api/audit', auditRouter);
app.use('/api/companion', companionRouter);
app.use('/v1', v1Router);
app.use('/', v1Router);
app.use((_req, _res, next) => {
  const error = new Error('Not found');
  error.status = 404;
  error.code = 'NOT_FOUND';
  next(error);
});
const safePublicErrorCodes = new Set(['LLM_UNAVAILABLE']);
app.use((error, _req, res, _next) => {
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
  const code = typeof error.code === 'string' ? error.code : (status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR');
  const message = status >= 500 && !safePublicErrorCodes.has(code)
    ? 'An unexpected error occurred'
    : (typeof error.message === 'string' ? error.message : 'The request could not be completed.');
  res.status(status).json({ error: { code, message } });
});

export { app };
export default app;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  app.listen(config.PORT, () => console.log(`MandateGuard listening on port ${config.PORT}`));
}

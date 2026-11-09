// server/src/index.js
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from './config.js';
import mandatesRouter, { asyncHandler } from './routes/mandates.js';
import agentRouter, { catalogueRouter } from './routes/agent.js';
import paymentsRouter from './routes/payments.js';
import auditRouter from './routes/audit.js';

export { asyncHandler };

const app = express();
const publicDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');

app.use(express.json({ limit: '100kb' }));
app.use(express.static(publicDirectory));
app.get('/api/health', asyncHandler(async (_req, res) => res.json({ status: 'ok' })));
app.use('/api/mandates', mandatesRouter);
app.use('/api/agent', agentRouter);
app.use('/api/catalogue', catalogueRouter);
app.use('/api', paymentsRouter);
app.use('/api/audit', auditRouter);
app.use((_req, _res, next) => {
  const error = new Error('Not found');
  error.status = 404;
  error.code = 'NOT_FOUND';
  next(error);
});
app.use((error, _req, res, _next) => {
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
  const code = typeof error.code === 'string' ? error.code : (status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR');
  const message = status >= 500 ? 'An unexpected error occurred' : error.message;
  res.status(status).json({ error: { code, message } });
});

export { app };
export default app;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  app.listen(config.PORT, () => console.log(`MandateGuard listening on port ${config.PORT}`));
}

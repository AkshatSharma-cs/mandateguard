import { Router } from 'express';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { asyncHandler } from './mandates.js';

const router = Router();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../');
const resultsPath = path.join(root, 'attacks', 'results.json');
let activeRun;

async function readResults() {
  return JSON.parse(await readFile(resultsPath, 'utf8'));
}

router.get('/results', asyncHandler(async (_req, res) => {
  try { res.json(await readResults()); }
  catch (error) {
    if (error?.code === 'ENOENT') return res.status(404).json({ error: { code: 'RESULTS_NOT_FOUND', message: 'Security test results are not available.' } });
    throw error;
  }
}));

router.post('/run', asyncHandler(async (req, res) => {
  const parsed = z.object({}).strict().safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'This request does not accept fields.' } });
  if (!activeRun) {
    activeRun = new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(root, 'attacks', 'run.js')], { cwd: root, env: process.env, stdio: 'ignore', windowsHide: true });
      child.once('error', reject);
      child.once('exit', (code) => code === 0 ? resolve() : reject(new Error('Test runner failed')));
    }).finally(() => { activeRun = undefined; });
  }
  try {
    await activeRun;
    return res.json({ results: await readResults() });
  } catch {
    return res.status(500).json({ error: { code: 'TEST_RUN_FAILED', message: 'The security test run failed.' } });
  }
}));

export default router;

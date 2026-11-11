// server/src/status.js
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from './config.js';
import { pingLLM } from './llm/provider.js';
import { getDiscoveryStatus } from './catalogue/discovery.js';

const resultsFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../attacks/results.json');
export async function getStatus({ settings = config, ping = pingLLM, discovery = getDiscoveryStatus } = {}) {
  let last_run = null;
  try {
    const body = JSON.parse(await readFile(resultsFile, 'utf8'));
    last_run = body.settings?.date ?? body.generated_at ?? (await stat(resultsFile)).mtime.toISOString();
    if (!Number.isFinite(Date.parse(last_run))) last_run = (await stat(resultsFile)).mtime.toISOString();
  } catch { /* Attack results have not been generated. */ }
  const reachable = settings.LLM_MODE === 'replay' ? null : await ping();
  return {
    backend: 'ok',
    llm: { provider: settings.LLM_PROVIDER, model: settings.LLM_MODEL, mode: settings.LLM_MODE, reachable },
    discovery: discovery(),
    paypal: { env: 'sandbox', configured: Boolean(settings.PAYPAL_CLIENT_ID && settings.PAYPAL_CLIENT_SECRET) },
    tests: { last_run },
  };
}

// server/src/llm/provider.js
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../config.js';

const fixtureDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/llm');

export class ReplayMiss extends Error {
  constructor(sampleId) {
    super(`No recorded LLM response for sample ${sampleId || '(default)'}`);
    this.name = 'ReplayMiss';
    this.code = 'REPLAY_MISS';
  }
}

function fixtureId(provider, model, system, user, temperature, sample_id) {
  return createHash('sha256').update([provider, model, system, user, String(temperature), sample_id].join('')).digest('hex');
}

function parseJson(text) {
  if (typeof text !== 'string') throw new Error('LLM response did not contain JSON text');
  const unfenced = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('LLM response did not contain a JSON object');
  const value = JSON.parse(unfenced.slice(start, end + 1));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('LLM response must be a JSON object');
  return value;
}

async function requestGemini({ system, user, temperature, model, signal }) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': config.LLM_API_KEY },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] },], generationConfig: { temperature, responseMimeType: 'application/json' } }),
  });
  if (!response.ok) {
    const error = new Error(`Gemini request failed with HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const body = await response.json();
  return parseJson(body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join(''));
}

async function requestAnthropic({ system, user, temperature, model, signal }) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'x-api-key': config.LLM_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 2048, temperature, system: `${system}\n\nReturn only one valid JSON object with no markdown fences.`, messages: [{ role: 'user', content: user }] }),
  });
  if (!response.ok) {
    const error = new Error(`Anthropic request failed with HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const body = await response.json();
  return parseJson(body.content?.filter((part) => part.type === 'text').map((part) => part.text).join(''));
}

export async function llmJson({ system, user, temperature = 0, sample_id = '', signal }) {
  const provider = config.LLM_PROVIDER;
  const model = config.LLM_MODEL;
  const id = fixtureId(provider, model, system, user, temperature, sample_id);
  const fixture = path.join(fixtureDirectory, `${id}.json`);
  if (config.LLM_MODE === 'replay') {
    try { return parseJson(await readFile(fixture, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') throw new ReplayMiss(sample_id);
      throw error;
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const args = { system, user, temperature, model, signal: controller.signal };
    const request = provider === 'gemini' ? requestGemini : requestAnthropic;
    let result;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        result = await request(args);
        break;
      } catch (error) {
        const transient = [429, 500, 502, 503, 504].includes(error?.status);
        if (attempt > 0 || !transient || controller.signal.aborted) throw error;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    if (config.LLM_MODE === 'record') {
      await mkdir(fixtureDirectory, { recursive: true });
      await writeFile(fixture, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' }).catch(async (error) => {
        if (error.code !== 'EEXIST') throw error;
        // Keep an existing deterministic recording unchanged.
      });
    }
    return result;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

let pingCache = { at: 0, value: null, promise: null };
export async function pingLLM() {
  if (config.LLM_MODE === 'replay') return null;
  if (pingCache.value !== null && Date.now() - pingCache.at < 60_000) return pingCache.value;
  if (pingCache.promise) return pingCache.promise;
  pingCache.promise = llmJson({ system: 'Return only JSON: {"ok":true}.', user: 'ping', temperature: 0, sample_id: 'status-ping' })
    .then((value) => value?.ok === true)
    .catch(() => false)
    .then((value) => { pingCache = { at: Date.now(), value, promise: null }; return value; });
  return pingCache.promise;
}

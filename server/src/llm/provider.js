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

async function requestGemini({ system, user, temperature, model, apiKey, signal }) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
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

async function requestAnthropic({ system, user, temperature, model, apiKey, signal }) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
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
  const providers = [{ name: config.LLM_PROVIDER, model: config.LLM_MODEL, apiKey: config.LLM_API_KEY }];
  if (config.LLM_FALLBACK_PROVIDER && config.LLM_FALLBACK_MODEL
    && (config.LLM_MODE === 'replay' || config.LLM_FALLBACK_API_KEY)) {
    providers.push({ name: config.LLM_FALLBACK_PROVIDER, model: config.LLM_FALLBACK_MODEL, apiKey: config.LLM_FALLBACK_API_KEY });
  }
  if (config.LLM_MODE === 'replay') {
    for (const provider of providers) {
      const fixture = path.join(fixtureDirectory, `${fixtureId(provider.name, provider.model, system, user, temperature, sample_id)}.json`);
      try { return parseJson(await readFile(fixture, 'utf8')); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    throw new ReplayMiss(sample_id);
  }

  let result;
  let selectedProvider;
  let lastError;
  for (let providerIndex = 0; providerIndex < providers.length; providerIndex += 1) {
    const provider = providers[providerIndex];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('LLM request timed out')), 30_000);
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    try {
      const request = provider.name === 'gemini' ? requestGemini : requestAnthropic;
      const args = { system, user, temperature, model: provider.model, apiKey: provider.apiKey, signal: controller.signal };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          result = await request(args);
          selectedProvider = provider;
          break;
        } catch (error) {
          lastError = error;
          if (signal?.aborted) throw error;
          const transient = [429, 500, 502, 503, 504].includes(error?.status);
          if (attempt > 0 || !transient || controller.signal.aborted) throw error;
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
      if (selectedProvider) break;
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
      if (providerIndex < providers.length - 1) {
        // Log provider identifiers and status only. Never log credentials or prompts.
        const status = Number.isInteger(error?.status) ? ` HTTP ${error.status}` : '';
        console.warn(`[llm] ${provider.name} request failed${status}; trying configured fallback provider`);
      }
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }
  if (!selectedProvider) throw lastError ?? new Error('All configured LLM providers failed');
  if (selectedProvider !== providers[0]) console.info(`[llm] fallback provider ${selectedProvider.name} succeeded`);
  if (config.LLM_MODE === 'record') {
    const fixture = path.join(fixtureDirectory, `${fixtureId(selectedProvider.name, selectedProvider.model, system, user, temperature, sample_id)}.json`);
    await mkdir(fixtureDirectory, { recursive: true });
    await writeFile(fixture, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' }).catch(async (error) => {
      if (error.code !== 'EEXIST') throw error;
      // Keep an existing deterministic recording unchanged.
    });
  }
  return result;
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

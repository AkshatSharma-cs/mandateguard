// web/src/api/client.ts
import type { AuditResult, CaptureResult, Catalogue, EvaluateResult, Mandate, Profile, ProfileLimits, ProductObservation, PublicConfig, RunResult, TestResults } from '../types';
import { ApiError } from './error';
import { mock } from './mock';
import snapshotData from './results.snapshot.json';

const API_BASE = '/api';
const useMock = import.meta.env.VITE_USE_MOCK === 'true';
let publicConfigPromise: Promise<PublicConfig> | undefined;
const liveRuns = new Map<string, Promise<Record<string, unknown>>>();
type AgentStreamEvent = { type: string; data: Record<string, unknown> };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', 'The API could not be reached. Check the server connection and try again.', 0);
  }
  let body: unknown;
  try { body = await response.json(); } catch { body = undefined; }
  if (!response.ok) {
    const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const detail = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : {};
    throw new ApiError(typeof detail.code === 'string' ? detail.code : `HTTP_${response.status}`, typeof detail.message === 'string' ? detail.message : `The request failed (${response.status}).`, response.status, body);
  }
  if (body === undefined) throw new ApiError('INVALID_RESPONSE', 'The API returned an unreadable response.', response.status);
  return body as T;
}

function normalizeCaptureResult(value: CaptureResult): CaptureResult {
  const capture = value.capture as (CaptureResult['capture'] & { amount?: unknown }) | null;
  if (!capture || typeof capture.amount === 'string') return value;
  const amount = capture.amount && typeof capture.amount === 'object'
    ? (capture.amount as { value?: unknown }).value
    : capture.amount;
  return { ...value, capture: { ...capture, amount: typeof amount === 'string' ? amount : '' } };
}

async function waitForAgentRun(runId: string, onEvent?: (event: AgentStreamEvent) => void): Promise<Record<string, unknown>> {
  const snapshotPath = `${API_BASE}/agent/runs/${encodeURIComponent(runId)}`;
  const snapshot = () => request<Record<string, unknown>>(snapshotPath);
  const seen = new Set<number>();
  const emitSnapshotEvents = (value: Record<string, unknown>) => {
    const events = Array.isArray(value.events) ? value.events as { id: number; type: string; data: Record<string, unknown> }[] : [];
    for (const event of events) if (!seen.has(event.id)) { seen.add(event.id); onEvent?.({ type: event.type, data: event.data }); }
  };
  if (typeof EventSource === 'undefined') {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const result = await snapshot();
      emitSnapshotEvents(result);
      if (result.status === 'done' || result.status === 'error') return result;
      await new Promise(resolve => window.setTimeout(resolve, 500));
    }
    throw new ApiError('RUN_TIMEOUT', 'The agent run did not finish in time.', 408);
  }
  return new Promise((resolve, reject) => {
    const source = new EventSource(`${API_BASE}/agent/runs/${encodeURIComponent(runId)}/events`);
    let settled = false;
    let polling = false;
    let pollTimer: number;
    let timeoutTimer: number;
    const finish = (value: Record<string, unknown>) => {
      if (settled) return;
      settled = true; source.close(); window.clearInterval(pollTimer); window.clearTimeout(timeoutTimer); resolve(value);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true; source.close(); window.clearInterval(pollTimer); window.clearTimeout(timeoutTimer); reject(error);
    };
    const poll = async () => {
      if (settled || polling) return;
      polling = true;
      try {
        const value = await snapshot();
        emitSnapshotEvents(value);
        if (value.status === 'done') finish(value);
        else if (value.status === 'error') fail(new ApiError(String((value.error as { code?: string } | undefined)?.code ?? 'RUN_FAILED'), String((value.error as { message?: string } | undefined)?.message ?? 'The agent run failed.'), 500));
      } catch (error) { if (error instanceof ApiError && error.status === 404) fail(error); }
      finally { polling = false; }
    };
    source.addEventListener('done', () => { void poll(); });
    source.addEventListener('error', () => { void poll(); });
    for (const type of ['phase', 'candidates_found', 'candidate', 'naive', 'proposal', 'compare_links', 'done', 'error']) {
      source.addEventListener(type, (event) => {
        try {
          const message = event as MessageEvent<string>;
          const eventId = Number(message.lastEventId);
          if (Number.isSafeInteger(eventId) && seen.has(eventId)) return;
          if (Number.isSafeInteger(eventId)) seen.add(eventId);
          onEvent?.({ type, data: JSON.parse(message.data) as Record<string, unknown> });
        } catch { /* Polling the run snapshot remains the fallback for malformed event frames. */ }
      });
    }
    source.onerror = () => { void poll(); };
    pollTimer = window.setInterval(() => { void poll(); }, 1000);
    timeoutTimer = window.setTimeout(() => { if (!settled) fail(new ApiError('RUN_TIMEOUT', 'The agent run did not finish in time.', 408)); }, 45_000);
  });
}

async function runLiveAgent(mandateId: string, onEvent?: (event: AgentStreamEvent) => void): Promise<Record<string, unknown>> {
  let pending = liveRuns.get(mandateId);
  if (!pending) {
    pending = (async () => {
      const started = await request<{ run_id: string }>(`${API_BASE}/agent/run`, { method: 'POST', body: JSON.stringify({ mandate_id: mandateId }) });
      return waitForAgentRun(started.run_id, event => onEvent?.({ ...event, data: { ...event.data, run_id: started.run_id } }));
    })();
    liveRuns.set(mandateId, pending);
    void pending.finally(() => window.setTimeout(() => { if (liveRuns.get(mandateId) === pending) liveRuns.delete(mandateId); }, 0)).catch(() => undefined);
  }
  return pending;
}

export const api = {
  getProfiles() {
    return useMock ? mock.getProfiles() : request<{ profiles: Profile[] }>('/api/v1/profiles');
  },
  createProfile(payload: { limits: ProfileLimits } | { instruction: string }) {
    return useMock ? mock.createProfile(payload) : request<{ profile: Profile }>('/api/v1/profiles', { method: 'POST', body: JSON.stringify(payload) });
  },
  confirmProfile(id: string) {
    return useMock ? mock.confirmProfile(id) : request<{ profile: Profile }>(`/api/v1/profiles/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: '{}' });
  },
  setDefaultProfile(id: string) {
    return useMock ? mock.setDefaultProfile(id) : request<{ profile: Profile }>(`/api/v1/profiles/${encodeURIComponent(id)}/default`, { method: 'POST', body: '{}' });
  },
  createTask(instruction: string, profile_id?: string) {
    return useMock ? mock.createTask(instruction, profile_id) : request<{ mandate: Mandate; notes: string[]; within_profile: boolean | null; exceeded: string[] }>('/api/v1/mandates', { method: 'POST', body: JSON.stringify({ instruction, ...(profile_id ? { profile_id } : {}) }) });
  },
  evaluate(observation: ProductObservation, options: { mandate_id?: string; profile_id?: string; alternatives?: boolean } = {}) {
    return useMock ? mock.evaluate(observation, options) : request<EvaluateResult>('/api/v1/evaluate', { method: 'POST', body: JSON.stringify({ ...options, observation }) });
  },
  useAlternative(evaluationId: string) {
    return useMock ? mock.useAlternative(evaluationId) : request<{ proposal: import('../types').Proposal }>('/api/v1/proposals', { method: 'POST', body: JSON.stringify({ evaluation_id: evaluationId }) });
  },
  parseMandate(instruction: string) {
    return useMock ? mock.parseMandate(instruction) : request<{ mandate: Mandate; notes: string[] }>(`${API_BASE}/mandates/parse`, { method: 'POST', body: JSON.stringify({ instruction }) });
  },
  confirmMandate(id: string) {
    return useMock ? mock.confirmMandate(id) : request<{ mandate: Mandate }>(`/api/v1/mandates/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: '{}' }).then(result => result.mandate);
  },
  revokeMandate(id: string) {
    return useMock ? mock.revokeMandate(id) : request<Mandate>(`${API_BASE}/mandates/${encodeURIComponent(id)}/revoke`, { method: 'POST', body: '{}' });
  },
  getCatalogue() {
    return useMock ? mock.getCatalogue() : request<Catalogue>(`${API_BASE}/catalogue`);
  },
  runAgent(mandate_id: string, mode: 'naive' | 'protected') {
    if (useMock) return mock.runAgent(mandate_id, mode);
    return runLiveAgent(mandate_id).then((snapshot) => {
      const data = snapshot as { run_id: string; candidates?: RunResult['candidates']; naive_candidates?: RunResult['candidates']; proposal?: RunResult['proposal']; compare_links?: RunResult['compare_links'];
        naive?: { proposal?: RunResult['proposal']; reasoning?: string; would_have_been?: RunResult['would_have_been'] }; allowed_alternative_ids?: string[] };
      return mode === 'protected'
        ? { run_id: data.run_id, mode, enforced: true, candidates: data.candidates ?? [], proposal: data.proposal ?? null, naive_reasoning: null, allowed_alternative_ids: data.allowed_alternative_ids ?? [], compare_links: data.compare_links ?? [] }
        : { run_id: data.run_id, mode, enforced: false, candidates: data.naive_candidates ?? [], proposal: data.naive?.proposal ?? null,
          naive_reasoning: data.naive?.reasoning ?? null, would_have_been: data.naive?.would_have_been };
    });
  },
  async runBothAgent(mandate_id: string, onEvent?: (event: AgentStreamEvent) => void) {
    if (useMock) {
      const [naive, protectedRun] = await Promise.all([mock.runAgent(mandate_id, 'naive'), mock.runAgent(mandate_id, 'protected')]);
      return { naive, protected: protectedRun };
    }
    const snapshot = await runLiveAgent(mandate_id, onEvent) as { run_id: string; candidates?: RunResult['candidates']; naive_candidates?: RunResult['candidates']; compare_links?: RunResult['compare_links']; discovery_provider?: RunResult['discovery_provider']; listing_count?: number;
      proposal?: RunResult['proposal']; naive?: { proposal?: RunResult['proposal']; reasoning?: string; would_have_been?: RunResult['would_have_been'] }; allowed_alternative_ids?: string[] };
    return {
      protected: { run_id: snapshot.run_id, mode: 'protected' as const, enforced: true, candidates: snapshot.candidates ?? [], proposal: snapshot.proposal ?? null, naive_reasoning: null, allowed_alternative_ids: snapshot.allowed_alternative_ids ?? [], compare_links: snapshot.compare_links ?? [], discovery_provider: snapshot.discovery_provider, listing_count: snapshot.listing_count },
      naive: { run_id: snapshot.run_id, mode: 'naive' as const, enforced: false, candidates: snapshot.naive_candidates ?? [], proposal: snapshot.naive?.proposal ?? null,
        naive_reasoning: snapshot.naive?.reasoning ?? null, would_have_been: snapshot.naive?.would_have_been },
    };
  },
  createCheckout(proposalId: string) {
    return useMock ? mock.createCheckout(proposalId) : request<{ paypal_order_id: string }>(`${API_BASE}/proposals/${encodeURIComponent(proposalId)}/checkout`, { method: 'POST', body: '{}' });
  },
  async capture(proposalId: string, orderId: string): Promise<CaptureResult> {
    if (useMock) return mock.capture(proposalId, orderId);
    try {
      return normalizeCaptureResult(await request<CaptureResult>(`${API_BASE}/proposals/${encodeURIComponent(proposalId)}/capture`, { method: 'POST', body: JSON.stringify({ order_id: orderId }) }));
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.payload && typeof error.payload === 'object' && Array.isArray((error.payload as Record<string, unknown>).checks)) {
        const data = error.payload as Record<string, unknown>;
        return normalizeCaptureResult({ status: typeof data.status === 'string' ? data.status : 'REFUSED', checks: data.checks as CaptureResult['checks'], capture: null });
      }
      throw error;
    }
  },
  getAudit(filters: { mandate_id?: string; proposal_id?: string } = {}) {
    if (useMock) return mock.getAudit(filters);
    const query = new URLSearchParams();
    if (filters.mandate_id) query.set('mandate_id', filters.mandate_id);
    if (filters.proposal_id) query.set('proposal_id', filters.proposal_id);
    return request<AuditResult>(`${API_BASE}/audit${query.size ? `?${query}` : ''}`);
  },
  getPublicConfig() {
    publicConfigPromise ??= (useMock ? mock.getPublicConfig() : request<PublicConfig>(`${API_BASE}/config/public`)).catch(error => {
      publicConfigPromise = undefined;
      throw error;
    });
    return publicConfigPromise;
  },
  getTestResults() {
    if (useMock) return mock.getTestResults();
    return (async () => {
      for (const path of ['/api/tests/results', '/attacks/results.json']) {
        try {
          const result = await request<TestResults>(path);
          return { ...result, source: 'live' as const };
        } catch { /* Use the next configured results source. */ }
      }
      return { ...snapshotData as TestResults, source: 'snapshot' as const };
    })();
  },
  async runTests() {
    if (useMock) throw new ApiError('BACKEND_REQUIRED', 'Needs the backend', 0);
    return request<{ results?: TestResults }>('/api/tests/run', { method: 'POST', body: '{}' });
  },
};

export const isMockMode = useMock;

export const parseMandate = api.parseMandate;
export const confirmMandate = api.confirmMandate;
export const revokeMandate = api.revokeMandate;
export const getCatalogue = api.getCatalogue;
export const runAgent = api.runAgent;
export const createCheckout = api.createCheckout;
export const capture = api.capture;
export const getAudit = api.getAudit;
export const getPublicConfig = api.getPublicConfig;
export const getTestResults = api.getTestResults;
export { ApiError };

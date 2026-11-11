import type { AuditResult, CaptureResult, Catalogue, EvaluateResult, Mandate, Profile, ProfileLimits, ProductObservation, PublicConfig, RunResult, TestResults } from '../types';
import { ApiError } from './error';
import { mock } from './mock';

const API_BASE = '/api';
const useMock = import.meta.env.VITE_USE_MOCK === 'true';
let publicConfigPromise: Promise<PublicConfig> | undefined;

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
    return useMock ? mock.runAgent(mandate_id, mode) : request<RunResult>(`${API_BASE}/agent/run`, { method: 'POST', body: JSON.stringify({ mandate_id, mode }) });
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
    return useMock ? mock.getTestResults() : request<TestResults>('/attacks/results.json');
  },
};

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

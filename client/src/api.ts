import type { AgentRun, AuditResult, CaptureResult, Health, Mandate, ParseResult, PublicConfig, Product, Merchant } from './types';
import { mock } from './mock';
const useMock = import.meta.env.VITE_USE_MOCK === 'true';
export const isMock = useMock;

const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly body?: unknown) { super(message); this.name = 'ApiError'; }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers } });
  } catch {
    throw new ApiError('The API could not be reached. Check the server connection and try again.', 0, 'NETWORK_ERROR');
  }
  let body: unknown;
  try { body = await response.json(); } catch { body = undefined; }
  if (!response.ok) {
    const error = body && typeof body === 'object' && 'error' in body ? (body as { error?: { code?: string; message?: string } }).error : undefined;
    throw new ApiError(error?.message || `The request failed (${response.status}).`, response.status, error?.code || 'HTTP_ERROR', body);
  }
  if (body === undefined) throw new ApiError('The API returned an unreadable response.', response.status, 'INVALID_RESPONSE');
  return body as T;
}
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const validMandate = (v: unknown): v is Mandate => object(v) && typeof v.mandate_id === 'string' && Number.isInteger(v.version) && ['pending_confirmation','active','revoked','expired'].includes(String(v.status)) && typeof v.original_instruction === 'string' && typeof v.item_category === 'string' && Number.isInteger(v.max_unit_price_cents) && Number.isInteger(v.max_total_cents) && Number.isInteger(v.quantity_max) && Array.isArray(v.allowed_merchant_ids) && typeof v.allow_bundles === 'boolean' && typeof v.allow_addons === 'boolean' && typeof v.expires_at === 'string' && typeof v.created_at === 'string' && (v.confirmed_at === null || typeof v.confirmed_at === 'string');
const validDecision = (v: unknown): boolean => object(v) && ['ALLOW','REVIEW','BLOCK'].includes(String(v.decision)) && Array.isArray(v.reasons) && v.reasons.every((r) => object(r) && typeof r.code === 'string' && typeof r.message === 'string' && ['BLOCK','REVIEW'].includes(String(r.severity)) && ['ai','deterministic'].includes(String(r.source))) && Array.isArray(v.checks) && v.checks.every((c) => object(c) && typeof c.code === 'string' && typeof c.passed === 'boolean' && ['ai','deterministic'].includes(String(c.source)));
const validProposal = (v: unknown): boolean => object(v) && typeof v.proposal_id === 'string' && typeof v.mandate_id === 'string' && Number.isInteger(v.mandate_version) && (v.source === 'naive' || v.source === 'protected') && typeof v.status === 'string' && Array.isArray(v.items) && Number.isInteger(v.total_cents) && (v.items as unknown[]).every((item) => object(item) && typeof item.sku === 'string' && typeof item.name === 'string' && Number.isInteger(item.quantity) && Number.isInteger(item.unit_price_cents)) && (v.source !== 'protected' || v.status !== 'ALLOWED' || (object(v.evidence) && validDecision(v.evidence.decision)));
function assertShape<T>(value: unknown, valid: (v: unknown) => boolean): T {
  if (!valid(value)) throw new ApiError('The API returned an incomplete or malformed response.', 200, 'INVALID_RESPONSE', value);
  return value as T;
}
const getMandate = async (id: string) => assertShape<Mandate>(await request<unknown>(`/api/mandates/${encodeURIComponent(id)}`), validMandate);
const postMandate = async (id: string, action: 'confirm' | 'revoke') => assertShape<Mandate>(await request<unknown>(`/api/mandates/${encodeURIComponent(id)}/${action}`, json('POST', {})), validMandate);
const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export const api = {
  health: async () => { if(useMock)return mock.health(); const r = await request<unknown>('/api/health'); return assertShape<Health>(r, (v) => object(v) && typeof v.status === 'string'); },
  publicConfig: async () => { if(useMock)return mock.publicConfig(); const r = await request<unknown>('/api/config/public'); return assertShape<PublicConfig>(r, (v) => object(v) && typeof v.paypal_client_id === 'string' && typeof v.currency === 'string'); },
  catalogue: async () => { if(useMock)return mock.catalogue(); const r = await request<unknown>('/api/catalogue'); return assertShape<{ merchants: Merchant[]; products: Product[] }>(r, (v) => object(v) && Array.isArray(v.merchants) && Array.isArray(v.products) && v.merchants.every((m) => object(m) && typeof m.merchant_id === 'string' && typeof m.name === 'string' && typeof m.approved_default === 'boolean') && v.products.every((p) => object(p) && typeof p.product_id === 'string' && typeof p.merchant_id === 'string' && typeof p.title === 'string' && typeof p.description === 'string' && Number.isInteger(p.price_cents) && typeof p.currency === 'string' && categories.has(String(p.category)) && (p.is_bundle === null || typeof p.is_bundle === 'boolean'))); },
  parseMandate: async (instruction: string) => { if(useMock)return mock.parseMandate(instruction); const r = await request<unknown>('/api/mandates/parse', json('POST', { instruction })); return assertShape<ParseResult>(r, (v) => object(v) && validMandate(v.mandate) && v.mandate.status === 'pending_confirmation' && Array.isArray(v.notes) && v.notes.every((n) => typeof n === 'string')); },
  getMandate: (id:string) => useMock ? mock.getMandate(id) : getMandate(id),
  confirmMandate: (id: string) => useMock ? mock.confirmMandate(id) : postMandate(id, 'confirm'),
  revokeMandate: (id: string) => useMock ? mock.revokeMandate(id) : postMandate(id, 'revoke'),
  runAgent: async (mandate_id: string, mode: 'naive' | 'protected') => { if(useMock)return mock.runAgent(mandate_id,mode); const r = await request<unknown>('/api/agent/run', json('POST', { mandate_id, mode })); return assertShape<AgentRun>(r, (v) => object(v) && typeof v.run_id === 'string' && v.mode === mode && typeof v.enforced === 'boolean' && Array.isArray(v.candidates) && v.candidates.every((c) => object(c) && typeof c.product_id === 'string' && ['ALLOW','REVIEW','BLOCK'].includes(String(c.decision)) && Array.isArray(c.reasons) && c.reasons.every((reason) => object(reason) && typeof reason.code === 'string' && typeof reason.message === 'string') && (!('checks' in c) || Array.isArray(c.checks)) && (c.extraction === null || object(c.extraction))) && (v.proposal === null || validProposal(v.proposal)) && (v.naive_reasoning === null || typeof v.naive_reasoning === 'string')); },
  checkout: async (id: string) => { if(useMock)return mock.checkout(id); const r = await request<unknown>(`/api/proposals/${encodeURIComponent(id)}/checkout`, json('POST', {})); return assertShape<{ paypal_order_id: string }>(r, (v) => object(v) && typeof v.paypal_order_id === 'string' && v.paypal_order_id.length > 0); },
  capture: async (id: string, order_id: string) => { if(useMock)return mock.capture(id,order_id); const r = await request<unknown>(`/api/proposals/${encodeURIComponent(id)}/capture`, json('POST', { order_id })); return assertShape<CaptureResult>(r, (v) => object(v) && typeof v.status === 'string' && Array.isArray(v.checks) && ('capture' in v)); },
  audit: (filters: { proposal_id?: string; mandate_id?: string }) => {
    if(useMock)return mock.audit(filters);
    const query = new URLSearchParams();
    if (filters.proposal_id) query.set('proposal_id', filters.proposal_id);
    if (filters.mandate_id) query.set('mandate_id', filters.mandate_id);
    return request<unknown>(`/api/audit${query.size ? `?${query.toString()}` : ''}`).then((r) => assertShape<AuditResult>(r, (v) => object(v) && typeof v.chain_ok === 'boolean' && Array.isArray(v.events) && v.events.every((event) => object(event) && Number.isInteger(event.id) && typeof event.ts === 'string' && typeof event.actor === 'string' && typeof event.event_type === 'string')));
  },
};
export { baseUrl };
const categories = new Set(['mouse','keyboard','headset','monitor','webcam']);

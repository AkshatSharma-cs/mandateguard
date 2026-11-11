import type { Mandate, Proposal } from './types';

export function mandateIsCurrent(mandate: Mandate | null | undefined, now = Date.now()): boolean {
  return Boolean(mandate && mandate.status === 'active' && Number.isFinite(Date.parse(mandate.expires_at)) && Date.parse(mandate.expires_at) > now);
}
export function canCheckout(proposal: Proposal | null | undefined, mandate: Mandate | null | undefined, now = Date.now()): boolean {
  if (!proposal || !mandate || proposal.source !== 'protected' || proposal.status !== 'ALLOWED') return false;
  if (!mandateIsCurrent(mandate, now) || proposal.mandate_id !== mandate.mandate_id || proposal.mandate_version !== mandate.version) return false;
  const decision = proposal.evidence?.decision ?? proposal.would_have_been;
  return decision?.decision === 'ALLOW' && Array.isArray(decision.checks) && Array.isArray(decision.reasons);
}
export type PaymentState = 'ready' | 'loading_sdk' | 'checkout' | 'capturing' | 'complete' | 'cancelled' | 'error' | 'unknown';
export function paymentStateAfterCapture(result: { status?: string } | null): PaymentState {
  return result?.status === 'CAPTURED' ? 'complete' : 'unknown';
}

import { describe, expect, it } from 'vitest';
import { canCheckout, mandateIsCurrent, paymentStateAfterCapture } from '../security';
import type { Mandate, Proposal } from '../types';

const mandate: Mandate = { mandate_id: 'm-1', version: 1, status: 'active', owner_id: 'local', original_instruction: 'mouse below 30', item_category: 'mouse', max_unit_price_cents: 3000, max_total_cents: 3000, quantity_max: 1, currency: 'USD', allowed_merchant_ids: ['m_acme'], allow_bundles: false, allow_addons: false, expires_at: '2030-01-01T00:00:00.000Z', created_at: '2029-01-01T00:00:00.000Z', confirmed_at: '2029-01-01T00:00:00.000Z' };
const proposal: Proposal = { proposal_id: 'p-1', mandate_id: 'm-1', mandate_version: 1, merchant_id: 'm_acme', currency: 'USD', items: [{ sku: 'x', name: 'Mouse', quantity: 1, unit_price_cents: 1000 }], total_cents: 1000, source: 'protected', status: 'ALLOWED', paypal_order_id: null, evidence: { decision: { decision: 'ALLOW', reasons: [], checks: [{ code: 'OK', passed: true, source: 'deterministic' }] } } };
describe('fail-closed checkout eligibility', () => {
  it('allows only current protected ALLOW proposals', () => expect(canCheckout(proposal, mandate, Date.parse('2029-06-01'))).toBe(true));
  it('blocks naive proposals even if their result claims ALLOW', () => expect(canCheckout({ ...proposal, source: 'naive', status: 'ALLOWED' }, mandate)).toBe(false));
  it.each(['REVIEW', 'BLOCK'] as const)('blocks %s policy decisions', (decision) => expect(canCheckout({ ...proposal, evidence: { decision: { decision, reasons: [], checks: [] } } }, mandate)).toBe(false));
  it('blocks stale, revoked and expired mandates', () => {
    expect(canCheckout({ ...proposal, mandate_version: 0 }, mandate)).toBe(false);
    expect(canCheckout(proposal, { ...mandate, status: 'revoked' })).toBe(false);
    expect(mandateIsCurrent(mandate, Date.parse('2031-01-01'))).toBe(false);
  });
  it('reports verified payment success only for backend CAPTURED status', () => {
    expect(paymentStateAfterCapture({ status: 'CAPTURED' })).toBe('complete');
    expect(paymentStateAfterCapture({ status: 'PENDING' })).toBe('unknown');
    expect(paymentStateAfterCapture(null)).toBe('unknown');
  });
});

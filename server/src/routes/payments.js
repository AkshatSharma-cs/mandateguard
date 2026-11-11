// server/src/routes/payments.js
import { Router } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { asyncHandler } from './mandates.js';
import * as defaultPaypal from '../paypal/client.js';
import * as defaultStorage from '../db.js';
import { append as appendAudit } from '../audit.js';
import { config } from '../config.js';
import { buildCatalogueMap, getProduct } from '../catalogue/index.js';
import { evaluate } from '../policy/engine.js';
import { verifyBeforeCapture } from '../capture/verify.js';
import { fromCents, toCents } from '../money.js';

const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const fingerprint = (products) => createHash('sha256').update(canonical(products)).digest('hex');
const paramSchema = z.object({ id: z.string().min(1).max(128) }).strict();
const bodySchema = z.object({}).strict();
const captureBodySchema = z.object({ order_id: z.string().min(1).max(128) }).strict();
const failValidation = () => { const error = new Error('Invalid request input'); error.status = 400; error.code = 'VALIDATION_ERROR'; throw error; };

export function createPaymentsRouter({ paypal = defaultPaypal, storage = defaultStorage, append = appendAudit,
  policy = evaluate, clock = () => new Date(), catalogueProducts = buildCatalogueMap } = {}) {
  const router = Router();

  async function evaluateStored(proposal, mandate, now) {
    const allProducts = catalogueProducts();
    const involved = (proposal.items ?? []).map((item) => allProducts.get(item.sku)).filter(Boolean);
    if (involved.length !== proposal.items?.length || proposal.evidence?.catalogue_hash !== fingerprint(involved)) {
      return { decision: 'BLOCK', reasons: [{ code: 'CATALOGUE_CHANGED', severity: 'BLOCK', source: 'deterministic', message: 'Stored catalogue evidence no longer matches current catalogue' }], checks: [] };
    }
    const extractions = proposal.evidence?.extractions ?? {};
    const flags = proposal.evidence?.sanitize_flags ?? {};
    const trustedCatalogue = new Map([...allProducts].map(([id, product]) => [id, {
      product_id: product.product_id, merchant_id: product.merchant_id, price_cents: product.price_cents,
      currency: product.currency, category: product.category, is_bundle: product.is_bundle,
    }]));
    return policy({
      mandate, proposal, catalogue: trustedCatalogue,
      extractions: new Map(Object.entries(extractions)),
      sanitizeFlags: new Map(Object.entries(flags)),
      captured: storage.listCapturedSkus(mandate.mandate_id).map((sku) => ({ mandate_id: mandate.mandate_id, sku })),
      now,
    });
  }

  router.get('/config/public', asyncHandler(async (req, res) => {
    if (!z.object({}).strict().safeParse(req.query).success) return failValidation();
    return res.json({ paypal_client_id: config.PAYPAL_CLIENT_ID, currency: 'USD' });
  }));

  router.post('/proposals/:id/checkout', asyncHandler(async (req, res) => {
    const params = paramSchema.safeParse(req.params);
    if (!params.success || !bodySchema.safeParse(req.body ?? {}).success) return failValidation();
    const proposal = storage.getProposal(params.data.id);
    if (!proposal) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Proposal not found' } });
    if (proposal.status !== 'ALLOWED' || proposal.source !== 'protected') {
      return res.status(409).json({ error: { code: 'PROPOSAL_NOT_CHECKOUTABLE', message: 'Only an allowed protected proposal can be checked out' } });
    }
    const mandate = storage.getMandate(proposal.mandate_id);
    if (!mandate) return res.status(409).json({ error: { code: 'MANDATE_NOT_FOUND', message: 'Mandate not found' } });
    const decision = await evaluateStored(proposal, mandate, clock());
    if (decision.decision !== 'ALLOW') return res.status(409).json({ error: { code: 'POLICY_REJECTED', message: 'Policy re-evaluation rejected checkout' }, decision });
    const order = await paypal.createOrder({ proposal_id: proposal.proposal_id, items: proposal.items, currency: proposal.currency, mode: 'sdk' });
    const updated = { ...proposal, status: 'ORDER_CREATED', paypal_order_id: order.id };
    storage.saveProposal(updated);
    append({ actor: 'system', event_type: 'ORDER_CREATED', mandate_id: proposal.mandate_id, proposal_id: proposal.proposal_id,
      payload: { paypal_order_id: order.id } });
    return res.status(201).json({ paypal_order_id: order.id });
  }));

  router.post('/proposals/:id/capture', asyncHandler(async (req, res) => {
    const params = paramSchema.safeParse(req.params);
    const body = captureBodySchema.safeParse(req.body);
    if (!params.success || !body.success) return failValidation();
    const proposal = storage.getProposal(params.data.id);
    if (!proposal) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Proposal not found' } });
    if (proposal.source !== 'protected') return res.status(409).json({ error: { code: 'PROPOSAL_NOT_CHECKOUTABLE', message: 'Naive proposals cannot be captured' } });
    if (proposal.status === 'CAPTURED') return res.json({ status: 'CAPTURED', checks: proposal.capture_checks ?? [], capture: proposal.capture ?? null });
    if (!['ORDER_CREATED', 'CAPTURE_PENDING'].includes(proposal.status)) {
      return res.status(409).json({ error: { code: 'INVALID_PROPOSAL_STATE', message: 'Proposal is not ready for capture' }, status: proposal.status });
    }
    if (proposal.paypal_order_id !== body.data.order_id) {
      return res.status(409).json({ error: { code: 'ORDER_ID_MISMATCH', message: 'Order id does not match proposal' } });
    }

    const order = await paypal.getOrder(body.data.order_id);
    const unit = order.purchase_units?.[0] ?? {};
    if (proposal.status === 'CAPTURE_PENDING' && order.status === 'COMPLETED') {
      const amountCents = (() => { try { return toCents(unit.amount?.value); } catch { return NaN; } })();
      if (order.id !== proposal.paypal_order_id || amountCents !== proposal.total_cents || unit.amount?.currency_code !== proposal.currency) {
        return res.status(409).json({ error: { code: 'RECONCILIATION_FAILED', message: 'Completed PayPal order does not match stored proposal' }, status: proposal.status });
      }
      const capture = unit.payments?.captures?.[0] ?? null;
      const finalized = { ...proposal, status: 'CAPTURED', capture, capture_checks: [{ id: 'RECONCILED', passed: true, detail: 'Completed order reconciled from PayPal' }] };
      storage.saveProposal(finalized);
      append({ actor: 'system', event_type: 'PAYMENT_CAPTURED', mandate_id: proposal.mandate_id, proposal_id: proposal.proposal_id,
        payload: { capture_id: capture?.id ?? null, reconciled: true } });
      return res.json({ status: 'CAPTURED', checks: finalized.capture_checks, capture });
    }

    const mandate = storage.getMandate(proposal.mandate_id);
    if (!mandate) return res.status(409).json({ error: { code: 'MANDATE_NOT_FOUND', message: 'Mandate not found' } });
    const now = clock();
    const policyDecision = await evaluateStored(proposal, mandate, now);
    const capturedSkus = storage.listCapturedSkus(mandate.mandate_id);
    const alreadyCaptured = (proposal.items ?? []).some((item) => capturedSkus.includes(item.sku));
    const verifiedProposal = proposal.status === 'CAPTURE_PENDING' ? { ...proposal, status: 'ORDER_CREATED' } : proposal;
    const verification = verifyBeforeCapture({
      proposal: verifiedProposal, mandate, order, businessEmail: config.PAYPAL_BUSINESS_EMAIL,
      alreadyCaptured, policyDecision: policyDecision.decision, now,
    });
    append({ actor: 'system', event_type: 'VERIFICATION_RESULT', mandate_id: proposal.mandate_id, proposal_id: proposal.proposal_id,
      payload: { ok: verification.ok, checks: verification.checks, policy_decision: policyDecision.decision } });
    if (!verification.ok) return res.status(409).json({ error: { code: 'VERIFICATION_FAILED', message: 'Capture verification failed' }, status: proposal.status, checks: verification.checks, policy: policyDecision });

    if (proposal.status === 'ORDER_CREATED') {
      const reserved = storage.reserveCapture(proposal.proposal_id);
      if (!reserved) return res.status(409).json({ status: 'CAPTURE_PENDING', checks: verification.checks, capture: null });
      storage.saveProposal({ ...proposal, status: 'CAPTURE_PENDING' });
    }

    await paypal.captureOrder(proposal.paypal_order_id, `capture_${proposal.proposal_id}`);
    const completed = await paypal.getOrder(proposal.paypal_order_id);
    const completedUnit = completed.purchase_units?.[0] ?? {};
    let completedAmount;
    try { completedAmount = toCents(completedUnit.amount?.value); } catch { completedAmount = NaN; }
    if (completed.status !== 'COMPLETED' || completed.id !== proposal.paypal_order_id
      || completedAmount !== proposal.total_cents || completedUnit.amount?.currency_code !== proposal.currency) {
      return res.status(409).json({ error: { code: 'CAPTURE_NOT_CONFIRMED', message: 'PayPal did not confirm the expected completed amount' }, status: 'CAPTURE_PENDING', checks: verification.checks, capture: null });
    }
    const capture = completedUnit.payments?.captures?.[0] ?? null;
    const finalized = { ...proposal, status: 'CAPTURED', capture, capture_checks: verification.checks };
    storage.saveProposal(finalized);
    append({ actor: 'system', event_type: 'PAYMENT_CAPTURED', mandate_id: proposal.mandate_id, proposal_id: proposal.proposal_id,
      payload: { capture_id: capture?.id ?? null, amount: fromCents(proposal.total_cents), currency: proposal.currency } });
    return res.json({ status: 'CAPTURED', checks: verification.checks, capture });
  }));

  return router;
}

export default createPaymentsRouter();

// server/src/routes/payments.js
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from './mandates.js';
import * as defaultPaypal from '../paypal/client.js';
import * as defaultStorage from '../db.js';
import { append as appendAudit } from '../audit.js';
import { list as listAudit, verifyChain } from '../audit.js';
import { config } from '../config.js';
import { buildCatalogueMap, getProduct, getMerchants } from '../catalogue/index.js';
import { evaluate } from '../policy/engine.js';
import { verifyBeforeCapture } from '../capture/verify.js';
import { fromCents, toCents } from '../money.js';
import { fingerprint, validateMarketplaceSnapshot } from '../payments/evidence.js';
import { isGatewayProposal } from '../payments/checkoutBoundary.js';
const paramSchema = z.object({ id: z.string().min(1).max(128) }).strict();
const bodySchema = z.object({}).strict();
const captureBodySchema = z.object({ order_id: z.string().min(1).max(128) }).strict();
const failValidation = () => { const error = new Error('Invalid request input'); error.status = 400; error.code = 'VALIDATION_ERROR'; throw error; };

export function createPaymentsRouter({ paypal = defaultPaypal, storage = defaultStorage, append = appendAudit,
  policy = evaluate, clock = () => new Date(), catalogueProducts = buildCatalogueMap } = {}) {
  const router = Router();

  router.get('/proposals/:id/receipt', asyncHandler(async (req, res) => {
    const params = paramSchema.safeParse(req.params);
    if (!params.success) return failValidation();
    const proposal = storage.getProposal(params.data.id);
    if (!proposal) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Proposal not found' } });
    if (proposal.status !== 'CAPTURED') return res.status(409).json({ error: { code: 'NOT_CAPTURED', message: 'Receipt is available after capture.' } });
    const observation = proposal.payment_observation ?? {};
    const events = listAudit({ proposal_id: proposal.proposal_id });
    const capture = proposal.capture ?? {};
    return res.json({ proposal_id: proposal.proposal_id, status: proposal.status,
      simulated: proposal.payment_mode === 'sandbox_simulation',
      disclosure: proposal.payment_mode === 'sandbox_simulation'
        ? `PayPal sandbox simulation. MandateGuard created a sandbox order for this product. Nothing is purchased from ${observation.domain ?? proposal.sandbox_listing?.domain ?? 'the store'} and no real money moves.`
        : 'PayPal sandbox payment for the MandateGuard demo store. No real purchase or shipment happens.',
      product: { title: observation.title ?? proposal.sandbox_listing?.title ?? proposal.items?.[0]?.name,
        url: observation.url ?? proposal.sandbox_listing?.url, domain: observation.domain ?? proposal.sandbox_listing?.domain,
        price_cents: observation.price_cents ?? proposal.total_cents, currency: proposal.currency, source: observation.source ?? 'curated' },
      paypal: { order_id: proposal.paypal_order_id, capture_id: capture.id ?? null,
        amount: capture.amount?.value ?? (proposal.total_cents / 100).toFixed(2) },
      checks: proposal.capture_checks ?? [], audit: { chain_ok: verifyChain().ok, events_count: events.length },
      created_at: proposal.created_at, captured_at: proposal.captured_at ?? capture.create_time ?? new Date().toISOString() });
  }));

  function paypalSandboxConfigured() {
    try { return new URL(config.PAYPAL_BASE_URL).hostname === 'api-m.sandbox.paypal.com'; }
    catch { return false; }
  }

  async function evaluateStored(proposal, mandate, now) {
    const allProducts = catalogueProducts();
    const marketplaceSnapshot = proposal.sandbox_demo_payment ? validateMarketplaceSnapshot(proposal) : null;
    const involved = proposal.sandbox_demo_payment
      ? (marketplaceSnapshot ? [marketplaceSnapshot] : [])
      : (proposal.items ?? []).map((item) => allProducts.get(item.sku)).filter(Boolean);
    if (involved.length !== proposal.items?.length || proposal.evidence?.catalogue_hash !== fingerprint(involved)) {
      return { decision: 'BLOCK', reasons: [{ code: 'CATALOGUE_CHANGED', severity: 'BLOCK', source: 'deterministic', message: 'Stored catalogue evidence no longer matches current catalogue' }], checks: [] };
    }
    const extractions = proposal.evidence?.extractions ?? {};
    const flags = proposal.evidence?.sanitize_flags ?? {};
    const trustedCatalogue = new Map([...allProducts].map(([id, product]) => [id, {
      product_id: product.product_id, merchant_id: product.merchant_id, price_cents: product.price_cents,
      currency: product.currency, category: product.category, is_bundle: product.is_bundle,
      domain: product.domain, first_party: product.first_party === true,
    }]));
    for (const product of involved) trustedCatalogue.set(product.product_id, {
      product_id: product.product_id, merchant_id: product.merchant_id, price_cents: product.price_cents,
      currency: product.currency, category: product.category, is_bundle: product.is_bundle,
      domain: product.domain, first_party: product.first_party === true,
    });
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
    if (proposal.payment_mode === 'sandbox_simulation' || proposal.sandbox_demo_payment) {
      if (!paypalSandboxConfigured()) return res.status(409).json({ error: { code: 'SANDBOX_ONLY', message: 'Channel3 listing payments are available only in PayPal Sandbox.' } });
      if (proposal.currency !== 'USD') return res.status(409).json({ error: { code: 'CURRENCY_MISMATCH', message: 'Only USD is supported in the sandbox.' } });
      const created = Date.parse(proposal.payment_observation?.captured_at ?? proposal.created_at);
      if (!Number.isFinite(created) || clock().getTime() - created > 15 * 60_000) {
        return res.status(409).json({ error: { code: 'OBSERVATION_STALE', message: 'This price is more than 15 minutes old. Run the search again.' } });
      }
      if (proposal.payment_observation?.price_cents == null) return res.status(409).json({ error: { code: 'PRICE_UNKNOWN', message: 'This listing has no price, so it cannot be paid.' } });
    }
    const mandate = storage.getMandate(proposal.mandate_id);
    if (!mandate) return res.status(409).json({ error: { code: 'MANDATE_NOT_FOUND', message: 'Mandate not found' } });
    const decision = await evaluateStored(proposal, mandate, clock());
    if (decision.decision !== 'ALLOW') return res.status(409).json({ error: { code: 'POLICY_REJECTED', message: 'Policy re-evaluation rejected checkout' }, decision });
    let order;
    try {
      order = await paypal.createOrder({ proposal_id: proposal.proposal_id, items: proposal.items, currency: proposal.currency,
        mode: 'sdk', sandbox_demo_payment: proposal.sandbox_demo_payment === true, payment_mode: proposal.payment_mode,
        domain: proposal.payment_observation?.domain ?? proposal.sandbox_listing?.domain,
        title: proposal.payment_observation?.title ?? proposal.sandbox_listing?.title,
        payee_email: config.PAYPAL_BUSINESS_EMAIL || undefined,
        demo_store_order: proposal.payment_mode === 'store_checkout', merchant_name: proposal.sandbox_listing?.merchant_name ?? proposal.merchant_name
          ?? getMerchants().find((merchant) => merchant.merchant_id === proposal.merchant_id)?.name ?? 'MandateGuard Demo Store' });
    } catch (error) {
      error.paypalCurrency = proposal.currency;
      throw error;
    }
    const updated = { ...proposal, status: 'ORDER_CREATED', paypal_order_id: order.id };
    storage.saveProposal(updated);
    append({ actor: 'system', event_type: 'ORDER_CREATED', mandate_id: proposal.mandate_id, proposal_id: proposal.proposal_id,
      payload: { paypal_order_id: order.id, sandbox_demo_payment: proposal.sandbox_demo_payment === true, simulated: proposal.payment_mode === 'sandbox_simulation' } });
    return res.status(201).json({ paypal_order_id: order.id });
  }));

  router.post('/proposals/:id/capture', asyncHandler(async (req, res) => {
    const params = paramSchema.safeParse(req.params);
    const body = captureBodySchema.safeParse(req.body);
    if (!params.success || !body.success) return failValidation();
    const proposal = storage.getProposal(params.data.id);
    if (!proposal) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Proposal not found' } });
    if ((proposal.payment_mode === 'sandbox_simulation' || proposal.sandbox_demo_payment) && !paypalSandboxConfigured()) return res.status(409).json({ error: { code: 'SANDBOX_ONLY', message: 'Simulated payments are available only in PayPal Sandbox.' } });
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
      const reconciledChecks = Array.isArray(proposal.capture_checks) && proposal.capture_checks.length === 12
        ? proposal.capture_checks : [{ id: 'RECONCILED', passed: true, detail: 'Completed order reconciled from PayPal' }];
      const finalized = { ...proposal, status: 'CAPTURED', capture, capture_checks: reconciledChecks,
        captured_at: capture?.create_time ?? clock().toISOString() };
      storage.saveProposal(finalized);
      append({ actor: 'system', event_type: 'PAYMENT_CAPTURED', mandate_id: proposal.mandate_id, proposal_id: proposal.proposal_id,
        payload: { capture_id: capture?.id ?? null, reconciled: true, simulated: proposal.payment_mode === 'sandbox_simulation' } });
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
      paymentMode: (proposal.payment_observation?.checkout_mode ?? proposal.checkout_mode) === 'gateway' ? 'store_checkout' : 'sandbox_simulation',
    });
    append({ actor: 'system', event_type: 'VERIFICATION_RESULT', mandate_id: proposal.mandate_id, proposal_id: proposal.proposal_id,
      payload: { ok: verification.ok, checks: verification.checks, policy_decision: policyDecision.decision } });
    if (!verification.ok) return res.status(409).json({ error: { code: 'VERIFICATION_FAILED', message: 'Capture verification failed' }, status: proposal.status, checks: verification.checks, policy: policyDecision });

    if (proposal.status === 'ORDER_CREATED') {
      const reserved = storage.reserveCapture(proposal.proposal_id);
      if (!reserved) return res.status(409).json({ status: 'CAPTURE_PENDING', checks: verification.checks, capture: null });
      storage.saveProposal({ ...proposal, status: 'CAPTURE_PENDING', capture_checks: verification.checks });
    }

    try {
      await paypal.captureOrder(proposal.paypal_order_id, `capture_${proposal.proposal_id}`);
    } catch (error) {
      error.paypalCurrency = proposal.currency;
      throw error;
    }
    const completed = await paypal.getOrder(proposal.paypal_order_id);
    const completedUnit = completed.purchase_units?.[0] ?? {};
    let completedAmount;
    try { completedAmount = toCents(completedUnit.amount?.value); } catch { completedAmount = NaN; }
    if (completed.status !== 'COMPLETED' || completed.id !== proposal.paypal_order_id
      || completedAmount !== proposal.total_cents || completedUnit.amount?.currency_code !== proposal.currency) {
      return res.status(409).json({ error: { code: 'CAPTURE_NOT_CONFIRMED', message: 'PayPal did not confirm the expected completed amount' }, status: 'CAPTURE_PENDING', checks: verification.checks, capture: null });
    }
    const capture = completedUnit.payments?.captures?.[0] ?? null;
    const finalized = { ...proposal, status: 'CAPTURED', capture, capture_checks: verification.checks,
      captured_at: capture?.create_time ?? now.toISOString() };
    storage.saveProposal(finalized);
    append({ actor: 'system', event_type: 'PAYMENT_CAPTURED', mandate_id: proposal.mandate_id, proposal_id: proposal.proposal_id,
      payload: { capture_id: capture?.id ?? null, amount: fromCents(proposal.total_cents), currency: proposal.currency,
        sandbox_demo_payment: proposal.sandbox_demo_payment === true, simulated: proposal.payment_mode === 'sandbox_simulation' } });
    return res.json({ status: 'CAPTURED', checks: verification.checks, capture });
  }));

  return router;
}

export default createPaymentsRouter();

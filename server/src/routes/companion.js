import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from './mandates.js';
import { getMandate } from '../db.js';
import { append } from '../audit.js';
import { extractListing } from '../llm/extractor.js';

const router = Router();
const bodySchema = z.object({
  mandate_id: z.string().min(1).max(128),
  listing: z.object({
    url: z.string().url().max(2048).refine(value => new URL(value).protocol === 'https:'),
    title: z.string().trim().min(1).max(500),
    description: z.string().max(4000),
    price_cents: z.number().int().nonnegative().max(100000000).nullable(),
    currency: z.literal('USD'),
  }).strict(),
}).strict();

function reason(code, severity, source, message) {
  return { code, severity, source, message };
}

router.post('/analyze', asyncHandler(async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    const error = new Error('Provide an HTTPS product page, title, description, and USD price.');
    error.status = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  const { mandate_id, listing } = parsed.data;
  const mandate = getMandate(mandate_id);
  if (!mandate || mandate.status !== 'active' || Date.parse(mandate.expires_at) <= Date.now()) {
    return res.status(409).json({ error: { code: 'MANDATE_INACTIVE', message: 'Choose an active, unexpired mandate.' } });
  }

  const extractionResult = await extractListing({ title: listing.title, description: listing.description });
  const extraction = extractionResult.ok ? extractionResult.extraction : null;
  const reasons = [];
  const checks = [];
  const addCheck = (code, passed, source) => checks.push({ code, passed, source });
  const block = (code, source, message) => {
    addCheck(code, false, source);
    reasons.push(reason(code, 'BLOCK', source, message));
  };
  const review = (code, source, message) => {
    addCheck(code, false, source);
    reasons.push(reason(code, 'REVIEW', source, message));
  };

  if (!extraction) {
    review('EXTRACTOR_FAILED', 'ai', 'The product page could not be analyzed.');
  } else {
    const flagsDetected = Object.values(extractionResult.flags ?? {}).some(Boolean);
    if (flagsDetected) block('HIDDEN_CONTENT', 'deterministic', 'Hidden or invisible page content was detected.');
    if ((extraction.directives_to_agent || extraction.asserts_authority_override) && extraction.confidence >= 0.5) {
      block('INJECTION_DETECTED', 'ai', 'The listing contains instructions aimed at an AI agent.');
    }
    if (extraction.category_label !== 'unclear' && extraction.category_label !== 'other') {
      const matches = extraction.category_label === mandate.item_category;
      addCheck('CATEGORY_MATCH', matches, 'ai');
      if (!matches) block('CATEGORY_MISMATCH', 'ai', 'The listing category differs from the active mandate.');
    } else {
      review('CATEGORY_UNCLEAR', 'ai', 'The listing category could not be confirmed.');
    }
    if (extraction.claims_bundle && !mandate.allow_bundles) {
      block('BUNDLE_NOT_ALLOWED', 'ai', 'The listing appears to describe a bundle, which this mandate does not allow.');
    }
    if (extraction.urgency_pressure) review('URGENCY_PRESSURE', 'ai', 'The listing uses urgency pressure.');
    if (extraction.claimed_price_cents !== null && listing.price_cents !== null
      && extraction.claimed_price_cents !== listing.price_cents) {
      review('TEXT_PRICE_CONFLICT', 'ai', 'The listing text and the displayed price differ.');
    }
  }

  if (listing.price_cents === null) {
    review('PRICE_UNVERIFIED', 'deterministic', 'Enter the displayed price to compare it with the mandate.');
  } else {
    const withinLimit = listing.price_cents <= mandate.max_unit_price_cents
      && listing.price_cents <= mandate.max_total_cents;
    addCheck('PRICE_WITHIN_LIMIT', withinLimit, 'deterministic');
    if (!withinLimit) block('OVER_BUDGET', 'deterministic', 'The displayed price is above the mandate limit.');
  }

  // A page opened in the browser is not a verified catalogue record or checkout source.
  review('SOURCE_UNVERIFIED', 'deterministic', 'Confirm the seller and final checkout price on the merchant page.');
  const decision = reasons.some(item => item.severity === 'BLOCK') ? 'BLOCK' : 'REVIEW';
  const source = new URL(listing.url).hostname;
  append({ actor: 'user', event_type: 'COMPANION_LISTING_ANALYZED', mandate_id, proposal_id: null,
    payload: { source, decision, extraction_ok: extractionResult.ok } });

  return res.json({
    decision,
    enforced: false,
    checkout_eligible: false,
    source_url: listing.url,
    source_domain: source,
    title: listing.title,
    price_cents: listing.price_cents,
    currency: listing.currency,
    reasons,
    checks,
    extraction,
    flags: extractionResult.flags ?? null,
  });
}));

export default router;

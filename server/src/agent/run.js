// server/src/agent/run.js
import { createHash, randomUUID } from 'node:crypto';
import { getProducts, getMerchants } from '../catalogue/index.js';
import { extractListing } from '../llm/extractor.js';
import { naiveChoose } from '../llm/naiveAgent.js';
import { listCapturedSkus, saveEvaluation, saveProposal } from '../db.js';
import { append } from '../audit.js';

const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
};
const actor = 'agent';
const event = (event_type, mandate, proposal_id, payload) => append({ actor, event_type, mandate_id: mandate.mandate_id, proposal_id, payload });

async function getEvaluate() {
  // The policy engine is an existing project dependency; loading lazily keeps other API routes available if it is missing.
  try {
    const module = await import('../policy/engine.js');
    if (typeof module.evaluate !== 'function') throw new Error('missing evaluate export');
    return module.evaluate;
  } catch {
    const error = new Error('Policy engine unavailable; refusing to generate protected proposals');
    error.status = 503;
    error.code = 'POLICY_UNAVAILABLE';
    throw error;
  }
}

function trustedProduct(product) {
  return {
    product_id: product.product_id, merchant_id: product.merchant_id,
    price_cents: product.price_cents, currency: product.currency,
    category: product.category, is_bundle: product.is_bundle,
    domain: product.domain, first_party: product.first_party === true,
  };
}

function observationFor(product, seller, flags = {}, capturedAt = new Date()) {
  const domain = String(product.domain ?? 'catalogue.local').toLowerCase();
  const text = `${product.title}\n${product.description}`;
  return {
    observation_id: product.product_id,
    url: product.url ?? `https://${domain}/products/${encodeURIComponent(product.product_id)}`,
    domain,
    source: 'curated',
    title: product.title,
    price_cents: product.price_cents,
    currency: product.currency,
    seller,
    sold_by_merchant: product.first_party === true,
    availability: product.availability ?? 'unknown',
    image_url: product.image_url ?? null,
    category_hint: product.category ?? null,
    bundle_signal: product.is_bundle ?? null,
    hidden_text_found: Object.values(flags).some(Boolean),
    text,
    captured_at: capturedAt.toISOString(),
    content_hash: createHash('sha256').update(text).digest('hex'),
  };
}

function proposalId() { return randomUUID(); }

function buildEvaluationProposal(mandate, product, id, now) {
  return {
    proposal_id: id, mandate_id: mandate.mandate_id, mandate_version: mandate.version,
    merchant_id: product.merchant_id, currency: product.currency,
    items: [{ sku: product.product_id, name: product.product_id, quantity: 1, unit_price_cents: product.price_cents }],
    total_cents: product.price_cents, source: 'protected', status: 'DRAFT', paypal_order_id: null,
    created_at: now.toISOString(),
  };
}

async function evaluateOne(evaluate, mandate, product, extractionResult, now, id) {
  const proposal = buildEvaluationProposal(mandate, product, id, now);
  const extraction = extractionResult?.ok ? extractionResult.extraction : null;
  const extractions = new Map([[product.product_id, extraction]]);
  const flags = extractionResult?.flags ?? { zero_width: false, html_comment: false, hidden_style: false };
  const sanitizeFlags = new Map([[product.product_id, flags]]);
  const decision = await evaluate({
    mandate, proposal, catalogue: new Map([[product.product_id, trustedProduct(product)]]), extractions,
    sanitizeFlags, captured: listCapturedSkus(mandate.mandate_id).map((sku) => ({ mandate_id: mandate.mandate_id, sku })), now,
  });
  return { proposal, decision, extraction, sanitize_flags: { [product.product_id]: flags } };
}

export async function runProtected({ mandate, now = new Date() }) {
  const instant = now instanceof Date ? now : new Date(now);
  const run_id = randomUUID();
  event('AGENT_RUN_STARTED', mandate, null, { run_id, mode: 'protected' });
  const products = getProducts().filter((product) => mandate.item_category == null
    ? !Array.isArray(mandate.category_terms) || mandate.category_terms.length === 0 || mandate.category_terms.includes(product.category)
    : product.category === mandate.item_category);
  const evaluate = await getEvaluate();
  const candidates = [];
  const results = new Map();

  for (const product of products) {
    // Raw seller text is sent only to the quarantined extractor.
    const extracted = await extractListing(product);
    const proposedId = proposalId();
    let evaluated;
    try {
      evaluated = await evaluateOne(evaluate, mandate, product, extracted, instant, proposedId);
    } catch {
      evaluated = {
        proposal: buildEvaluationProposal(mandate, product, proposedId, instant),
        decision: { decision: 'BLOCK', reasons: [{ code: 'POLICY_ERROR', severity: 'BLOCK', source: 'deterministic', message: 'Policy evaluation failed' }], checks: [] },
        extraction: extracted.ok ? extracted.extraction : null,
        sanitize_flags: { [product.product_id]: extracted.flags },
      };
    }
    results.set(product.product_id, { product, extracted, ...evaluated });
    candidates.push({
      product_id: product.product_id,
      decision: evaluated.decision.decision,
      reasons: evaluated.decision.reasons ?? [], checks: evaluated.decision.checks ?? [],
      extraction: extracted.ok ? extracted.extraction : null,
      observation: observationFor(product, new Map(getMerchants().map((merchant) => [merchant.merchant_id, merchant.name])).get(product.merchant_id) ?? product.merchant_id, extracted.flags, instant),
    });
    event('LISTING_SANITIZED', mandate, proposedId, { product_id: product.product_id, flags: extracted.flags });
    event('EXTRACTION_DONE', mandate, proposedId, { product_id: product.product_id, ok: extracted.ok });
    event('POLICY_DECISION', mandate, proposedId, { product_id: product.product_id, decision: evaluated.decision });
  }

  const allowed = [...results.values()].filter((result) => result.decision.decision === 'ALLOW')
    .sort((a, b) => a.product.price_cents - b.product.price_cents)[0];
  const allowedAlternativeIds = [];
  const allowedResults = [...results.values()].filter((result) => result.decision.decision === 'ALLOW');
  const merchantNames = new Map(getMerchants().map((merchant) => [merchant.merchant_id, merchant.name]));
  for (const result of allowedResults) {
    const evaluation_id = proposalId();
    const candidate = candidates.find((entry) => entry.product_id === result.product.product_id);
    const created_at = instant.toISOString();
    const evaluationProposal = {
      ...buildEvaluationProposal(mandate, result.product, evaluation_id, instant),
      status: 'ALLOWED',
      evidence: { extractions: { [result.product.product_id]: result.extraction }, sanitize_flags: result.sanitize_flags,
        catalogue_hash: createHash('sha256').update(canonical([result.product])).digest('hex'), decision: result.decision, evaluated_at: created_at },
    };
    const observation = observationFor(result.product, merchantNames.get(result.product.merchant_id) ?? result.product.merchant_id, result.extracted.flags, instant);
    candidate.evaluation_id = evaluation_id;
    allowedAlternativeIds.push(evaluation_id);
    saveEvaluation({ evaluation_id, mandate_id: mandate.mandate_id, mandate_version: mandate.version, decision: 'ALLOW',
      observation, proposal: evaluationProposal, created_at, expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString() });
  }
  let proposal = null;
  if (allowed) {
    const { product, extraction, sanitize_flags, decision } = allowed;
    const created_at = instant.toISOString();
    const id = proposalId();
    const productForHash = trustedProduct(product);
    proposal = {
      proposal_id: id, mandate_id: mandate.mandate_id, mandate_version: mandate.version,
      merchant_id: product.merchant_id,
      // Use the trusted catalogue ID as the PayPal item label; seller-controlled titles/descriptions never reach payment APIs.
      items: [{ sku: product.product_id, name: product.product_id, quantity: 1, unit_price_cents: product.price_cents }],
      total_cents: product.price_cents, currency: product.currency, source: 'protected', status: 'ALLOWED',
      paypal_order_id: null,
      evidence: {
        extractions: { [product.product_id]: extraction }, sanitize_flags,
        catalogue_hash: createHash('sha256').update(canonical([product])).digest('hex'),
        decision, evaluated_at: created_at,
      },
      created_at,
    };
    saveProposal(proposal);
    event('PROPOSAL_CREATED', mandate, id, { source: 'protected', status: 'ALLOWED', total_cents: proposal.total_cents });
  }
  return { run_id, mode: 'protected', enforced: true, candidates, proposal, naive_reasoning: null, allowed_alternative_ids: allowedAlternativeIds };
}

export async function runNaive({ mandate, now = new Date() }) {
  const instant = now instanceof Date ? now : new Date(now);
  const run_id = randomUUID();
  event('AGENT_RUN_STARTED', mandate, null, { run_id, mode: 'naive' });
  const products = getProducts().filter((product) => mandate.item_category == null
    ? !Array.isArray(mandate.category_terms) || mandate.category_terms.length === 0 || mandate.category_terms.includes(product.category)
    : product.category === mandate.item_category);
  const merchants = new Map(getMerchants().map((merchant) => [merchant.merchant_id, merchant.name]));
  const modelProducts = products.map((product) => ({ ...product, merchant_name: merchants.get(product.merchant_id) }));
  const choice = await naiveChoose({ instruction: mandate.original_instruction ?? '', products: modelProducts, sample_id: `naive:${run_id}` });

  const candidates = [];
  const proposal_id = proposalId();
  const extractionMap = {};
  const flagsMap = {};
  for (const product of products) {
    const extracted = await extractListing(product);
    extractionMap[product.product_id] = extracted.ok ? extracted.extraction : null;
    flagsMap[product.product_id] = extracted.flags;
    event('LISTING_SANITIZED', mandate, proposal_id, { product_id: product.product_id, flags: extracted.flags });
    event('EXTRACTION_DONE', mandate, proposal_id, { product_id: product.product_id, ok: extracted.ok });
  }

  const byId = new Map(products.map((product) => [product.product_id, product]));
  const items = choice.items;
  const selectedProducts = [...new Set(items.map((item) => byId.get(item.sku)).filter(Boolean))];
  const selectedIds = new Set(selectedProducts.map((product) => product.product_id));
  const displayExtractions = Object.fromEntries(Object.entries(extractionMap).filter(([id]) => selectedIds.has(id)));
  const displayFlags = Object.fromEntries(Object.entries(flagsMap).filter(([id]) => selectedIds.has(id)));
  const proposal = {
    proposal_id, mandate_id: mandate.mandate_id, mandate_version: mandate.version,
    merchant_id: selectedProducts[0]?.merchant_id ?? null,
    items, total_cents: items.reduce((sum, item) => sum + item.quantity * item.unit_price_cents, 0),
    currency: 'USD', source: 'naive', status: 'DRAFT', paypal_order_id: null,
    evidence: { extractions: displayExtractions, sanitize_flags: displayFlags,
      catalogue_hash: createHash('sha256').update(canonical(selectedProducts)).digest('hex'),
      decision: null, evaluated_at: instant.toISOString() },
    created_at: instant.toISOString(), naive_reasoning: choice.reasoning,
  };

  let would_have_been = { decision: 'BLOCK', reasons: [{ code: 'POLICY_ERROR', severity: 'BLOCK', source: 'deterministic', message: 'Policy evaluation unavailable' }], checks: [] };
  try {
    const evaluate = await getEvaluate();
    const idToProduct = new Map(products.map((product) => [product.product_id, product]));
    const evalProducts = items.map((item) => idToProduct.get(item.sku)).filter(Boolean);
    would_have_been = await evaluate({
      mandate, proposal, catalogue: new Map(evalProducts.map((product) => [product.product_id, trustedProduct(product)])),
      extractions: new Map(Object.entries(displayExtractions)), sanitizeFlags: new Map(Object.entries(displayFlags)),
      captured: listCapturedSkus(mandate.mandate_id).map((sku) => ({ mandate_id: mandate.mandate_id, sku })), now: instant,
    });
  } catch { /* Fail closed for the comparison result; never promote a naive draft. */ }
  proposal.evidence.decision = would_have_been;
  proposal.would_have_been = would_have_been.decision;
  saveProposal(proposal);
  for (const item of items) {
    const product = byId.get(item.sku);
    candidates.push({ product_id: item.sku, decision: would_have_been.decision,
      reasons: would_have_been.reasons ?? [], checks: would_have_been.checks ?? [],
      extraction: displayExtractions[item.sku] ?? null,
      ...(product ? { observation: observationFor(product, merchants.get(product.merchant_id) ?? product.merchant_id, flagsMap[item.sku], instant) } : {}) });
    event('POLICY_DECISION', mandate, proposal_id, { product_id: item.sku, decision: would_have_been });
  }
  event('PROPOSAL_CREATED', mandate, proposal_id, { source: 'naive', status: 'DRAFT', would_have_been: would_have_been.decision });
  return { run_id, mode: 'naive', enforced: false, candidates, proposal, naive_reasoning: choice.reasoning };
}

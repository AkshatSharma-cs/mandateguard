// server/src/agent/streaming.js
import { createHash, randomUUID } from 'node:crypto';
import { evaluate } from '../policy/engine.js';
import { getMandate, listCapturedSkus, saveEvaluation, saveProposal } from '../db.js';
import { append } from '../audit.js';
import { getMerchants, getProduct, getDiscoveryStatus, searchProducts } from '../catalogue/index.js';
import { extractListing } from '../llm/extractor.js';
import { naiveChooseWithStatus } from '../llm/naiveAgent.js';
import { paymentEvidenceFor } from '../payments/evidence.js';
import config from '../config.js';
import { checkoutBoundary } from '../payments/checkoutBoundary.js';

const RUN_TTL = 30 * 60_000;
const RUN_BUDGET = 40_000;
const extractionCache = new Map();
const runs = new Map();
const runtime = { searchProducts, extractListing, naiveChooseWithStatus, budgetMs: RUN_BUDGET, maxLlmCalls: config.MAX_LLM_CALLS_PER_RUN };
const paymentEvidence = (product) => paymentEvidenceFor(product,
  product.source === 'curated' ? (getProduct(product.product_id) ?? product) : product);
const cleanOldRuns = () => { const before = Date.now() - RUN_TTL; for (const [id, run] of runs) if (run.created_at < before) runs.delete(id); };
const reason = (code, message, severity = 'REVIEW') => ({ code, message, severity, source: 'deterministic' });
function candidateFlags(extraction, sanitizeFlags, observation) {
  return { injection: Boolean(extraction?.directives_to_agent || extraction?.asserts_authority_override),
    hidden_text: Boolean(observation?.hidden_text_found || sanitizeFlags?.zero_width || sanitizeFlags?.html_comment || sanitizeFlags?.hidden_style),
    urgency: Boolean(extraction?.urgency_pressure),
    price_conflict: extraction?.claimed_price_cents != null && observation?.price_cents != null
      && extraction.claimed_price_cents !== observation.price_cents };
}

function makeObservation(product, seller) {
  const domain = String(product.domain ?? 'catalogue.local').toLowerCase();
  const text = `${product.title}\n${product.description}`;
  const observation = { observation_id: product.product_id, url: product.url ?? `https://${domain}/products/${encodeURIComponent(product.product_id)}`,
    domain, source: product.source ?? 'curated', title: product.title, price_cents: product.price_cents,
    currency: product.currency ?? 'USD', seller: product.merchant_name ?? seller, sold_by_merchant: product.first_party === true,
    availability: product.availability ?? 'unknown', image_url: product.image_url ?? null,
    category_hint: product.category ?? null, bundle_signal: product.is_bundle ?? null, hidden_text_found: false,
    text, captured_at: new Date().toISOString(), content_hash: product.content_hash ?? createHash('sha256').update(text).digest('hex') };
  return { ...observation, ...checkoutBoundary(observation) };
}
function trustedProduct(product) {
  return { product_id: product.product_id, merchant_id: product.merchant_id, price_cents: product.price_cents,
    currency: product.currency ?? 'USD', category: product.category, is_bundle: product.is_bundle,
    domain: product.domain, first_party: product.first_party === true };
}
function draft(mandate, product, id) {
  const url = product.url ?? `https://${String(product.domain ?? 'catalogue.local').toLowerCase()}/products/${encodeURIComponent(product.product_id)}`;
  const observation = { source: product.source ?? 'curated', domain: String(product.domain ?? new URL(url).hostname).toLowerCase(), url };
  return { proposal_id: id, mandate_id: mandate.mandate_id, mandate_version: mandate.version,
    merchant_id: product.merchant_id, currency: product.currency ?? 'USD',
    items: [{ sku: product.product_id, name: product.title, quantity: 1, unit_price_cents: product.price_cents }],
    total_cents: product.price_cents, source: 'protected', status: 'DRAFT', paypal_order_id: null,
    ...checkoutBoundary(observation), created_at: new Date().toISOString() };
}
function runPolicy(mandate, proposal, products, extractions, flags) {
  const catalogue = new Map(products.map((product) => [product.product_id, trustedProduct(product)]));
  return evaluate({ mandate, proposal, catalogue, extractions, sanitizeFlags: flags,
    captured: listCapturedSkus(mandate.mandate_id).map((sku) => ({ mandate_id: mandate.mandate_id, sku })), now: new Date() });
}
function buildCompareLinks(query) {
  const value = String(query || 'shopping').trim(); const encoded = encodeURIComponent(value);
  return [
    { query: value, store: 'Amazon', url: `https://www.amazon.com/s?k=${encoded}` },
    { query: value, store: 'Walmart', url: `https://www.walmart.com/search?q=${encoded}` },
    { query: value, store: 'Target', url: `https://www.target.com/s?searchTerm=${encoded}` },
    { query: value, store: 'Best Buy', url: `https://www.bestbuy.com/site/searchpage.jsp?st=${encoded}` },
    { query: value, store: 'Newegg', url: `https://www.newegg.com/p/pl?d=${encoded}` },
    { query: value, store: 'B&H Photo', url: `https://www.bhphotovideo.com/c/search?q=${encoded}` },
  ];
}

function notify(run, type, data) {
  const event = { type, data, id: run.events.length + 1 };
  run.events.push(event);
  for (const response of run.listeners) response.write(`id: ${event.id}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  if (type === 'done' || type === 'error') {
    run.finished = true;
    for (const response of run.listeners) response.end();
    run.listeners.clear();
  }
}

async function execute(run, mandate) {
  const started = Date.now();
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new Error('run budget exceeded')), runtime.budgetMs);
  const signal = AbortSignal.any([run.cancel.signal, deadline.signal]);
  let calls = 0;
  let reserveNaiveCall = false;
  const beforeExtractionCall = () => {
    // Keep one call available for the naive comparison while protected listing
    // extraction runs concurrently.
    const extractionLimit = reserveNaiveCall ? Math.max(0, runtime.maxLlmCalls - 1) : runtime.maxLlmCalls;
    if (signal.aborted || calls >= extractionLimit) return false;
    calls += 1; return true;
  };
  const beforeNaiveCall = () => {
    if (signal.aborted || calls >= runtime.maxLlmCalls) return false;
    calls += 1; return true;
  };
  const merchantNames = new Map(getMerchants().map((merchant) => [merchant.merchant_id, merchant.name]));
  try {
    notify(run, 'phase', { name: 'searching' });
    const query = String(mandate.item_query ?? mandate.category_terms?.join(' ') ?? '').trim();
    if (!query) throw Object.assign(new Error('Describe the product you want before starting a marketplace search.'), { code: 'MISSING_SEARCH_QUERY' });
    const products = await runtime.searchProducts(query, {
      limit: 12, item_query: mandate.item_query ?? '', category_terms: mandate.category_terms ?? [],
      allowed_domains: mandate.allowed_domains ?? [], max_price_cents: mandate.max_total_cents ?? null, signal,
    });
    reserveNaiveCall = products.length > 0;
    if (run.cancel.signal.aborted) throw Object.assign(new Error('Run cancelled because the client disconnected.'), { code: 'CANCELLED' });
    const provider = products[0]?.discovery_provider ?? getDiscoveryStatus().provider;
    notify(run, 'candidates_found', { count: products.length, provider });
    notify(run, 'phase', { name: 'analyzing' });

    const analyzed = new Map(); let cursor = 0;
    const analyzeOne = async (product, rank) => {
      const observation = makeObservation(product, merchantNames.get(product.merchant_id) ?? product.merchant_id);
      const contentHash = observation.content_hash;
      let extracted = extractionCache.get(contentHash);
      if (!extracted) {
        extracted = await runtime.extractListing(product, { signal, beforeCall: beforeExtractionCall });
        if (extracted.ok) extractionCache.set(contentHash, extracted);
      }
      const extraction = extracted?.ok ? extracted.extraction : null;
      const candidateProposal = draft(mandate, product, randomUUID());
      let decision;
      if (!extracted?.ok) {
        decision = { decision: 'REVIEW', reasons: [reason('EXTRACTOR_FAILED', 'The listing could not be analyzed, so it was held for review.')], checks: [] };
      } else {
        try { decision = await runPolicy(mandate, candidateProposal, [product], new Map([[product.product_id, extraction]]), new Map([[product.product_id, extracted.flags]])); }
        catch { decision = { decision: 'REVIEW', reasons: [reason('EXTRACTOR_FAILED', 'The listing could not be analyzed, so it was held for review.')], checks: [] }; }
      }
      const flags = extracted?.flags ?? { zero_width: false, html_comment: false, hidden_style: false };
      analyzed.set(product.product_id, { product, observation, extracted, extraction, decision, candidateProposal });
      append({ actor: 'agent', event_type: 'LISTING_SANITIZED', mandate_id: mandate.mandate_id, proposal_id: candidateProposal.proposal_id, payload: { product_id: product.product_id, flags } });
      append({ actor: 'agent', event_type: 'EXTRACTION_DONE', mandate_id: mandate.mandate_id, proposal_id: candidateProposal.proposal_id, payload: { product_id: product.product_id, ok: Boolean(extracted?.ok) } });
      append({ actor: 'agent', event_type: 'POLICY_DECISION', mandate_id: mandate.mandate_id, proposal_id: candidateProposal.proposal_id, payload: { product_id: product.product_id, decision } });
      notify(run, 'candidate', { rank, observation, flags: candidateFlags(extraction, flags, observation), checkout_mode: observation.checkout_mode,
        payment_mode: observation.checkout_mode === 'gateway' ? 'store_checkout' : 'sandbox_simulation',
        simulated: observation.checkout_mode !== 'gateway',
        ...(observation.checkout_mode !== 'gateway' ? { disclosure: `PayPal sandbox simulation. MandateGuard created a sandbox order for this product. Nothing is purchased from ${observation.domain} and no real money moves.` } : {}),
        ...(observation.checkout_mode === 'handoff' ? { handoff_url: observation.handoff_url } : {}),
        decision: decision.decision, reasons: decision.reasons ?? [], checks: decision.checks ?? [],
        extraction_summary: extraction ? { category_label: extraction.category_label, directives_to_agent: extraction.directives_to_agent,
          asserts_authority_override: extraction.asserts_authority_override, urgency_pressure: extraction.urgency_pressure,
          claimed_price_cents: extraction.claimed_price_cents, evidence: extraction.evidence } : null });
    };
    const protectedWork = async () => {
      const worker = async () => {
        while (cursor < products.length && !run.cancel.signal.aborted) {
          const index = cursor++; const product = products[index];
          await analyzeOne(product, index + 1);
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, products.length) }, worker));
    };
    const naiveWork = async () => {
      if (!products.length) return { choice: { items: [], reasoning: 'The unprotected agent did not choose a listing.' } };
      const rawProducts = products.map((product) => ({ ...product, merchant_name: product.merchant_name ?? merchantNames.get(product.merchant_id) ?? product.merchant_id }));
      const known = new Set(products.map((product) => product.product_id));
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const naive = await runtime.naiveChooseWithStatus({ instruction: mandate.original_instruction ?? mandate.item_query ?? '', products: rawProducts,
          temperature: 0.7, sample_id: `${run.id}${attempt ? ':retry' : ''}`, signal, beforeCall: beforeNaiveCall });
        const usable = naive.replayable && naive.choice.items.length > 0 && naive.choice.items.every((item) => known.has(item.sku));
        if (usable) return { choice: naive.choice };
      }
      return { choice: { items: [], reasoning: 'The unprotected agent did not choose a listing.' } };
    };
    const [_, naiveResult] = await Promise.all([protectedWork(), naiveWork()]);
    const naiveChoice = naiveResult.choice;
    if (run.cancel.signal.aborted) throw Object.assign(new Error('Run cancelled because the client disconnected.'), { code: 'CANCELLED' });

    notify(run, 'phase', { name: 'deciding' });
    const ordered = products.map((product) => analyzed.get(product.product_id)).filter(Boolean);
    const allowed = ordered.filter((entry) => entry.decision.decision === 'ALLOW');
    const allowedAlternativeIds = [];
    for (const entry of allowed) {
      const evaluation_id = randomUUID();
      const checkoutEvidence = paymentEvidence(entry.product);
      const p = { ...draft(mandate, entry.product, evaluation_id), ...checkoutEvidence.proposal, status: 'ALLOWED',
        payment_mode: entry.observation.checkout_mode === 'gateway' ? 'store_checkout' : 'sandbox_simulation',
        simulated: entry.observation.checkout_mode !== 'gateway', payment_observation: entry.observation,
        evidence: { ...checkoutEvidence.evidence, extractions: { [entry.product.product_id]: entry.extraction },
          sanitize_flags: { [entry.product.product_id]: entry.extracted.flags },
          decision: entry.decision, evaluated_at: new Date().toISOString() } };
      saveEvaluation({ evaluation_id, mandate_id: mandate.mandate_id, mandate_version: mandate.version, decision: 'ALLOW',
        observation: entry.observation, proposal: p, created_at: p.created_at,
        expires_at: new Date(Date.now() + 15 * 60_000).toISOString() });
      entry.evaluation_id = evaluation_id; allowedAlternativeIds.push(evaluation_id);
    }
    const chosen = allowed.filter((entry) => entry.observation.checkout_mode === 'gateway').sort((a, b) => (b.product.marketplace_priority ?? 0) - (a.product.marketplace_priority ?? 0)
      || Number(b.product.first_party === true) - Number(a.product.first_party === true)
      || a.product.price_cents - b.product.price_cents)[0];
    let proposal = null;
    if (chosen) {
      const checkoutEvidence = paymentEvidence(chosen.product);
      proposal = { ...draft(mandate, chosen.product, randomUUID()), ...checkoutEvidence.proposal, status: 'ALLOWED',
        payment_mode: chosen.observation.checkout_mode === 'gateway' ? 'store_checkout' : 'sandbox_simulation',
        simulated: chosen.observation.checkout_mode !== 'gateway', payment_observation: chosen.observation, evidence: {
        ...checkoutEvidence.evidence,
        extractions: { [chosen.product.product_id]: chosen.extraction }, sanitize_flags: { [chosen.product.product_id]: chosen.extracted.flags },
        decision: chosen.decision, evaluated_at: new Date().toISOString() } };
      saveProposal(proposal);
      append({ actor: 'agent', event_type: 'PROPOSAL_CREATED', mandate_id: mandate.mandate_id, proposal_id: proposal.proposal_id, payload: { source: 'protected', status: proposal.status, total_cents: proposal.total_cents } });
    }

    const byId = new Map(products.map((p) => [p.product_id, p]));
    const naiveItems = naiveChoice.items ?? [];
    const naiveProducts = [...new Set(naiveItems.map((item) => byId.get(item.sku)).filter(Boolean))];
    let naiveProposal = null;
    if (naiveItems.length) naiveProposal = { proposal_id: randomUUID(), mandate_id: mandate.mandate_id, mandate_version: mandate.version,
      merchant_id: naiveProducts[0]?.merchant_id ?? null, currency: 'USD', items: naiveItems,
      total_cents: naiveItems.reduce((total, item) => total + item.quantity * item.unit_price_cents, 0),
      source: 'naive', status: 'DRAFT', paypal_order_id: null, created_at: new Date().toISOString() };
    let naiveDecision = { decision: 'BLOCK', reasons: [reason('PRODUCT_UNKNOWN', 'The proposed product could not be verified.', 'BLOCK')], checks: [] };
    try {
      if (naiveItems.length) naiveDecision = await runPolicy(mandate, naiveProposal, naiveProducts,
        new Map(naiveProducts.map((product) => [product.product_id, analyzed.get(product.product_id)?.extraction ?? null])),
        new Map(naiveProducts.map((product) => [product.product_id, analyzed.get(product.product_id)?.extracted?.flags ?? {}])));
    } catch { /* Comparison mode fails closed. */ }
    if (naiveProposal) {
      naiveProposal.would_have_been = naiveDecision.decision;
      naiveProposal.evidence = { decision: naiveDecision };
      saveProposal(naiveProposal);
      for (const item of naiveItems) append({ actor: 'agent', event_type: 'POLICY_DECISION', mandate_id: mandate.mandate_id,
        proposal_id: naiveProposal.proposal_id, payload: { mode: 'naive', product_id: item.sku, decision: naiveDecision } });
      append({ actor: 'agent', event_type: 'PROPOSAL_CREATED', mandate_id: mandate.mandate_id,
        proposal_id: naiveProposal.proposal_id, payload: { source: 'naive', status: 'DRAFT', would_have_been: naiveDecision.decision } });
    }
    const violations = (naiveDecision.reasons ?? []).filter((entry) => entry.source === 'deterministic' && (entry.severity === 'BLOCK' || entry.severity === 'REVIEW'))
      .map(({ code, message }) => ({ code, message }));
    const naiveReasoning = naiveProposal ? naiveChoice.reasoning : 'The unprotected agent did not choose a listing.';
    notify(run, 'naive', { proposal: naiveProposal, reasoning: naiveReasoning, would_have_been: naiveProposal ? naiveDecision.decision : null,
      violations: naiveProposal ? violations : [] });
    notify(run, 'phase', { name: 'finishing' });
    notify(run, 'proposal', { proposal, allowed_alternative_ids: allowedAlternativeIds });
    const compare_links = buildCompareLinks(query);
    notify(run, 'compare_links', { links: compare_links });
    const counts = { allowed: 0, review: 0, blocked: 0 };
    for (const entry of ordered) counts[entry.decision.decision.toLowerCase()] += 1;
    const donePayload = { counts, duration_ms: Date.now() - started, llm_calls: calls };
    run.snapshot = { run_id: run.id, status: 'done', discovery_provider: provider, listing_count: products.length,
      candidates: ordered.map(({ product, observation, decision, extraction, evaluation_id }) => ({
        product_id: product.product_id, observation, decision: decision.decision, reasons: decision.reasons,
        checks: decision.checks, extraction, evaluation_id, flags: candidateFlags(extraction, analyzed.get(product.product_id)?.extracted?.flags, observation),
        alternatives: decision.decision === 'ALLOW' ? [] : allowed.filter(entry => entry.observation.domain !== observation.domain
          && entry.observation.title.toLocaleLowerCase() !== observation.title.toLocaleLowerCase()).slice(0, 3)
          .map(entry => ({ evaluation_id: entry.evaluation_id, observation: entry.observation, decision: 'ALLOW', reasons: [] })),
      })),
      naive_candidates: naiveProducts.map((product) => ({ product_id: product.product_id,
        observation: analyzed.get(product.product_id)?.observation ?? makeObservation(product, merchantNames.get(product.merchant_id) ?? product.merchant_id),
        decision: naiveDecision.decision, reasons: naiveDecision.reasons, checks: naiveDecision.checks, extraction: analyzed.get(product.product_id)?.extraction ?? null,
        flags: candidateFlags(analyzed.get(product.product_id)?.extraction, analyzed.get(product.product_id)?.extracted?.flags, analyzed.get(product.product_id)?.observation) })),
      proposal, naive: { proposal: naiveProposal, reasoning: naiveReasoning, would_have_been: naiveProposal ? naiveDecision.decision : null,
        violations: naiveProposal ? violations : [] },
      allowed_alternative_ids: allowedAlternativeIds, compare_links, ...donePayload };
    notify(run, 'done', donePayload);
    run.snapshot.events = run.events.map(({ type, data, id }) => ({ id, type, data }));
  } catch (error) {
    const code = error.code ?? (run.cancel.signal.aborted ? 'CANCELLED' : 'RUN_FAILED');
    notify(run, 'error', { code, message: code === 'CANCELLED' ? 'Run cancelled because the client disconnected.' : 'The agent run could not be completed.', retryable: code !== 'CANCELLED' });
    run.snapshot = { run_id: run.id, status: 'error', error: { code, message: 'The agent run could not be completed.', retryable: code !== 'CANCELLED' }, events: run.events.map(({ type, data, id }) => ({ id, type, data })) };
  } finally { clearTimeout(timer); }
}

export function startAgentRun(mandateId) {
  cleanOldRuns();
  const mandate = getMandate(mandateId);
  const id = randomUUID();
  const run = { id, created_at: Date.now(), events: [], listeners: new Set(), finished: false, cancel: new AbortController(), snapshot: null, connected: false };
  runs.set(id, run);
  append({ actor: 'agent', event_type: 'AGENT_RUN_STARTED', mandate_id: mandateId, payload: { run_id: id, mode: 'streaming' } });
  setImmediate(() => execute(run, mandate));
  return id;
}
export function getAgentRun(id) {
  cleanOldRuns(); const run = runs.get(id);
  return run ? (run.snapshot ?? { run_id: id, status: 'running', events: run.events.map(({ type, data, id: eventId }) => ({ id: eventId, type, data })) }) : null;
}
export function subscribeAgentRun(id, response) {
  cleanOldRuns(); const run = runs.get(id); if (!run) return null;
  run.connected = true; run.listeners.add(response);
  for (const event of run.events) response.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
  if (run.finished) response.end();
  const heartbeat = setInterval(() => { if (!run.finished && run.listeners.has(response)) response.write(': heartbeat\n\n'); }, 15_000);
  return () => {
    clearInterval(heartbeat); run.listeners.delete(response);
    if (!run.finished && run.connected && run.listeners.size === 0) run.cancel.abort(new Error('client disconnected'));
  };
}
export function cancelAgentRun(id) { const run = runs.get(id); if (run && !run.finished) run.cancel.abort(); }
export function setRunDependenciesForTests(overrides = {}) {
  const previous = { ...runtime };
  Object.assign(runtime, overrides);
  extractionCache.clear();
  return () => { Object.assign(runtime, previous); extractionCache.clear(); };
}
export const runInternals = Object.freeze({ runs, extractionCache, RUN_TTL, RUN_BUDGET });
